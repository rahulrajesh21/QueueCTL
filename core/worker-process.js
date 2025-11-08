import Worker from './worker.js';

const worker = new Worker();


process.on('SIGTERM', () => {
  console.log(`[Worker ${process.pid}] Received SIGTERM, shutting down...`);
  worker.stop();
});

process.on('SIGINT', () => {
  console.log(`[Worker ${process.pid}] Received SIGINT, shutting down...`);
  worker.stop();
});


worker.start().catch(error => {
  console.error(`[Worker ${process.pid}] Fatal error:`, error);
  process.exit(1);
});
