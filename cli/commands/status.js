import queue from '../../core/queue.js'

export function statusCommand(program){
    program.command('status').description('Show summary of all job states and active workers')
    .action(()=>{

        try{

        
        const stats = queue.getStats();

        console.log('\n Queue Status\n');
        console.log('Jobs:');
        console.log(`  Pending:     ${stats.pending || 0}`);
        console.log(`  Processing:  ${stats.processing || 0}`);
        console.log(`  Completed:   ${stats.completed || 0}`);
        console.log(`  Failed:      ${stats.failed || 0}`);
        console.log(`  Dead (DLQ):  ${stats.dead || 0}`);
        console.log(`  ─────────────────────`);
        console.log(`  Total:       ${stats.total || 0}`);
    
        }catch(error){
        console.error('Error fetching status:', error.message);
        process.exit(1);
        }
    })
}