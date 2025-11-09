import queue from '../../core/queue.js';

export function metricsCommand(program) {
  program
    .command('metrics')
    .description('Display queue metrics and execution statistics')
    .action(() => {
      try {
        const stats = queue.getStats();
        const metrics = queue.getMetrics();
        
        console.log('\n=== Queue Metrics ===\n');
        
        // Job Statistics
        console.log('Job Statistics:');
        console.log(`  Total Jobs:       ${stats.total}`);
        console.log(`  Pending:          ${stats.pending}`);
        console.log(`  Processing:       ${stats.processing}`);
        console.log(`  Completed:        ${stats.completed}`);
        console.log(`  Failed:           ${stats.failed}`);
        console.log(`  Dead (DLQ):       ${stats.dead}`);
        console.log('');
        
        // Success Rate
        const totalProcessed = stats.completed + stats.failed + stats.dead;
        const successRate = totalProcessed > 0 
          ? ((stats.completed / totalProcessed) * 100).toFixed(2) 
          : 0;
        console.log('Performance:');
        console.log(`  Success Rate:     ${successRate}%`);
        console.log(`  Failure Rate:     ${(100 - successRate).toFixed(2)}%`);
        console.log('');
        
        // Execution Stats
        if (metrics.avgExecutionTime) {
          console.log('Execution Statistics:');
          console.log(`  Avg Execution:    ${metrics.avgExecutionTime.toFixed(2)}s`);
          console.log(`  Min Execution:    ${metrics.minExecutionTime.toFixed(2)}s`);
          console.log(`  Max Execution:    ${metrics.maxExecutionTime.toFixed(2)}s`);
          console.log('');
        }
        
        // Retry Statistics
        console.log('Retry Statistics:');
        console.log(`  Jobs with Retries: ${metrics.jobsWithRetries || 0}`);
        console.log(`  Total Retry Attempts: ${metrics.totalRetries || 0}`);
        console.log('');
        
      } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
      }
    });
}
