import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createTestContext } from './helpers/test-db.js';
import Worker from '../core/worker.js';

describe('Job Lifecycle & Priority', () => {
  let ctx;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('transitions a job cleanly through pending -> processing -> completed via real worker execution', async () => {
    // Arrange: Enqueue a real Node command
    const jobData = {
      command: 'node -e "console.log(\'lifecycle test output\')"',
      priority: 1,
    };

    // Act 1: Enqueue job
    const enqueuedJob = ctx.queue.enqueue(jobData);

    // Assert 1: Job is persisted in SQLite with state 'pending'
    const storedJob = ctx.storage.getJob(enqueuedJob.id);
    expect(storedJob).toBeDefined();
    expect(storedJob.id).toBe(enqueuedJob.id);
    expect(storedJob.state).toBe('pending');
    expect(storedJob.attempts).toBe(0);
    expect(storedJob.locked_by).toBeNull();

    // Act 2: Execute the job end-to-end through Worker
    const workerId = 'test-worker-alpha';
    const worker = new Worker(ctx.queue, null, { workerId, silent: true });
    const { job: claimedJob, result } = await worker.processNextJob();

    // Assert 2: Claim snapshot captured processing state and worker lock
    expect(claimedJob).toBeDefined();
    expect(claimedJob.id).toBe(enqueuedJob.id);
    expect(claimedJob.state).toBe('processing');
    expect(claimedJob.locked_by).toBe(workerId);
    expect(claimedJob.locked_at).toBeGreaterThan(0);
    expect(claimedJob.started_at).toBeGreaterThan(0);

    // Assert 3: Executor succeeded and job transitioned to 'completed' with real captured output
    expect(result.success).toBe(true);
    expect(result.output.trim()).toBe('lifecycle test output');

    const completedJob = ctx.storage.getJob(enqueuedJob.id);
    expect(completedJob.state).toBe('completed');
    expect(completedJob.output.trim()).toBe('lifecycle test output');
    expect(completedJob.started_at).toBeGreaterThan(0);
    expect(completedJob.completed_at).toBeGreaterThanOrEqual(completedJob.started_at);
    expect(completedJob.locked_by).toBeNull();
    expect(completedJob.locked_at).toBeNull();

    // Stats reflect 1 completed, 0 pending, 0 processing
    const stats = ctx.queue.getStats();
    expect(stats.completed).toBe(1);
    expect(stats.pending).toBe(0);
    expect(stats.processing).toBe(0);
  });

  it('claims pending jobs in strict priority order (Urgent > High > Normal > Low)', () => {
    // Arrange: Enqueue 4 jobs with different priorities
    const low = ctx.queue.enqueue({ command: 'echo low', priority: 0 });
    const normal = ctx.queue.enqueue({ command: 'echo normal', priority: 1 });
    const high = ctx.queue.enqueue({ command: 'echo high', priority: 2 });
    const urgent = ctx.queue.enqueue({ command: 'echo urgent', priority: 3 });

    // Act & Assert: Claim jobs sequentially and verify priority ordering & lock metadata
    const firstClaimed = ctx.queue.claim('worker-1');
    expect(firstClaimed.id).toBe(urgent.id);
    expect(firstClaimed.priority).toBe(3);
    expect(firstClaimed.state).toBe('processing');
    expect(firstClaimed.locked_by).toBe('worker-1');

    const secondClaimed = ctx.queue.claim('worker-1');
    expect(secondClaimed.id).toBe(high.id);
    expect(secondClaimed.priority).toBe(2);

    const thirdClaimed = ctx.queue.claim('worker-1');
    expect(thirdClaimed.id).toBe(normal.id);
    expect(thirdClaimed.priority).toBe(1);

    const fourthClaimed = ctx.queue.claim('worker-1');
    expect(fourthClaimed.id).toBe(low.id);
    expect(fourthClaimed.priority).toBe(0);

    // No more jobs left to claim
    const fifthClaimed = ctx.queue.claim('worker-1');
    expect(fifthClaimed).toBeNull();
  });

  it('runs worker polling loop and shuts down gracefully upon calling stop()', async () => {
    // Arrange: Enqueue two jobs
    ctx.queue.enqueue({ command: 'node -e "process.stdout.write(\'work-1\')"' });
    ctx.queue.enqueue({ command: 'node -e "process.stdout.write(\'work-2\')"' });

    const worker = new Worker(ctx.queue, null, {
      workerId: 'worker-loop-test',
      pollInterval: 20,
      silent: true,
    });

    // Act: Start worker in background and guarantee stop() in finally
    const startPromise = worker.start();
    try {
      let attempts = 0;
      while (ctx.queue.getStats().completed < 2 && attempts < 100) {
        await new Promise(r => setTimeout(r, 50));
        attempts++;
      }
    } finally {
      worker.stop();
      await startPromise;
    }

    // Assert: Both jobs completed and worker loop stopped cleanly
    const stats = ctx.queue.getStats();
    expect(stats.completed).toBe(2);
    expect(stats.pending).toBe(0);
  });

  it('calculates actual execution time (not queue wait) and includes DLQ jobs in retry metrics', async () => {
    // Arrange: Enqueue job, wait in queue briefly, then claim and execute with measurable duration
    const job1 = ctx.queue.enqueue({ command: 'echo m1' });
    await new Promise(r => setTimeout(r, 80)); // Queue wait time should NOT inflate execution time

    const claimed = ctx.queue.claim('metric-worker');
    await new Promise(r => setTimeout(r, 30)); // Actual execution time ~30ms
    ctx.queue.complete(claimed.id, 'm1 done');

    // Create 1 active failed job (1 retry) and 1 DLQ job (2 retries)
    const job2 = ctx.queue.enqueue({ command: 'echo m2', max_retries: 3 });
    ctx.queue.fail(job2.id, new Error('transient failure'));

    const job3 = ctx.queue.enqueue({ command: 'echo m3', max_retries: 2 });
    ctx.queue.fail(job3.id, new Error('attempt 1'));
    ctx.queue.fail(job3.id, new Error('attempt 2 -> dlq'));

    // Act: Compute metrics
    const metrics = ctx.queue.getMetrics();

    // Assert: Execution time reflects ~30ms execution (strictly > 0 and < queue+exec wait)
    expect(metrics.avgExecutionTime).toBeGreaterThan(0.015);
    expect(metrics.avgExecutionTime).toBeLessThan(0.08);
    expect(metrics.minExecutionTime).toBe(metrics.avgExecutionTime);
    expect(metrics.maxExecutionTime).toBe(metrics.avgExecutionTime);

    // Assert: Retry metrics include both active failed jobs and DLQ jobs
    expect(metrics.jobsWithRetries).toBe(2);
    expect(metrics.totalRetries).toBe(3);
  });
});
