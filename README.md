# QueueCTL

A production-grade CLI-based background job queue system with retry logic, Dead Letter Queue (DLQ) support, and web monitoring dashboard.

## Features

### Core Features
- **Background Job Processing** - Execute shell commands asynchronously
- **Multiple Workers** - Run concurrent workers for parallel processing
- **Automatic Retry** - Exponential backoff retry mechanism
- **Dead Letter Queue** - Permanent storage for failed jobs
- **Persistent Storage** - SQLite database with WAL mode
- **Graceful Shutdown** - Workers finish current jobs before exiting
- **Configuration Management** - Configurable retry and backoff settings

### Bonus Features
- **Job Timeout Handling** - Configurable timeout per job
- **Scheduled Jobs** - Delayed job execution with `run_at`
- **Output Logging** - Capture and view job stdout/stderr
- **Web Dashboard** - Real-time monitoring interface

## Installation

### Prerequisites
- Node.js 18+ 
- npm or yarn

### Setup
```bash
# Clone the repository
git clone <your-repo-url>
cd queuectl

# Install dependencies
npm install

# Make CLI executable (optional)
npm link
```

## Usage

### Basic Commands

#### 1. Enqueue a Job
```bash
# Simple command
node index.js enqueue '{"command":"echo Hello World"}'

# With custom retry settings
node index.js enqueue '{"command":"sleep 2","max_retries":5,"timeout":10}'

# Scheduled job (delayed execution)
node index.js enqueue '{"command":"echo Delayed","run_at":"2025-11-10T10:00:00Z"}'
```

#### 2. Start Workers
```bash
# Start single worker (foreground)
node index.js worker start

# Start multiple workers (background)
node index.js worker start --count 3

# Stop all workers
node index.js worker stop
```

#### 3. Check Status
```bash
node index.js status
```
**Output:**
```
Queue Status

Jobs:
  Pending:     5
  Processing:  2
  Completed:   10
  Failed:      1
  Dead (DLQ):  0
  ─────────────────────
  Total:       18
```

#### 4. List Jobs
```bash
# List all jobs
node index.js list

# Filter by state
node index.js list --state pending
node index.js list --state completed
node index.js list --state failed
```

#### 5. View Job Output
```bash
node index.js logs <job-id>
```
**Output:**
```
Job: abc-123-def
Command: echo Hello World
State: completed

--- Output ---
Hello World
--- End ---
```

#### 6. Manage Dead Letter Queue
```bash
# List failed jobs in DLQ
node index.js dlq list

# Retry a job from DLQ
node index.js dlq retry <job-id>
```

#### 7. Configuration
```bash
# Set configuration
node index.js config set max-retries 5
node index.js config set backoff-base 2
node index.js config set default-timeout 60

# Get configuration
node index.js config get max-retries

# List all configuration
node index.js config list
```

### Web Dashboard

Start the web monitoring dashboard:
```bash
node web/server.js
```
Then open http://localhost:3000 in your browser.

**Features:**
- Real-time job statistics
- Job list with filtering
- DLQ management
- Auto-refresh every 5 seconds

## Architecture

### System Overview
```
┌─────────────┐
│   CLI       │  ← User Interface
└──────┬──────┘
       │
┌──────▼──────┐
│   Queue     │  ← Business Logic
│  (Core)     │
└──────┬──────┘
       │
┌──────▼──────┐
│  Storage    │  ← SQLite Database
│  (SQLite)   │
└─────────────┘

┌─────────────┐
│  Worker 1   │  ← Background Processes
├─────────────┤
│  Worker 2   │
├─────────────┤
│  Worker N   │
└─────────────┘
```

### Job Lifecycle
```
pending → processing → completed
   ↓           ↓
   └─→ failed ─┘
        ↓ (retry with backoff)
        ↓ (max_retries exceeded)
        ↓
      dead (DLQ)
```

### Directory Structure
```
queuectl/
├── cli/
│   └── commands/        # CLI command implementations
│       ├── enqueue.js
│       ├── worker.js
│       ├── status.js
│       ├── list.js
│       ├── dlq.js
│       ├── config.js
│       └── logs.js
├── core/
│   ├── queue.js         # Queue management logic
│   ├── worker.js        # Worker implementation
│   ├── executor.js      # Job execution engine
│   ├── retry.js         # Retry & backoff logic
│   └── worker-process.js
├── storage/
│   └── sqlite.js        # Database layer
├── web/
│   ├── server.js        # Web dashboard server
│   └── public/          # Frontend assets
├── data/                # SQLite database (auto-created)
├── index.js             # CLI entry point
├── test.sh              # Test suite
└── package.json
```

### Key Components

#### 1. Queue (core/queue.js)
- Job enqueueing and state management
- Claim mechanism for worker coordination
- Retry logic with exponential backoff
- DLQ management

#### 2. Worker (core/worker.js)
- Claims and processes jobs
- Handles graceful shutdown
- Reports job success/failure

#### 3. Executor (core/executor.js)
- Spawns child processes for commands
- Captures stdout/stderr
- Handles timeouts
- Returns exit codes

#### 4. Storage (storage/sqlite.js)
- SQLite with WAL mode for concurrency
- Transaction-based job claiming (prevents duplicates)
- Persistent configuration storage

### Retry Mechanism

**Exponential Backoff Formula:**
```
delay = base ^ attempts (in seconds)
```

**Example with base=2:**
- Attempt 1: 2^1 = 2 seconds
- Attempt 2: 2^2 = 4 seconds
- Attempt 3: 2^3 = 8 seconds

After `max_retries` attempts, job moves to DLQ.

### Concurrency & Locking

**Problem:** Multiple workers must not process the same job.

**Solution:** Database transaction with row locking
```javascript
// Atomic claim operation
BEGIN TRANSACTION
  SELECT job WHERE state='pending' AND not locked
  UPDATE job SET locked_by=worker_id, state='processing'
COMMIT
```

SQLite's `busy_timeout` handles lock contention gracefully.

## Testing

### Run Test Suite
```bash
chmod +x test.sh
./test.sh
```

### Test Coverage
- ✅ Basic job completion
- ✅ Multiple workers without duplication
- ✅ Invalid command handling
- ✅ Retry with exponential backoff
- ✅ DLQ functionality
- ✅ Data persistence across restarts
- ✅ Configuration management
- ✅ Output logging

### Manual Testing
```bash
# Terminal 1: Start worker
node index.js worker start

# Terminal 2: Enqueue jobs
node index.js enqueue '{"command":"echo Test 1"}'
node index.js enqueue '{"command":"sleep 2"}'
node index.js enqueue '{"command":"invalid_cmd","max_retries":1}'

# Check status
node index.js status
node index.js list
node index.js dlq list
```

## Configuration Options

| Key | Default | Description |
|-----|---------|-------------|
| `max-retries` | 3 | Maximum retry attempts before DLQ |
| `backoff-base` | 2 | Base for exponential backoff calculation |
| `default-timeout` | 60 | Default job timeout in seconds |

## Design Decisions & Trade-offs

### Why SQLite?
- **Pros:** Embedded, zero-config, ACID compliant, good concurrency with WAL
- **Cons:** Not suitable for distributed systems (single file)
- **Alternative:** Redis/PostgreSQL for production scale

### Why Child Process Spawn?
- **Pros:** Isolates job execution, captures output, handles timeouts
- **Cons:** Overhead per job, limited to shell commands
- **Alternative:** Worker threads for JS functions

### Why Polling Workers?
- **Pros:** Simple, reliable, works with any storage
- **Cons:** Slight delay (1s sleep when idle)
- **Alternative:** Event-driven with pub/sub (requires Redis/message queue)

### Assumptions
1. Jobs are shell commands (not arbitrary code)
2. Single machine deployment (not distributed)
3. Moderate job volume (< 10k jobs/minute)
4. Workers run on same machine as database

## Performance Characteristics

- **Throughput:** ~100-500 jobs/second (depends on job duration)
- **Latency:** 1-2 seconds (polling interval)
- **Concurrency:** Limited by SQLite (typically 10-50 workers)
- **Storage:** Minimal (few KB per job)

## Production Considerations

### What's Production-Ready
- Persistent storage with transactions  
- Graceful shutdown handling  
- Error handling and logging  
- Configurable retry logic  
- Job locking prevents duplicates  

### What Would Need Enhancement
- Monitoring & alerting (add Prometheus metrics)  
- Distributed deployment (use Redis/PostgreSQL)  
- Job prioritization (add priority queue)  
- Rate limiting (prevent worker overload)  
- Authentication (secure web dashboard)  

## Example Use Cases

### 1. Image Processing Pipeline
```bash
node index.js enqueue '{"command":"convert input.jpg -resize 800x600 output.jpg"}'
```

### 2. Batch Email Sending
```bash
node index.js enqueue '{"command":"node send-email.js user@example.com"}'
```

### 3. Database Backup
```bash
node index.js enqueue '{"command":"pg_dump mydb > backup.sql","timeout":300}'
```

### 4. Scheduled Reports
```bash
node index.js enqueue '{"command":"node generate-report.js","run_at":"2025-11-10T09:00:00Z"}'
```

## Troubleshooting

### Workers not processing jobs
```bash
# Check if workers are running
ps aux | grep "worker"

# Check job states
node index.js status
node index.js list --state pending
```

### Jobs stuck in processing
```bash
# Check for crashed workers (orphaned locks)
# Manually reset if needed (requires DB access)
sqlite3 data/queuectl.db "UPDATE jobs SET state='pending', locked_by=NULL WHERE state='processing'"
```

### Database locked errors
```bash
# Reduce number of concurrent workers
node index.js worker stop
node index.js worker start --count 2
```

## Demo Video

[Link to demo video will be added here]

## License

ISC

## Author

[Your name/contact]

---

Built for the QueueCTL Challenge
