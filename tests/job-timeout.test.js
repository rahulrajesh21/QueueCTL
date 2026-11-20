import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
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

  it('terminates long-running process tree and prevents orphaned execution after timeout', async () => {
    // Arrange: Child process would write a marker file after 900ms, but timeout is 0.4s (400ms)
    const executor = new Executor();
    const markerFile = join(ctx.tempDir, 'should-not-exist.txt');
    const safePath = markerFile.replace(/\\/g, '/').replace(/'/g, "\\'");
    const command = `node -e "const fs = require('node:fs'); setTimeout(() => fs.writeFileSync('${safePath}', 'orphaned'), 900)"`;
    const timeoutSeconds = 0.4;

    // Act: Run through executor
    const start = Date.now();
    const result = await executor.run(command, timeoutSeconds, { silent: true });
    const duration = Date.now() - start;

    // Assert: Execution terminated quickly with timeout error
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error.message).toContain(`Command timeout after ${timeoutSeconds}`);
    expect(duration).toBeGreaterThanOrEqual(350);
    expect(duration).toBeLessThan(2000);

    // Wait well past the child's original 900ms timer to prove the grandchild process was actually killed
    await new Promise(r => setTimeout(r, 750));
    expect(existsSync(markerFile)).toBe(false);
  });

  it('worker terminates timed-out job and transitions state to DLQ when max_retries reached', async () => {
    // Arrange: Enqueue job with 0.5 second timeout and max_retries = 1
    const job = ctx.queue.enqueue({
      command: 'node -e "setTimeout(() => {}, 5000)"',
      timeout: 0.5,
      max_retries: 1,
    });

    const worker = new Worker(ctx.queue, null, { workerId: 'timeout-worker', silent: true });

    // Act: Process the job through worker
    const { job: processedJob, result } = await worker.processNextJob();

    // Assert: Worker marked job failed due to timeout
    expect(processedJob.id).toBe(job.id);
    expect(result.success).toBe(false);
    expect(result.error.message).toContain('Command timeout after 0.5');

    // Since max_retries was 1 and attempts reached 1, job is isolated into DLQ
    const dlqJob = ctx.storage.getFromDLQ(job.id);
    expect(dlqJob).toBeDefined();
    expect(dlqJob.state).toBe('dead');
    expect(dlqJob.error).toContain('Command timeout after 0.5');
  });
});
