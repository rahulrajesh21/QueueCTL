import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createTestContext } from './helpers/test-db.js';

describe('Validation & Edge Cases', () => {
  let ctx;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('fails gracefully when payload is invalid or command is missing/whitespace', () => {
    expect(() => {
      ctx.queue.enqueue(null);
    }).toThrow('Job payload must be an object');

    expect(() => {
      ctx.queue.enqueue({});
    }).toThrow('Command is required');

    expect(() => {
      ctx.queue.enqueue({ command: '' });
    }).toThrow('Command is required');

    expect(() => {
      ctx.queue.enqueue({ command: '   ' });
    }).toThrow('Command is required');
  });

  it('rejects invalid priority values outside integer range 0-3', () => {
    expect(() => {
      ctx.queue.enqueue({ command: 'test', priority: -1 });
    }).toThrow('Priority must be between 0 (low) and 3 (urgent)');

    expect(() => {
      ctx.queue.enqueue({ command: 'test', priority: 4 });
    }).toThrow('Priority must be between 0 (low) and 3 (urgent)');

    expect(() => {
      ctx.queue.enqueue({ command: 'test', priority: 'high' });
    }).toThrow('Priority must be between 0 (low) and 3 (urgent)');

    expect(() => {
      ctx.queue.enqueue({ command: 'test', priority: 1.5 });
    }).toThrow('Priority must be between 0 (low) and 3 (urgent)');

    expect(() => {
      ctx.queue.enqueue({ command: 'test', priority: Number.NaN });
    }).toThrow('Priority must be between 0 (low) and 3 (urgent)');
  });

  it('supports max_retries = 0 (immediate DLQ on failure) and rejects negative retries or non-positive timeout', () => {
    const noRetryJob = ctx.queue.enqueue({ command: 'echo once', max_retries: 0 });
    expect(noRetryJob.max_retries).toBe(0);

    ctx.queue.fail(noRetryJob.id, new Error('immediate failure'));
    expect(ctx.storage.getJob(noRetryJob.id)).toBeUndefined();
    expect(ctx.storage.getFromDLQ(noRetryJob.id)).toBeDefined();

    expect(() => {
      ctx.queue.enqueue({ command: 'echo bad', max_retries: -1 });
    }).toThrow('max_retries must be a non-negative integer');

    expect(() => {
      ctx.queue.enqueue({ command: 'echo bad', timeout: 0 });
    }).toThrow('timeout must be a positive number');

    expect(() => {
      ctx.queue.enqueue({ command: 'echo bad', timeout: -5 });
    }).toThrow('timeout must be a positive number');
  });

  it('rejects unparseable run_at timestamps and enforces scheduled run_at execution window', () => {
    expect(() => {
      ctx.queue.enqueue({ command: 'test', run_at: 'not-a-valid-date' });
    }).toThrow('Invalid run_at timestamp');

    const futureIso = new Date(Date.now() + 60_000).toISOString();
    const futureJob = ctx.queue.enqueue({ command: 'echo future', run_at: futureIso });
    expect(ctx.queue.claim('scheduler-worker')).toBeNull();

    // Job becomes claimable once current time reaches run_at
    const dueClaim = ctx.storage.claimJobs('scheduler-worker', futureJob.run_at);
    expect(dueClaim).toBeDefined();
    expect(dueClaim.id).toBe(futureJob.id);
  });

  it('throws descriptive errors when operating on non-existent jobs', () => {
    const nonExistentId = '00000000-0000-0000-0000-000000000000';

    expect(() => {
      ctx.queue.fail(nonExistentId, new Error('fail'));
    }).toThrow(`Job ${nonExistentId} not found`);

    expect(() => {
      ctx.queue.complete(nonExistentId, 'output');
    }).toThrow(`Job ${nonExistentId} not found`);

    expect(() => {
      ctx.queue.moveToDLQ(nonExistentId);
    }).toThrow(`Job ${nonExistentId} not found`);

    expect(() => {
      ctx.queue.retryFromDLQ(nonExistentId);
    }).toThrow(`Job ${nonExistentId} not found in DLQ`);
  });

  it('falls back gracefully to default configuration when optional job parameters are omitted', () => {
    ctx.storage.setConfig('max_retries', '4');
    ctx.storage.setConfig('default_timeout', '90');

    const job = ctx.queue.enqueue({ command: 'echo defaults-test' });

    expect(job.max_retries).toBe(4);
    expect(job.timeout).toBe(90);
    expect(job.priority).toBe(0);
    expect(job.state).toBe('pending');
  });
});
