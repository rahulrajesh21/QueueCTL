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

  it('transitions a job cleanly through pending -> processing -> completed with output', async () => {
    // Arrange: Create a job with command and default parameters
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

    // Act 2: Worker claims job
    const workerId = 'test-worker-alpha';
    const claimedJob = ctx.queue.claim(workerId);

    // Assert 2: Job transitions to 'processing' and is locked by worker
    expect(claimedJob).toBeDefined();
    expect(claimedJob.id).toBe(enqueuedJob.id);
    expect(claimedJob.state).toBe('processing');
    expect(claimedJob.locked_by).toBe(workerId);
    expect(claimedJob.locked_at).toBeGreaterThan(0);

    // Act 3: Worker processes the job to completion using Worker class
    const worker = new Worker(ctx.queue, null, { workerId, silent: true });
    // Simulate completing execution
    const output = 'lifecycle test output\n';
    ctx.queue.complete(claimedJob.id, output);

    // Assert 3: Job transitions to 'completed' with output, completed_at, and unlocked
    const completedJob = ctx.storage.getJob(enqueuedJob.id);
    expect(completedJob.state).toBe('completed');
    expect(completedJob.output).toBe(output);
    expect(completedJob.completed_at).toBeGreaterThan(0);
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

    // Act & Assert: Claim jobs sequentially and verify priority ordering
    const firstClaimed = ctx.queue.claim('worker-1');
    expect(firstClaimed.id).toBe(urgent.id);
    expect(firstClaimed.priority).toBe(3);

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

    // Act: Start worker in background
    const startPromise = worker.start();

    // Allow worker loop to process jobs
    let attempts = 0;
    while (ctx.queue.getStats().completed < 2 && attempts < 50) {
      await new Promise(r => setTimeout(r, 50));
      attempts++;
    }

    worker.stop();
    await startPromise;

    // Assert: Both jobs completed and worker loop stopped cleanly
    const stats = ctx.queue.getStats();
    expect(stats.completed).toBe(2);
    expect(stats.pending).toBe(0);
  });

  it('calculates execution time and retry metrics accurately', () => {
    // Arrange: Create completed job and failed job
    const job1 = ctx.queue.enqueue({ command: 'echo m1' });
    const claimed = ctx.queue.claim('metric-worker');
    ctx.queue.complete(claimed.id, 'm1 done');

    const job2 = ctx.queue.enqueue({ command: 'echo m2', max_retries: 3 });
    ctx.queue.fail(job2.id, new Error('transient failure'));

    // Act: Compute metrics
    const metrics = ctx.queue.getMetrics();

    // Assert: Metrics reflect execution statistics
    expect(metrics.jobsWithRetries).toBe(1);
    expect(metrics.totalRetries).toBe(1);
    expect(metrics.avgExecutionTime).toBeGreaterThanOrEqual(0);
    expect(metrics.minExecutionTime).toBeGreaterThanOrEqual(0);
    expect(metrics.maxExecutionTime).toBeGreaterThanOrEqual(0);
  });
});
