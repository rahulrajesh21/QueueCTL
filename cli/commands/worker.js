import Worker from "../../core/worker.js";
import { fork } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_DIR = process.env.QUEUECTL_DATA_DIR || join(homedir(), '.queuectl');
const WORKERS_FILE = join(DATA_DIR, 'workers.json');

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
        const workerPath = join(__dirname, '../../core/worker-process.js');
        
        for (let i = 0; i < count; i++) {
          const child = fork(workerPath, [], {
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

      workers.forEach(pid => { 
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
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(WORKERS_FILE, JSON.stringify(pids));
}

function loadWorkers() {
  if (!existsSync(WORKERS_FILE)) return [];
  return JSON.parse(readFileSync(WORKERS_FILE, 'utf-8'));
}
