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
        
        const job = {
            id: jobData.id || randomUUID(),
            command: jobData.command,
            state: 'pending',
            attempts: 0,
            max_retries: jobData.max_retries || 3,
            next_retry_at: null,
            locked_at: null,
            locked_by: null,
            created_at: now,
            updated_at: now,
            completed_at: null,
            error: null
        };
        
        this.storage.insertJob(job);
        return job;
    }

    claim(workerId){
        const now = Date.now();
        return this.storage.claimJobs(workerId,now);
    }

    fail(jobId,error){

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
                updated_at: now
            };
            this.storage.deleteJob(jobId);
            this.storage.insertJob(failedJob);
            return this.moveToDLQ(jobId, error);
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
            locked_at: null,
            locked_by: null
        };

        this.storage.deleteJob(jobId);
        this.storage.insertJob(updatedJob);

        return updatedJob;

    }

    complete(jobId){
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
            locked_at: null
        }

        this.storage.deleteJob(jobId);
        this.storage.insertJob(updatedJob);
    }

    moveToDLQ(jobId, error = null){
        const job = this.storage.getJob(jobId);
        if(!job){
            throw new Error(`Job ${jobId} not found`);
        }

        const now = Date.now();

        const deadJob = {
            ...job,
            state: 'dead',
            error: error ? (error.message || String(error)) : job.error,
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
}

export default new Queue();