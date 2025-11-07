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
        next_retry_at INTEGER,
        locked_at INTEGER,
        locked_by TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        error TEXT
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
        error TEXT
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
      backoff_base: '2'
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
        id, command, state, attempts, max_retries,
        next_retry_at, locked_at, locked_by,
        created_at, updated_at, completed_at, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        job.error
      )
      return job;
  }

  deleteJob(jobId){
    return this.db.prepare('DELETE FROM jobs WHERE id = ?').run(jobId);
  }

  getJob(jobId){
    return this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId)
  }

  claimJobs(workerId,now){
    return this.db.transaction(()=>{
       const availableJob = this.storage.db.prepare(`
                SELECT * FROM jobs
                WHERE state = 'pending'
                AND (next_retry_at is NULL OR next_retry_at <= ?)
                ORDER BY created_at ASC
                LIMIT 1
                `).get(now)

                if(!availableJob){
                    return null;
                }
                this.storage.db.prepare(`
                    UPDATE jobs
                    SET state = 'processing',
                    locked_by = ?,
                    locked_at = ?,
                    update_at = ?
                    WHERE id = ?
                    `).run(workerId,now,now,availableJob.id);

                    return{
                        ...availableJob,
                        status:'processing',
                        locked_by:workerId,
                        locked_at:now,
                        updated_at:now
                    }
    })();
  }



  insertIntoDLQ(job){
    const stmt = this.db.prepare(`
        INSERT INTO dlq(
         id, command, state, attempts, max_retries,
        next_retry_at, locked_at, locked_by,
        created_at, updated_at, completed_at, error
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        job.error
      );
  }

  listJob(state = null){
    if (state){
      return this.db.prepare('SELECT * FROM jobs WHERE state = ? ORDER BY created_at DESC').all(state);
    }
    return this.db.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all();
  }

  listDLQ(){
    return this.db.prepare('SELECT * FROM dlq ORDER BY updated_at DESC').all();
  }

  getFromDLQ(jobID){
    return this.db.prepare('SELECT * FROM dlq WHERE id = ?').get(jobID);
  }




   

}


export default new Storage();