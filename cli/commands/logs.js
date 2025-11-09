import queue from "../../core/queue.js"

export function logsCommand(program){
    program
    .command('logs <jobId>')
    .description('View output logs for a job')
    .action((jobId)=>{
        try{

            let job = queue.storage.getJob(jobId);
            if(!job){
                job = queue.storage.getFromDLQ(jobId);
            }
            if(!job){
                console.log(`Job ${jobId} not found`)
                process.exit(1);
            }

            console.log(`\nJob: ${job.id}`);
            console.log(`Command: ${job.command}`);
            console.log(`State: ${job.state}`);
            console.log(`\n--- Output ---`);
            console.log(job.output || '(no output captured)');
            console.log('--- End ---\n');

        }catch(error){
            console.error('Error',error.message);
            process.exit(1);
        }         
    });
}