import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Storage } from '../../storage/sqlite.js';
import { Queue } from '../../core/queue.js';

export function createTestContext() {
  const tempDir = mkdtempSync(join(tmpdir(), 'queuectl-test-'));
  const dbPath = join(tempDir, 'test.db');
  
  // Track previous environment to restore on cleanup
  const prevDataDir = process.env.QUEUECTL_DATA_DIR;
  const prevDbPath = process.env.QUEUECTL_DB_PATH;
  const prevNodeEnv = process.env.NODE_ENV;

  process.env.QUEUECTL_DATA_DIR = tempDir;
  process.env.QUEUECTL_DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';

  const storage = new Storage(dbPath);
  const queue = new Queue(storage);

  const cleanup = () => {
    try {
      storage.close();
    } catch (_) {
      // Ignored if already closed
    }

    try {
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (_) {
      // Ignored
    }

    if (prevDataDir !== undefined) {
      process.env.QUEUECTL_DATA_DIR = prevDataDir;
    } else {
      delete process.env.QUEUECTL_DATA_DIR;
    }

    if (prevDbPath !== undefined) {
      process.env.QUEUECTL_DB_PATH = prevDbPath;
    } else {
      delete process.env.QUEUECTL_DB_PATH;
    }

    if (prevNodeEnv !== undefined) {
      process.env.NODE_ENV = prevNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
  };

  return { tempDir, dbPath, storage, queue, cleanup };
}
