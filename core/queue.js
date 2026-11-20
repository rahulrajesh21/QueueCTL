import { randomUUID } from "crypto";
import storage from '../storage/sqlite.js'
import { calculateNextRetry } from "./retry.js";


class Queue {
    constructor(customStorage = null){
        this._customStorage = customStorage;
    }

    get storage() {
        return this._customStorage || storage;
    }

    set storage(val) {
        this._customStorage = val;
    }


    enqueue(jobData){
        if(!jobData || typeof jobData !== 'object'){
            throw new Error('Job payload must be an object');
        }
        if(typeof jobData.command !== 'string' || !jobData.command.trim()){
            throw new Error('Command is required');
        }

        const now = Date.now();
        
        const defaultMaxRetries = parseInt(this.storage.getConfig('max_retries') || '3', 10);
        let runAt = null;
        if(jobData.run_at || jobData.runAt){
            runAt = new Date(jobData.run_at || jobData.runAt).getTime();
            if(isNaN(runAt)){
                throw new Error('Invalid run_at timestamp');
            }
        }
        const defaultTimeout = parseInt(this.storage.getConfig('default_timeout') || '60', 10);
        
        // Validate priority
        const priority = jobData.priority ?? 0;
        if (!Number.isInteger(priority) || priority < 0 || priority > 3) {
            throw new Error('Priority must be between 0 (low) and 3 (urgent)');
        }

        // Validate max_retries (allow 0 for no retries)
        const maxRetries = jobData.max_retries ?? defaultMaxRetries;
        if (!Number.isInteger(maxRetries) || maxRetries < 0) {
            throw new Error('max_retries must be a non-negative integer');
        }

        // Validate timeout
        const timeout = jobData.timeout ?? defaultTimeout;
        if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout <= 0) {
            throw new Error('timeout must be a positive number');
        }
        
        const job = {
            id: jobData.id || randomUUID(),
            command: jobData.command,
            state: 'pending',
            priority: priority,
            attempts: 0,
            max_retries: maxRetries,
            timeout: timeout,
            next_retry_at: null,
            run_at: runAt,
            started_at: null,
            locked_at: null,
            locked_by: null,
            created_at: now,
            updated_at: now,
            completed_at: null,
            error: null,
            output: null
        };
        
        this.storage.insertJob(job);
        return job;
    }

    claim(workerId){
        const now = Date.now();
        return this.storage.claimJobs(workerId,now);
    }

    fail(jobId, error, output = null){

        const job = this.storage.getJob(jobId);
        if(!job){
            throw new Error(`Job ${jobId} not found`);
        }
        const attempts = job.attempts + 1;
        const now = Date.now();
        const errorMessage = error ? (error.message || String(error)) : job.error;

        if(attempts >= job.max_retries){
            const deadJob = {
                ...job,
                state: 'dead',
                attempts: attempts,
                error: errorMessage,
                output: output ?? job.output,
                updated_at: now,
                locked_at: null,
                locked_by: null,
                next_retry_at: null
            };
            return this.storage.moveJobToDLQ(deadJob);
        }

        const backoffBase = parseInt(this.storage.getConfig('backoff_base') || '2', 10);
        const nextRetryAt = calculateNextRetry(attempts, backoffBase, now);

        const updatedJob = {
            ...job,
            state: 'failed',
            attempts: attempts,
            next_retry_at: nextRetryAt,
            updated_at: now,
            error: errorMessage,
            output: output,
            locked_at: null,
            locked_by: null
        };

        this.storage.updateJob(updatedJob);

        return updatedJob;

    }

    complete(jobId, output = null){
        const now = Date.now();

        const job = this.storage.getJob(jobId);

        if(!job){
            throw new Error(`Job ${jobId} not found`);
        }

        const updatedJob = {
            ...job,
            state: 'completed',
            updated_at: now,
            completed_at: now,
            locked_by: null,
            locked_at: null,
            output: output
        };

        this.storage.updateJob(updatedJob);
        return updatedJob;
    }

    moveToDLQ(jobId, error = null, output = null){
        const job = this.storage.getJob(jobId);
        if(!job){
            throw new Error(`Job ${jobId} not found`);
        }

        const now = Date.now();

        const deadJob = {
            ...job,
            state: 'dead',
            error: error ? (error.message || String(error)) : job.error,
            output: output ?? job.output,
            updated_at: now,
            locked_by: null,
            locked_at: null,
            next_retry_at: null
        };

        return this.storage.moveJobToDLQ(deadJob);
    }

    listJobs(state = null){
        return this.storage.listJob(state);
    }

    getStats(){
        const stats = {
            pending: 0,
            processing: 0,
            completed: 0,
            failed: 0,
            dead: 0,
            total: 0
        };
        
        
        const allJobs = this.storage.listJob();
        allJobs.forEach(job => {
            if (stats[job.state] !== undefined) {
                stats[job.state]++;
                stats.total++;
            }
        });
        
        
        const dlqJobs = this.storage.listDLQ();
        stats.dead = dlqJobs.length;
        stats.total += dlqJobs.length;
        
        return stats;
    }

    retryFromDLQ(jobId){
        const job = this.storage.getFromDLQ(jobId);
        if (!job) {
            throw new Error(`Job ${jobId} not found in DLQ`);
        }
        
        const now = Date.now();
        const defaultTimeout = parseInt(this.storage.getConfig('default_timeout') || '60', 10);
        
        const retriedJob = {
            ...job,
            state: 'pending',
            priority: job.priority ?? 0,
            attempts: 0,
            timeout: job.timeout ?? defaultTimeout,
            next_retry_at: null,
            run_at: null,
            started_at: null,
            completed_at: null,
            error: null,
            output: null,
            locked_by: null,
            locked_at: null,
            updated_at: now
        };
        
        return this.storage.requeueFromDLQ(retriedJob);
    }

    listDLQ(){
        return this.storage.listDLQ();
    }

    getMetrics(){
        const allJobs = this.storage.listJob();
        const dlqJobs = this.storage.listDLQ();
        const completedJobs = allJobs.filter(j => j.state === 'completed');
        
        // Calculate execution time statistics
        let avgExecutionTime = null;
        let minExecutionTime = null;
        let maxExecutionTime = null;
        
        if (completedJobs.length > 0) {
            const executionTimes = completedJobs
                .filter(j => (j.completed_at || j.updated_at) && (j.started_at || j.locked_at || j.created_at))
                .map(j => {
                    const startTime = j.started_at || j.locked_at || j.created_at;
                    const endTime = j.completed_at || j.updated_at;
                    return Math.max(0, (endTime - startTime) / 1000);
                });
            
            if (executionTimes.length > 0) {
                avgExecutionTime = executionTimes.reduce((a, b) => a + b, 0) / executionTimes.length;
                minExecutionTime = Math.min(...executionTimes);
                maxExecutionTime = Math.max(...executionTimes);
            }
        }
        
        // Retry statistics across active jobs and DLQ
        const combinedJobs = [...allJobs, ...dlqJobs];
        const jobsWithRetries = combinedJobs.filter(j => j.attempts > 0).length;
        const totalRetries = combinedJobs.reduce((sum, j) => sum + (j.attempts || 0), 0);
        
        return {
            avgExecutionTime,
            minExecutionTime,
            maxExecutionTime,
            jobsWithRetries,
            totalRetries
        };
    }
}

let defaultQueue = null;

export function getDefaultQueue() {
    if (!defaultQueue) {
        defaultQueue = new Queue();
    }
    return defaultQueue;
}

const lazyQueue = new Proxy({}, {
    get(target, prop) {
        const instance = getDefaultQueue();
        const value = instance[prop];
        if (typeof value === 'function') {
            return value.bind(instance);
        }
        return value;
    },
    set(target, prop, value) {
        const instance = getDefaultQueue();
        instance[prop] = value;
        return true;
    }
});

export { Queue };
export default lazyQueue;