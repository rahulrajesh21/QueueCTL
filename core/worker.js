import queue from "./queue.js";
import executor from "./executor.js";

class Worker{
    constructor(){
        this.workerId = process.id;
        this.running = true;
    }

    async start(){
        this.running = true

        console.log(`[Worker ${this.WorkerId}] Started`);
        while(this.running){
            try{

                const job = queue.claim(this.WorkerId);
                if(job){
                    console.log(`[Worker ${this.workerId}] Processing job ${job.id}: ${job.command}`);

                    const result = await executor.run(job.command);

                    if(result.success){
                        queue.complete(job.id);
                        console.log(`[Worker ${this.workerId}] ✓ Completed job ${job.id}`);
                    }else{
                        queue.fail(job.id,result.error);
                        console.log(`[Worker ${this.workerId}] ✓ Completed job ${job.id}`);
                    }
                }else{
                    await this.sleep(1000);
                }
            }catch(error){
                console.log(`[Worker ${this.WorkerId}] Error:`,error.message);
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