import queue from "../../core/queue.js";

export function listCommand(program){

    program
    .command('list')
    .description("List jobs by state")
    .option('--state <state>','Filter by state (pending, processing, completed, failed, dead)')
    .action((options)=>{
        try{
            const jobs = queue.listJobs(options.state)
            if(jobs.length === 0){
                console.log(`No jobs found with state: ${options.state}`)
                return
            }
            const stateFilter = options.state ? `(${options.state})`:'';
            console.log(`\nFound ${jobs.length} job(s)${stateFilter}:\n`);

            jobs.forEach(job => {
              console.log(`ID: ${job.id}`);
              console.log(`  Command: ${job.command}`);
              console.log(`  State: ${job.state}`);
              console.log(`  Attempts: ${job.attempts}/${job.max_retries}`);
          
              if (job.error) {
                console.log(`  Error: ${job.error}`);
              }
              
              if (job.output) {
                const preview = job.output.substring(0, 100);
                console.log(`  Output: ${preview}${job.output.length > 100 ? '...' : ''}`);
              }

              if (job.locked_by) {
                console.log(`  Locked by: Worker ${job.locked_by}`);
              }
          
              if (job.next_retry_at) {
                const retryDate = new Date(job.next_retry_at);
                console.log(`  Next retry: ${retryDate.toLocaleString()}`);
              }
          
              const createdDate = new Date(job.created_at);
              console.log(`  Created: ${createdDate.toLocaleString()}`);
          
              console.log('');
        });
        
        }catch(error){
            console.log(error)
        }
    })

}