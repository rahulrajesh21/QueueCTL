import queue from "./queue.js";
import executor from "./executor.js";

class Worker{
    constructor(customQueue = null, customExecutor = null, options = {}){
        this.workerId = options.workerId || process.pid;
        this.running = true;
        this.queue = customQueue || queue;
        this.executor = customExecutor || executor;
        this.pollInterval = options.pollInterval || 1000;
        this.exitOnStop = options.exitOnStop ?? false;
        this.silent = options.silent ?? (process.env.NODE_ENV === 'test');
    }

    async processNextJob(){
        const job = this.queue.claim(this.workerId);
        if(!job){
            return null;
        }

        if(!this.silent) console.log(`[Worker ${this.workerId}] Processing job ${job.id}: ${job.command}`);

        const result = await this.executor.run(job.command, job.timeout);

        if(result.success){
            this.queue.complete(job.id, result.output);
            if(!this.silent) console.log(`[Worker ${this.workerId}] Completed job ${job.id}`);
        }else{
            this.queue.fail(job.id, result.error, result.output);
            if(!this.silent) console.log(`[Worker ${this.workerId}] Failed job ${job.id}: ${result.error?.message || result.error}`);
        }
        return { job, result };
    }

    async start(){
        this.running = true;

        if(!this.silent) console.log(`[Worker ${this.workerId}] Started`);
        while(this.running){
            try{
                const processed = await this.processNextJob();
                if(!processed){
                    await this.sleep(this.pollInterval);
                }
            }catch(error){
                if(!this.silent) console.log(`[Worker ${this.workerId}] Error:`, error.message);
                await this.sleep(this.pollInterval);
            }
        }
        if(!this.silent) console.log(`[Worker ${this.workerId}] Stopped`);
        if (this.exitOnStop) {
            process.exit(0);
        }
    }


    stop(){
        if(!this.silent) console.log(`[Worker ${this.workerId}] Stopping gracefully...`);
        this.running = false;
    }


    sleep(ms){
        return new Promise(resolve => setTimeout(resolve,ms));
    }
}


export default Worker;