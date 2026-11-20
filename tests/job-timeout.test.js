import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createTestContext } from './helpers/test-db.js';
import { Executor } from '../core/executor.js';
import Worker from '../core/worker.js';

describe('Job Timeouts', () => {
  let ctx;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('terminates long-running process and reports failure when exceeding timeout', async () => {
    // Arrange: Command that takes 5 seconds, but timeout is set to 1 second
    const executor = new Executor();
    const command = 'node -e "setTimeout(() => {}, 5000)"';
    const timeoutSeconds = 1;

    // Act: Run through executor
    const start = Date.now();
    const result = await executor.run(command, timeoutSeconds, { silent: true });
    const duration = Date.now() - start;

    // Assert: Execution terminated well before the 5000ms sleep, returning timeout failure
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error.message).toContain(`Command timeout after ${timeoutSeconds}`);
    expect(duration).toBeGreaterThanOrEqual(950);
    expect(duration).toBeLessThan(3500);
  });

  it('worker terminates timed-out job and transitions state to failed or DLQ', async () => {
    // Arrange: Enqueue job with 1 second timeout and max_retries = 1
    const job = ctx.queue.enqueue({
      command: 'node -e "setTimeout(() => {}, 5000)"',
      timeout: 1,
      max_retries: 1,
    });

    const worker = new Worker(ctx.queue, null, { workerId: 'timeout-worker', silent: true });

    // Act: Process the job through worker
    const { job: processedJob, result } = await worker.processNextJob();

    // Assert: Worker marked job failed due to timeout
    expect(processedJob.id).toBe(job.id);
    expect(result.success).toBe(false);
    expect(result.error.message).toContain('Command timeout after 1');

    // Since max_retries was 1 and attempts reached 1, job is isolated into DLQ
    const dlqJob = ctx.storage.getFromDLQ(job.id);
    expect(dlqJob).toBeDefined();
    expect(dlqJob.state).toBe('dead');
    expect(dlqJob.error).toContain('Command timeout after 1');
  });
});
