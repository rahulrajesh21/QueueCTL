#!/usr/bin/env node

import { program } from 'commander';
import { enqueueCommand } from './cli/commands/enqueue.js';
import { workerCommand } from './cli/commands/worker.js';
import { statusCommand } from './cli/commands/status.js';
import { listCommand } from './cli/commands/list.js';
import { dlqCommand } from './cli/commands/dlq.js';
import { configCommand } from './cli/commands/config.js';

program
  .name('queuectl')
  .description('CLI-based background job queue system')
  .version('1.0.0');

// Register all commands
enqueueCommand(program);
workerCommand(program);
statusCommand(program);
listCommand(program);
dlqCommand(program);
configCommand(program);

program.parse(process.argv);
