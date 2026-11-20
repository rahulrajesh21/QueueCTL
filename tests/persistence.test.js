import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createTestContext } from './helpers/test-db.js';
import { Storage } from '../storage/sqlite.js';
import { Queue } from '../core/queue.js';

describe('DURABILITY & Persistence Across Restarts', () => {
  let ctx;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('persists pending jobs and configuration when database connection is closed and reopened', () => {
    // Arrange: Set custom configuration and enqueue jobs
    ctx.storage.setConfig('max_retries', '5');
    ctx.storage.setConfig('backoff_base', '3');

    const job1 = ctx.queue.enqueue({ command: 'echo persistent-1', priority: 1, timeout: 30 });
    const job2 = ctx.queue.enqueue({ command: 'echo persistent-urgent', priority: 3, timeout: 45 });
    const job3 = ctx.queue.enqueue({ command: 'echo persistent-low', priority: 0, timeout: 15 });

    // Verify initial storage has 3 jobs
    expect(ctx.storage.listJob().length).toBe(3);

    // Act: Simulate process shutdown by closing DB connection
    const dbPath = ctx.dbPath;
    ctx.storage.close();

    // Reopen database with a completely fresh Storage and Queue instance
    const reopenedStorage = new Storage(dbPath);
    const reopenedQueue = new Queue(reopenedStorage);

    try {
      // Assert 1: Custom configuration persisted
      expect(reopenedStorage.getConfig('max_retries')).toBe('5');
      expect(reopenedStorage.getConfig('backoff_base')).toBe('3');

      // Assert 2: All 3 jobs persisted durably with identical fields
      const restoredJobs = reopenedStorage.listJob();
      expect(restoredJobs.length).toBe(3);

      const restoredJob2 = reopenedStorage.getJob(job2.id);
      expect(restoredJob2).toBeDefined();
      expect(restoredJob2.command).toBe('echo persistent-urgent');
      expect(restoredJob2.priority).toBe(3);
      expect(restoredJob2.timeout).toBe(45);
      expect(restoredJob2.state).toBe('pending');

      // Assert 3: Queue claiming order is preserved (Urgent priority job claimed first)
      const firstClaim = reopenedQueue.claim('restarted-worker');
      expect(firstClaim.id).toBe(job2.id);
      expect(firstClaim.state).toBe('processing');

      // Act & Assert 4: Job completes cleanly on reopened DB
      reopenedQueue.complete(firstClaim.id, 'reopened output');
      const completed = reopenedStorage.getJob(job2.id);
      expect(completed.state).toBe('completed');
      expect(completed.output).toBe('reopened output');
    } finally {
      reopenedStorage.close();
    }
  });
});
