import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createTestContext } from './helpers/test-db.js';
import { calculateBackoff } from '../core/retry.js';
import Worker from '../core/worker.js';

describe('Exponential Backoff, DLQ & Recovery', () => {
  let ctx;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('increments attempt count, applies exponential backoff delays, and becomes claimable once delay elapses', () => {
    // Arrange: Configure backoff_base = 2 and max_retries = 3
    ctx.storage.setConfig('backoff_base', '2');
    const job = ctx.queue.enqueue({ command: 'failing-command', max_retries: 3 });

    // Act 1: Claim and fail first attempt
    ctx.queue.claim('worker-1');
    const beforeAttempt1 = Date.now();
    const failedAttempt1 = ctx.queue.fail(job.id, new Error('Network timeout'), 'stderr output');
    const afterAttempt1 = Date.now();

    // Assert 1: Attempt count is 1, state is 'failed', and retry delay matches 2^1 * 1000 = 2000ms
    expect(failedAttempt1.attempts).toBe(1);
    expect(failedAttempt1.state).toBe('failed');
    expect(failedAttempt1.error).toBe('Network timeout');
    expect(failedAttempt1.output).toBe('stderr output');
    const expectedDelay1 = calculateBackoff(1, 2); // 2000ms
    expect(failedAttempt1.next_retry_at).toBeGreaterThanOrEqual(beforeAttempt1 + expectedDelay1);
    expect(failedAttempt1.next_retry_at).toBeLessThanOrEqual(afterAttempt1 + expectedDelay1);

    // Verify worker cannot claim before next_retry_at
    expect(ctx.queue.claim('worker-1')).toBeNull();
    expect(ctx.storage.claimJobs('worker-1', failedAttempt1.next_retry_at - 1)).toBeNull();

    // Verify job becomes claimable once next_retry_at has elapsed
    const reclaimed = ctx.storage.claimJobs('worker-1', failedAttempt1.next_retry_at);
    expect(reclaimed).toBeDefined();
    expect(reclaimed.id).toBe(job.id);
    expect(reclaimed.state).toBe('processing');

    // Act 2: Fail second attempt
    const beforeAttempt2 = Date.now();
    const failedAttempt2 = ctx.queue.fail(job.id, new Error('Database connection refused'));
    const afterAttempt2 = Date.now();

    // Assert 2: Attempt count is 2, retry delay is 2^2 * 1000 = 4000ms
    expect(failedAttempt2.attempts).toBe(2);
    expect(failedAttempt2.state).toBe('failed');
    const expectedDelay2 = calculateBackoff(2, 2); // 4000ms
    expect(failedAttempt2.next_retry_at).toBeGreaterThanOrEqual(beforeAttempt2 + expectedDelay2);
    expect(failedAttempt2.next_retry_at).toBeLessThanOrEqual(afterAttempt2 + expectedDelay2);
  });

  it('moves jobs exceeding max retries to Dead Letter Queue (DLQ) with full metadata', () => {
    // Arrange: Enqueue job with custom priority, timeout, and max_retries = 2
    const job = ctx.queue.enqueue({
      command: 'exit 1',
      priority: 2,
      timeout: 25,
      max_retries: 2,
    });

    // Act: Fail attempt 1
    ctx.queue.fail(job.id, new Error('First attempt failed'));
    expect(ctx.storage.getJob(job.id)).toBeDefined();
    expect(ctx.storage.getFromDLQ(job.id)).toBeUndefined();

    // Act: Fail attempt 2 (reaches max_retries: 2)
    ctx.queue.fail(job.id, new Error('Second attempt failed - moving to DLQ'), 'fatal error trace');

    // Assert: Job is removed from active jobs table and exists in DLQ with preserved metadata
    expect(ctx.storage.getJob(job.id)).toBeUndefined();

    const dlqJob = ctx.storage.getFromDLQ(job.id);
    expect(dlqJob).toBeDefined();
    expect(dlqJob.id).toBe(job.id);
    expect(dlqJob.state).toBe('dead');
    expect(dlqJob.priority).toBe(2);
    expect(dlqJob.timeout).toBe(25);
    expect(dlqJob.attempts).toBe(2);
    expect(dlqJob.max_retries).toBe(2);
    expect(dlqJob.error).toBe('Second attempt failed - moving to DLQ');
    expect(dlqJob.output).toBe('fatal error trace');
    expect(dlqJob.locked_by).toBeNull();
    expect(dlqJob.next_retry_at).toBeNull();

    // Stats reflect 1 dead job, 0 pending, 0 failed
    const stats = ctx.queue.getStats();
    expect(stats.dead).toBe(1);
    expect(stats.pending).toBe(0);
    expect(stats.failed).toBe(0);
  });

  it('recovers and replays a dead job from DLQ and executes it cleanly through Worker', async () => {
    // Arrange: Create a real command job with custom priority & timeout that ends up in DLQ
    const job = ctx.queue.enqueue({
      command: 'node -e "console.log(\'recovered successfully\')"',
      priority: 2,
      timeout: 10,
      max_retries: 1,
    });
    ctx.queue.fail(job.id, new Error('Initial transient error'));

    // Verify it is in DLQ
    expect(ctx.storage.getFromDLQ(job.id)).toBeDefined();
    expect(ctx.storage.getJob(job.id)).toBeUndefined();

    // Act: Requeue / replay from DLQ
    const recoveredJob = ctx.queue.retryFromDLQ(job.id);

    // Assert: Removed from DLQ, back in active queue with reset attempts & preserved priority/timeout
    expect(ctx.storage.getFromDLQ(job.id)).toBeUndefined();
    expect(recoveredJob.id).toBe(job.id);
    expect(recoveredJob.state).toBe('pending');
    expect(recoveredJob.attempts).toBe(0);
    expect(recoveredJob.priority).toBe(2);
    expect(recoveredJob.timeout).toBe(10);
    expect(recoveredJob.error).toBeNull();

    // Act 2: Execute recovered job via real Worker (verifies timeout is NOT null / 0ms)
    const worker = new Worker(ctx.queue, null, { workerId: 'recovery-worker', silent: true });
    const { job: processedJob, result } = await worker.processNextJob();

    // Assert 2: Job ran to completion with captured output
    expect(processedJob.id).toBe(job.id);
    expect(result.success).toBe(true);
    expect(result.output.trim()).toBe('recovered successfully');

    const completed = ctx.storage.getJob(job.id);
    expect(completed.state).toBe('completed');
    expect(completed.output.trim()).toBe('recovered successfully');
  });
});
