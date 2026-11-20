import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
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

  it('guarantees atomic claims with no duplicate execution across concurrent workers', async () => {
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

    // Act: Concurrently poll and claim jobs until the queue is drained
    const claims = []; // Array of { workerId, jobId }
    const claimPromises = workerClients.map(async ({ workerId, queue }) => {
      let drained = false;
      while (!drained) {
        const job = queue.claim(workerId);
        if (job) {
          claims.push({ workerId, jobId: job.id });
          // Micro-tick yield to simulate realistic async I/O interleaving
          await new Promise(resolve => setImmediate(resolve));
        } else {
          drained = true;
        }
      }
    });

    await Promise.all(claimPromises);

    // Clean up worker connections
    workerClients.forEach(client => {
      try {
        client.storage.close();
      } catch (_) {}
    });

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
});
