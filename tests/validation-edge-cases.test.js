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

  it('fails gracefully when command is missing or empty', () => {
    // Arrange & Act & Assert
    expect(() => {
      ctx.queue.enqueue({});
    }).toThrow('Command is required');

    expect(() => {
      ctx.queue.enqueue({ command: '' });
    }).toThrow('Command is required');
  });

  it('rejects invalid priority values outside range 0-3', () => {
    // Arrange & Act & Assert
    expect(() => {
      ctx.queue.enqueue({ command: 'test', priority: -1 });
    }).toThrow('Priority must be between 0 (low) and 3 (urgent)');

    expect(() => {
      ctx.queue.enqueue({ command: 'test', priority: 4 });
    }).toThrow('Priority must be between 0 (low) and 3 (urgent)');
  });

  it('rejects unparseable run_at timestamps', () => {
    // Arrange & Act & Assert
    expect(() => {
      ctx.queue.enqueue({ command: 'test', run_at: 'not-a-valid-date' });
    }).toThrow('Invalid run_at timestamp');
  });

  it('throws descriptive errors when operating on non-existent jobs', () => {
    const nonExistentId = '00000000-0000-0000-0000-000000000000';

    // Act & Assert
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
    // Arrange: Ensure defaults are set
    ctx.storage.setConfig('max_retries', '4');
    ctx.storage.setConfig('default_timeout', '90');

    // Act: Enqueue without specifying max_retries or timeout
    const job = ctx.queue.enqueue({ command: 'echo defaults-test' });

    // Assert: Inherited defaults from DB configuration
    expect(job.max_retries).toBe(4);
    expect(job.timeout).toBe(90);
    expect(job.priority).toBe(0);
    expect(job.state).toBe('pending');
  });
});
