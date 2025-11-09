import Database from "better-sqlite3";
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from "node:path";

class Storage{
    constructor(dbPath='./data/queuectl.db'){
        const dir = dirname(dbPath);
        if(!existsSync(dir)){
            mkdirSync(dir,{recursive:true});
        }

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
            `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS dlq (
        id TEXT PRIMARY KEY,
        command TEXT NOT NULL,
        state TEXT NOT NULL,
        attempts INTEGER DEFAULT 0,
        max_retries INTEGER DEFAULT 3,
        next_retry_at INTEGER,
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
    this.setDefaultConfig();
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
        id, command, state, attempts, max_retries, timeout,
        next_retry_at, run_at, locked_at, locked_by,
        created_at, updated_at, completed_at, error, output
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        job.id,
        job.command,
        job.state,
        job.attempts,
        job.max_retries,
        job.timeout, 
        job.next_retry_at,
        job.run_at,
        job.locked_at,
        job.locked_by,
        job.created_at,
        job.updated_at,
        job.completed_at,
        job.error,
        job.output || null
      )
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
                ORDER BY created_at ASC
                LIMIT 1
                `).get(now,now);

                if (!availableJob) {
                    return null;
                }
                
                this.db.prepare(`
                    UPDATE jobs
                    SET state = 'processing',
                        locked_by = ?,
                        locked_at = ?,
                        updated_at = ?
                    WHERE id = ?
                    `).run(workerId, now, now, availableJob.id);

                    return {
                        ...availableJob,
                        state: 'processing',
                        locked_by: workerId,
                        locked_at: now,
                        updated_at: now
                    };
    })();
  }



  insertIntoDLQ(job){
    const stmt = this.db.prepare(`
        INSERT INTO dlq(
         id, command, state, attempts, max_retries,
        next_retry_at, locked_at, locked_by,
        created_at, updated_at, completed_at, error, output
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        job.id,
        job.command,
        job.state,
        job.attempts,
        job.max_retries,
        job.next_retry_at,
        job.locked_at,
        job.locked_by,
        job.created_at,
        job.updated_at,
        job.completed_at,
        job.error,
        job.output || null
      );
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


export default new Storage();