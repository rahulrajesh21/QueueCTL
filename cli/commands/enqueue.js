import queue from '../../core/queue.js'


export function enqueueCommand(program){
    program.command('enqueue <job>')
    .description('Add a new job to the queue')
    .action((jobJson) =>{
        try{
            const jobData = JSON.parse(jobJson);

            if(!jobData.command){
                console.error('Error: command field is required');
                process.exit(1);
            }

            const job = queue.enqueue(jobData);
            console.log('Job enqueued sucessfully');
            console.log('Job ID:',job.id);
            console.log('Command:',job.command);

        }catch(error){
            console.log('Error:',error.message)
            process.exit(1)
        }
    });
}