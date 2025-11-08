import queue from "../../core/queue.js";

export function dlqCommand(program){

    const dlq = program.command('dlq').description('Dead Letter Queue commands')
    dlq
    .command('list')
    .description("List jobs in DQL")
    .action(()=>{
        try{
            const jobs = queue.listDLQ()
            if(jobs.length === 0){
                console.log(`DLQ`)
                return
            }
        console.log(`\nDead Letter Queue (${jobs.length} job(s)):\n`);
        
        jobs.forEach(job => {
          console.log(`ID: ${job.id}`);
          console.log(`  Command: ${job.command}`);
          console.log(`  Error: ${job.error || 'Unknown error'}`);
          console.log(`  Attempts: ${job.attempts}`);
          console.log('');
        });
        }catch(error){
        console.error('Error:', error.message);
        process.exit(1);
        }
    })


    dlq
    .command('retry <jobId>')
    .description('Retry a job from DLQ')
    .action((jobId)=>{
        try{
            queue.retryFromDLQ(jobId);
            console.log(`Job ${jobId} moved back to queue`)

        }catch(error){
            console.log('Error:',error.message)
            process.exit(1);
        }
    })


}