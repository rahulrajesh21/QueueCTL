# QueueCTL

CLI-based background job queue system with retry and Dead Letter Queue support.

## Features

- Background job processing with worker processes
- Automatic retry with exponential backoff
- Dead Letter Queue (DLQ) for failed jobs
- Persistent storage using SQLite
- Multiple concurrent workers
- Graceful shutdown handling

## Installation

```bash
npm install
```

## Usage

### Enqueue a job
```bash
queuectl enqueue '{"command":"echo hello"}'
```

### Start workers
```bash
queuectl worker start --count 3
```

### Check status
```bash
queuectl status
```

### List jobs
```bash
queuectl list --state pending
```

### Manage DLQ
```bash
queuectl dlq list
queuectl dlq retry <job-id>
```

### Configuration
```bash
queuectl config set max-retries 5
queuectl config get max-retries
```

## Architecture

- **CLI Layer**: Command parsing and user interaction
- **Core Layer**: Business logic (queue, worker, executor)
- **Storage Layer**: SQLite database for persistence
- **Retry Mechanism**: Exponential backoff for failed jobs

## Development

```bash
npm run dev
```

## License

ISC
