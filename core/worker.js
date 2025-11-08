import queue from "./queue.js";
import executor from "./executor.js";

class Worker{
    constructor(){
        this.workerId = process.pid;
        this.running = true;
    }

    async start(){
        this.running = true

        console.log(`[Worker ${this.workerId}] Started`);
        while(this.running){
            try{

                const job = queue.claim(this.workerId);
                if(job){
                    console.log(`[Worker ${this.workerId}] Processing job ${job.id}: ${job.command}`);

                    const result = await executor.run(job.command);

                    if(result.success){
                        queue.complete(job.id);
                        console.log(`[Worker ${this.workerId}] ✓ Completed job ${job.id}`);
                    }else{
                        queue.fail(job.id,result.error);
                        console.log(`[Worker ${this.workerId}] ✗ Failed job ${job.id}: ${result.error.message}`);
                    }
                }else{
                    await this.sleep(1000);
                }
            }catch(error){
                console.log(`[Worker ${this.workerId}] Error:`,error.message);
                await this.sleep(1000);
            }
        }
        console.log(`[Worker ${this.workerId}] Stopped`);
        process.exit(0);
    }


    stop(){
        console.log(`[Worker ${this.workerId}] Stopping gracefully...`);
        this.running = false;
    }


    sleep(ms){
        return new Promise(resolve => setTimeout(resolve,ms));
    }
}


export default Worker;