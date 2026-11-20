import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createTestContext } from './helpers/test-db.js';
import { Storage } from '../storage/sqlite.js';
import { Queue } from '../core/queue.js';

describe('SQLite WAL & Concurrency Safety', () => {
  let ctx;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('guarantees atomic claims with no duplicate execution across multiple connections', async () => {
    // Arrange: Enqueue 20 distinct jobs with varying priorities
    const jobCount = 20;
    const enqueuedIds = new Set();
    for (let i = 0; i < jobCount; i++) {
      const job = ctx.queue.enqueue({
        command: `echo job-${i}`,
        priority: i % 4, // 0, 1, 2, 3
      });
      enqueuedIds.add(job.id);
    }

    // Create 5 independent worker connections sharing the same WAL-mode SQLite database
    const workerCount = 5;
    const workerClients = [];
    for (let i = 0; i < workerCount; i++) {
      const storage = new Storage(ctx.dbPath);
      const queue = new Queue(storage);
      workerClients.push({
        workerId: `concurrent-worker-${i}`,
        storage,
        queue,
      });
    }

    const claims = []; // Array of { workerId, jobId }
    try {
      const claimPromises = workerClients.map(async ({ workerId, queue }) => {
        let drained = false;
        while (!drained) {
          const job = queue.claim(workerId);
          if (job) {
            claims.push({ workerId, jobId: job.id });
            await new Promise(resolve => setImmediate(resolve));
          } else {
            drained = true;
          }
        }
      });

      await Promise.all(claimPromises);
    } finally {
      workerClients.forEach(client => {
        try {
          client.storage.close();
        } catch (_) {}
      });
    }

    // Assert 1: Exactly 20 claims occurred in total
    expect(claims.length).toBe(jobCount);

    // Assert 2: Every claimed job is unique (NO duplicates claimed)
    const claimedJobIds = claims.map(c => c.jobId);
    const uniqueClaimedJobIds = new Set(claimedJobIds);
    expect(uniqueClaimedJobIds.size).toBe(jobCount);

    // Assert 3: All enqueued jobs were claimed
    for (const id of enqueuedIds) {
      expect(uniqueClaimedJobIds.has(id)).toBe(true);
    }

    // Assert 4: In SQLite, all jobs are now locked in 'processing' state
    const allJobs = ctx.storage.listJob();
    expect(allJobs.length).toBe(jobCount);
    allJobs.forEach(job => {
      expect(job.state).toBe('processing');
      expect(job.locked_by).toMatch(/^concurrent-worker-\d$/);
      expect(job.locked_at).toBeGreaterThan(0);
    });

    // Assert 5: Additional claims return null
    expect(ctx.queue.claim('any-worker')).toBeNull();
  });

  it('prevents duplicate claims and SQLITE_BUSY errors across true parallel OS worker processes', async () => {
    // Arrange: Enqueue 24 jobs to be raced by 4 separate OS processes
    const jobCount = 24;
    const enqueuedIds = new Set();
    for (let i = 0; i < jobCount; i++) {
      const job = ctx.queue.enqueue({
        command: `echo proc-job-${i}`,
        priority: i % 4,
      });
      enqueuedIds.add(job.id);
    }

    const storageModuleUrl = pathToFileURL(resolve('storage/sqlite.js')).href;
    const queueModuleUrl = pathToFileURL(resolve('core/queue.js')).href;
    const workerScript = `
      import { Storage } from ${JSON.stringify(storageModuleUrl)};
      import { Queue } from ${JSON.stringify(queueModuleUrl)};

      const storage = new Storage(process.env.TEST_DB_PATH);
      const queue = new Queue(storage);
      const claimed = [];
      try {
        while (true) {
          const job = queue.claim(process.env.TEST_WORKER_ID);
          if (!job) break;
          claimed.push(job.id);
          await new Promise(r => setTimeout(r, 5));
        }
        process.stdout.write(JSON.stringify(claimed));
      } finally {
        storage.close();
      }
    `;

    // Act: Launch 4 real child Node processes concurrently against the same temp WAL SQLite DB
    const runWorkerProcess = (index) => new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', workerScript], {
        env: {
          ...process.env,
          TEST_DB_PATH: ctx.dbPath,
          TEST_WORKER_ID: `os-worker-${index}`,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', d => { stdout += d.toString(); });
      child.stderr.on('data', d => { stderr += d.toString(); });
      child.on('error', rejectPromise);
      child.on('close', code => {
        if (code !== 0) {
          rejectPromise(new Error(`Worker ${index} exited with code ${code}: ${stderr}`));
        } else {
          resolvePromise(JSON.parse(stdout));
        }
      });
    });

    const results = await Promise.all([0, 1, 2, 3].map(runWorkerProcess));
    const allClaimed = results.flat();

    // Assert: Zero duplicates, all 24 jobs claimed cleanly, zero SQLITE_BUSY errors
    expect(allClaimed.length).toBe(jobCount);
    const uniqueClaimed = new Set(allClaimed);
    expect(uniqueClaimed.size).toBe(jobCount);
    for (const id of enqueuedIds) {
      expect(uniqueClaimed.has(id)).toBe(true);
    }

    // Queue is completely drained
    expect(ctx.queue.claim('after-race')).toBeNull();
  });
});
