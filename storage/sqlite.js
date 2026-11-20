import Database from "better-sqlite3";
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from "node:path";
import { homedir } from 'node:os';

class Storage{
    constructor(dbPath){
        // Use environment variable or default to home directory
        if (!dbPath) {
            if (process.env.QUEUECTL_DB_PATH) {
                dbPath = process.env.QUEUECTL_DB_PATH;
            } else {
                const dataDir = process.env.QUEUECTL_DATA_DIR || join(homedir(), '.queuectl');
                dbPath = join(dataDir, 'queuectl.db');
            }
        }
        
        const dir = dirname(dbPath);
        if(!existsSync(dir)){
            mkdirSync(dir,{recursive:true});
        }

        this.dbPath = dbPath;
        this.db  = new Database(dbPath)
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('busy_timeout = 5000');
        this.init();
    }

    init(){
        this.db.exec(`
        CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        command TEXT NOT NULL,
        state TEXT NOT NULL,
        priority INTEGER DEFAULT 0,
        attempts INTEGER DEFAULT 0,
        max_retries INTEGER DEFAULT 3,
        timeout INTEGER DEFAULT 60,
        next_retry_at INTEGER,
        run_at INTEGER,
        started_at INTEGER,
        locked_at INTEGER,
        locked_by TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        error TEXT,
        output TEXT
      )
            `)
        
        this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_jobs_priority 
        ON jobs(state, priority DESC, created_at ASC)
        `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS dlq (
        id TEXT PRIMARY KEY,
        command TEXT NOT NULL,
        state TEXT NOT NULL,
        priority INTEGER DEFAULT 0,
        attempts INTEGER DEFAULT 0,
        max_retries INTEGER DEFAULT 3,
        timeout INTEGER DEFAULT 60,
        next_retry_at INTEGER,
        run_at INTEGER,
        locked_at INTEGER,
        locked_by TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        error TEXT,
        output TEXT 
  )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    this.ensureColumn('jobs', 'started_at', 'INTEGER');
    this.ensureColumn('dlq', 'priority', 'INTEGER DEFAULT 0');
    this.ensureColumn('dlq', 'timeout', 'INTEGER DEFAULT 60');
    this.ensureColumn('dlq', 'run_at', 'INTEGER');

    this.setDefaultConfig();
    }

    ensureColumn(table, column, definition) {
      const columns = this.db.prepare(`PRAGMA table_info(${table})`).all();
      if (!columns.some(col => col.name === column)) {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      }
    }

    setDefaultConfig() {
    const defaults = {
      max_retries: '3',
      backoff_base: '2',
      default_timeout: '60' 
    };
    
    for (const [key, value] of Object.entries(defaults)) {
      const existing = this.db.prepare('SELECT value FROM config WHERE key = ?').get(key);
      if (!existing) {
        this.db.prepare('INSERT INTO config (key, value) VALUES (?, ?)').run(key, value);
      }
    }
  }


  insertJob(job){
    const stmt = this.db.prepare(`
      INSERT INTO jobs (
        id, command, state, priority, attempts, max_retries, timeout,
        next_retry_at, run_at, started_at, locked_at, locked_by,
        created_at, updated_at, completed_at, error, output
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        job.id,
        job.command,
        job.state,
        job.priority ?? 0,
        job.attempts,
        job.max_retries,
        job.timeout ?? 60,
        job.next_retry_at ?? null,
        job.run_at ?? null,
        job.started_at ?? null,
        job.locked_at ?? null,
        job.locked_by ?? null,
        job.created_at,
        job.updated_at,
        job.completed_at ?? null,
        job.error ?? null,
        job.output ?? null
      );
      return job;
  }

  updateJob(job){
    const stmt = this.db.prepare(`
      UPDATE jobs
      SET command = ?,
          state = ?,
          priority = ?,
          attempts = ?,
          max_retries = ?,
          timeout = ?,
          next_retry_at = ?,
          run_at = ?,
          started_at = ?,
          locked_at = ?,
          locked_by = ?,
          created_at = ?,
          updated_at = ?,
          completed_at = ?,
          error = ?,
          output = ?
      WHERE id = ?
    `);

    stmt.run(
      job.command,
      job.state,
      job.priority ?? 0,
      job.attempts,
      job.max_retries,
      job.timeout ?? 60,
      job.next_retry_at ?? null,
      job.run_at ?? null,
      job.started_at ?? null,
      job.locked_at ?? null,
      job.locked_by ?? null,
      job.created_at,
      job.updated_at,
      job.completed_at ?? null,
      job.error ?? null,
      job.output ?? null,
      job.id
    );
    return job;
  }

  deleteJob(jobId){
    return this.db.prepare('DELETE FROM jobs WHERE id = ?').run(jobId);
  }

  getJob(jobId){
    return this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId)
  }

  claimJobs(workerId, now){
    return this.db.transaction(() => {
       const availableJob = this.db.prepare(`
                SELECT * FROM jobs
                WHERE (state = 'pending' OR state = 'failed')
                AND (next_retry_at IS NULL OR next_retry_at <= ?)
                AND (run_at IS NULL OR run_at <= ?)
                ORDER BY priority DESC, created_at ASC
                LIMIT 1
                `).get(now,now);

                if (!availableJob) {
                    return null;
                }
                
                this.db.prepare(`
                    UPDATE jobs
                    SET state = 'processing',
                        started_at = ?,
                        locked_by = ?,
                        locked_at = ?,
                        updated_at = ?
                    WHERE id = ?
                    `).run(now, workerId, now, now, availableJob.id);

                    return {
                        ...availableJob,
                        state: 'processing',
                        started_at: now,
                        locked_by: workerId,
                        locked_at: now,
                        updated_at: now
                    };
    }).immediate();
  }



  insertIntoDLQ(job){
    const stmt = this.db.prepare(`
        INSERT INTO dlq(
         id, command, state, priority, attempts, max_retries, timeout,
        next_retry_at, run_at, locked_at, locked_by,
        created_at, updated_at, completed_at, error, output
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        job.id,
        job.command,
        job.state,
        job.priority ?? 0,
        job.attempts,
        job.max_retries,
        job.timeout ?? 60,
        job.next_retry_at ?? null,
        job.run_at ?? null,
        job.locked_at ?? null,
        job.locked_by ?? null,
        job.created_at,
        job.updated_at,
        job.completed_at ?? null,
        job.error ?? null,
        job.output ?? null
      );
  }

  moveJobToDLQ(deadJob){
    return this.db.transaction(() => {
      this.insertIntoDLQ(deadJob);
      this.deleteJob(deadJob.id);
      return deadJob;
    }).immediate();
  }

  requeueFromDLQ(retriedJob){
    return this.db.transaction(() => {
      this.insertJob(retriedJob);
      this.deleteFromDLQ(retriedJob.id);
      return retriedJob;
    }).immediate();
  }

  listJob(state = null){
    if(state === 'dead'){
      return this.db.prepare('SELECT * FROM dlq ORDER BY updated_at DESC').all();
    }else if (state) {
      return this.db.prepare('SELECT * FROM jobs WHERE state = ? ORDER BY created_at DESC').all(state);
    }else{
      return this.db.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all();
    }
  }

  listDLQ(){
    return this.db.prepare('SELECT * FROM dlq ORDER BY updated_at DESC').all();
  }

  getFromDLQ(jobID){
    return this.db.prepare('SELECT * FROM dlq WHERE id = ?').get(jobID);
  }

  deleteFromDLQ(jobId) {
    return this.db.prepare('DELETE FROM dlq WHERE id = ?').run(jobId);
  }

  getConfig(key) {
    const row = this.db.prepare('SELECT value FROM config WHERE key = ?').get(key);
    return row ? row.value : null;
  }

  setConfig(key, value) {
    this.db.prepare(`
      INSERT INTO config (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = ?
    `).run(key, value, value);
  }

  getAllConfig() {
    const rows = this.db.prepare('SELECT key, value FROM config').all();
    const config = {};
    rows.forEach(row => {
      config[row.key] = row.value;
    });
    return config;
  }

  close() {
    this.db.close();
  }
}

let defaultStorage = null;

export function getDefaultStorage() {
  if (!defaultStorage) {
    defaultStorage = new Storage();
  }
  return defaultStorage;
}

const lazyStorage = new Proxy({}, {
  get(target, prop) {
    const instance = getDefaultStorage();
    const value = instance[prop];
    if (typeof value === 'function') {
      return value.bind(instance);
    }
    return value;
  },
  set(target, prop, value) {
    const instance = getDefaultStorage();
    instance[prop] = value;
    return true;
  }
});

export { Storage };
export default lazyStorage;