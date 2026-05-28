/**
 * `debug.echo` — a single processor that logs and echoes any job it receives.
 * Useful for end-to-end queue wiring tests (Step 7 expands the processor set).
 *
 * Not in SPEC §9.1 by name, but mentioned in CLAUDE.md "All 30 BullMQ queues"
 * as the smoke queue. Kept here under the dedicated `jp.debug.echo` name to
 * avoid colliding with any production queue should both run side-by-side.
 */

import { Worker, type ConnectionOptions, type Job } from 'bullmq';

import type { Logger as NestLogger } from '@nestjs/common';

export const DEBUG_ECHO_QUEUE = 'jp.debug.echo';

export function createDebugEchoWorker(
  connection: ConnectionOptions,
  log: NestLogger,
): Worker<{ message: string }, { echoed: string }> {
  const worker = new Worker<{ message: string }, { echoed: string }>(
    DEBUG_ECHO_QUEUE,
    async (job: Job<{ message: string }>) => {
      log.log(`debug.echo received job ${job.id}: ${job.data.message}`, 'DebugEchoWorker');
      return { echoed: job.data.message };
    },
    { connection, concurrency: 5 },
  );

  worker.on('completed', (job) => {
    log.log(`debug.echo completed job ${job.id}`, 'DebugEchoWorker');
  });
  worker.on('failed', (job, err) => {
    log.error(`debug.echo failed job ${job?.id ?? '?'}: ${err.message}`, 'DebugEchoWorker');
  });

  return worker;
}
