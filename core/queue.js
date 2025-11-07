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
            return this.moveToDLQ(jobId,error)
        }

        const backoffBase = parseInt(this.storage.getConfig('backoff_base') || '2');
        const nextRetryAt = calculateNextRetry(attempts, backoffBase);

        const updatedJob = {
            ...job,
            attempts:attempts,
            nextRetryAt:nextRetryAt,
            updated_at:now,
            error:error.message || String(error),
            locked_at:null,
            locked_by:null
        };

        this.storage.deleteJob(jobId);
        this.storage.insertJob(updatedJob);

        return updatedJob;

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
            updated_at: now
        };

        this.storage.insertIntoDLQ(deadJob);
        this.storage.deleteJob(jobId);

        return deadJob;
    }

    listJobs(state = null){
        if (state) {
            return this.storage.db.prepare('SELECT * FROM jobs WHERE state = ? ORDER BY created_at DESC').all(state);
        }
        return this.storage.db.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all();
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
        
        const rows = this.storage.db.prepare('SELECT state, COUNT(*) as count FROM jobs GROUP BY state').all();
        
        rows.forEach(row => {
            stats[row.state] = row.count;
            stats.total += row.count;
        });
        
        const dlqCount = this.storage.db.prepare('SELECT COUNT(*) as count FROM dlq').get();
        stats.dead = dlqCount.count;
        stats.total += dlqCount.count;
        
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
        this.storage.db.prepare('DELETE FROM dlq WHERE id = ?').run(jobId);
        
        return retriedJob;
    }

    listDLQ(){
        return this.storage.listDLQ();
    }
}

export default new Queue();