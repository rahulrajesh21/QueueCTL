import Worker from "../../core/worker.js";
import { fork } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const WORKERS_FILE = './data/workers.json';

export function workerCommand(program) {
  const worker = program.command('worker').description('Worker management');

  worker
    .command('start')
    .option('--count <number>', 'Number of workers to start', '1')
    .description('Start worker process')
    .action(async (options) => {
      const count = parseInt(options.count);

      if (count > 1) {
        console.log(`Starting ${count} workers...`);
        const workers = [];
        
        for (let i = 0; i < count; i++) {
          const child = fork('./core/worker-process.js', [], {
            detached: true,
            stdio: 'ignore'
          });
          
          child.unref();
          workers.push(child.pid);
          console.log(`✓ Started worker ${child.pid}`);
        }

        saveWorkers(workers);
        console.log(`\n${count} worker(s) started successfully`);
        
      } else {
        const w = new Worker();
        process.on('SIGTERM', () => w.stop());
        process.on('SIGINT', () => w.stop());
        await w.start();
      }
    });

  worker
    .command('stop')
    .description('Stop all workers')
    .action(() => {
      const workers = loadWorkers();

      if (workers.length === 0) {
        console.log('No workers running');
        return;
      }

      workers.forEach(pid => {  // Fixed: workers (not worker)
        try {
          process.kill(pid, 'SIGTERM');
          console.log(`✓ Stopped worker ${pid}`);
        } catch (error) {
          console.log(`Worker ${pid} already stopped`);
        }
      });
      
      saveWorkers([]);
    });
}

function saveWorkers(pids) {
  const dir = './data';
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(WORKERS_FILE, JSON.stringify(pids));
}

function loadWorkers() {
  if (!existsSync(WORKERS_FILE)) return [];
  return JSON.parse(readFileSync(WORKERS_FILE, 'utf-8'));
}
