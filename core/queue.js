import { randomUUID } from "crypto";
import storage from '../storage/sqlite.js'
import { calculateNextRetry } from "./retry.js";


class Queue {
    constructor(){
        this.storage = storage;
    }


    enqueue(jobData){
        if(!jobData.command){
            throw new Error('Command is required');
        }

        const now = Date.now();
        
        const defaultMaxRetries = parseInt(this.storage.getConfig('max_retries') || '3');
        let runAt = null;
        if(jobData.run_at){
            runAt = new Date(jobData.runAt).getTime();
            if(isNaN(runAt)){
                throw new Error('Invalid run_at timestamp');
            }
        }
        const defaultTimeout = parseInt(this.storage.getConfig('default_timeout') || '60');
        
        // Validate priority
        let priority = jobData.priority !== undefined ? jobData.priority : 0;
        if (priority < 0 || priority > 3) {
            throw new Error('Priority must be between 0 (low) and 3 (urgent)');
        }
        
        const job = {
            id: jobData.id || randomUUID(),
            command: jobData.command,
            state: 'pending',
            priority: priority,
            attempts: 0,
            max_retries: jobData.max_retries || defaultMaxRetries,
            timeout: jobData.timeout || defaultTimeout,
            next_retry_at: null,
            run_at:runAt,
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

        if(attempts >= job.max_retries){
           
            const failedJob = {
                ...job,
                attempts: attempts,
                error: error.message || String(error),
                output: output,
                updated_at: now,
            };
            this.storage.deleteJob(jobId);
            this.storage.insertJob(failedJob);
            return this.moveToDLQ(jobId, error, output);
        }

        const backoffBase = parseInt(this.storage.getConfig('backoff_base') || '2');
        
        const nextRetryAt = calculateNextRetry(attempts, backoffBase);

        const updatedJob = {
            ...job,
            state: 'failed',
            attempts: attempts,
            next_retry_at: nextRetryAt,
            updated_at: now,
            error: error.message || String(error),
            output: output,
            locked_at: null,
            locked_by: null
        };

        this.storage.deleteJob(jobId);
        this.storage.insertJob(updatedJob);

        return updatedJob;

    }

    complete(jobId, output = null){
        const now = Date.now();

        const job = this.storage.getJob(jobId);

        if(!job){
            throw new Error(`Job ${jobId} not found`)

        }

        const updatedJob = {
            ...job,
            state: 'completed',
            updated_at: now,
            locked_by:  null,
            locked_at: null,
            output: output
        }

        this.storage.deleteJob(jobId);
        this.storage.insertJob(updatedJob);
    }

    moveToDLQ(jobId, error = null,output = null){
        const job = this.storage.getJob(jobId);
        if(!job){
            throw new Error(`Job ${jobId} not found`);
        }

        const now = Date.now();

        const deadJob = {
            ...job,
            state: 'dead',
            error: error ? (error.message || String(error)) : job.error,
             output: output || job.output,
            updated_at: now,
            locked_by: null,
            locked_at: null,
            next_retry_at: null
        };

        this.storage.insertIntoDLQ(deadJob);
        this.storage.deleteJob(jobId);

        return deadJob;
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
        
        const retriedJob = {
            ...job,
            state: 'pending',
            attempts: 0,
            next_retry_at: null,
            error: null,
            locked_by: null,
            locked_at: null,
            updated_at: now
        };
        
        this.storage.insertJob(retriedJob);
        this.storage.deleteFromDLQ(jobId);
        
        return retriedJob;
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
                .filter(j => j.updated_at && (j.locked_at || j.created_at))
                .map(j => {
                    // Use locked_at if available (actual execution time), otherwise fall back to created_at
                    const startTime = j.locked_at || j.created_at;
                    return (j.updated_at - startTime) / 1000;
                });
            
            if (executionTimes.length > 0) {
                avgExecutionTime = executionTimes.reduce((a, b) => a + b, 0) / executionTimes.length;
                minExecutionTime = Math.min(...executionTimes);
                maxExecutionTime = Math.max(...executionTimes);
            }
        }
        
        // Retry statistics
        const jobsWithRetries = allJobs.filter(j => j.attempts > 0).length;
        const totalRetries = allJobs.reduce((sum, j) => sum + j.attempts, 0);
        
        return {
            avgExecutionTime,
            minExecutionTime,
            maxExecutionTime,
            jobsWithRetries,
            totalRetries
        };
    }
}

export default new Queue();