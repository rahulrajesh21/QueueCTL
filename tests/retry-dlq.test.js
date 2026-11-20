import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createTestContext } from './helpers/test-db.js';
import { calculateBackoff } from '../core/retry.js';

describe('Exponential Backoff, DLQ & Recovery', () => {
  let ctx;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('increments attempt count and applies exponential backoff delays on failure', () => {
    // Arrange: Configure backoff_base = 2 and max_retries = 3
    ctx.storage.setConfig('backoff_base', '2');
    const job = ctx.queue.enqueue({ command: 'failing-command', max_retries: 3 });
    const startTime = Date.now();

    // Act: Fail first attempt
    const failedAttempt1 = ctx.queue.fail(job.id, new Error('Network timeout'), 'stderr output');

    // Assert: Attempt count is 1, state is 'failed', and retry delay matches 2^1 * 1000 = 2000ms
    expect(failedAttempt1.attempts).toBe(1);
    expect(failedAttempt1.state).toBe('failed');
    expect(failedAttempt1.error).toBe('Network timeout');
    expect(failedAttempt1.output).toBe('stderr output');
    const expectedDelay1 = calculateBackoff(1, 2); // 2000ms
    expect(failedAttempt1.next_retry_at).toBeGreaterThanOrEqual(startTime + expectedDelay1 - 50);
    expect(failedAttempt1.next_retry_at).toBeLessThanOrEqual(startTime + expectedDelay1 + 2000);

    // Verify worker cannot claim before next_retry_at
    const prematureClaim = ctx.queue.claim('worker-1');
    expect(prematureClaim).toBeNull();

    // Act 2: Fail second attempt
    const failedAttempt2 = ctx.queue.fail(job.id, new Error('Database connection refused'));

    // Assert 2: Attempt count is 2, retry delay is 2^2 * 1000 = 4000ms
    expect(failedAttempt2.attempts).toBe(2);
    expect(failedAttempt2.state).toBe('failed');
    const expectedDelay2 = calculateBackoff(2, 2); // 4000ms
    expect(failedAttempt2.next_retry_at).toBeGreaterThanOrEqual(startTime + expectedDelay2 - 50);
  });

  it('moves jobs exceeding max retries to Dead Letter Queue (DLQ) with error metadata', () => {
    // Arrange: Enqueue job with max_retries = 2
    const job = ctx.queue.enqueue({ command: 'exit 1', max_retries: 2 });

    // Act: Fail attempt 1
    ctx.queue.fail(job.id, new Error('First attempt failed'));
    expect(ctx.storage.getJob(job.id)).toBeDefined();
    expect(ctx.storage.getFromDLQ(job.id)).toBeUndefined();

    // Act: Fail attempt 2 (reaches max_retries: 2)
    const deadJob = ctx.queue.fail(job.id, new Error('Second attempt failed - moving to DLQ'), 'fatal error trace');

    // Assert: Job is removed from active jobs table and exists in DLQ
    expect(ctx.storage.getJob(job.id)).toBeUndefined();

    const dlqJob = ctx.storage.getFromDLQ(job.id);
    expect(dlqJob).toBeDefined();
    expect(dlqJob.id).toBe(job.id);
    expect(dlqJob.state).toBe('dead');
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

  it('recovers and replays a dead job from DLQ, allowing clean execution to completion', async () => {
    // Arrange: Create a job that ended up in DLQ
    const job = ctx.queue.enqueue({ command: 'echo "recovered successfully"', max_retries: 1 });
    ctx.queue.fail(job.id, new Error('Initial transient error'));

    // Verify it is in DLQ
    expect(ctx.storage.getFromDLQ(job.id)).toBeDefined();
    expect(ctx.storage.getJob(job.id)).toBeUndefined();

    // Act: Requeue / replay from DLQ
    const recoveredJob = ctx.queue.retryFromDLQ(job.id);

    // Assert: Removed from DLQ, back in active queue in 'pending' state with reset attempts
    expect(ctx.storage.getFromDLQ(job.id)).toBeUndefined();
    expect(recoveredJob.id).toBe(job.id);
    expect(recoveredJob.state).toBe('pending');
    expect(recoveredJob.attempts).toBe(0);
    expect(recoveredJob.error).toBeNull();

    // Claim and complete the recovered job
    const claimed = ctx.queue.claim('recovery-worker');
    expect(claimed.id).toBe(job.id);
    expect(claimed.state).toBe('processing');

    ctx.queue.complete(claimed.id, 'recovered successfully\n');

    const completed = ctx.storage.getJob(job.id);
    expect(completed.state).toBe('completed');
    expect(completed.output).toBe('recovered successfully\n');
  });
});
