/**
 * QueuesModule — producer-side BullMQ registry.
 *
 * Registers every queue from `QUEUES` (and its `.dlq` pair) with
 * @nestjs/bullmq so any consumer can `@InjectQueue(QUEUES.X)` to enqueue
 * jobs. The matching consumers (Worker / WorkerHost) live under
 * `apps/api/src/queues/processors/*` and are loaded only by the worker
 * entrypoint via `QueueProcessorsModule` — the HTTP app boots producers
 * only.
 *
 * Connection: every queue and worker uses the dedicated `bullmqClient` from
 * RedisService. That client is configured with `maxRetriesPerRequest: null`
 * and no `keyPrefix` (BullMQ rejects clients that set either).
 *
 * Default job options (CLAUDE.md / Step 7 prompt):
 *   - attempts: 3
 *   - backoff: exponential, 5s starting delay
 *   - removeOnComplete: { age: 86400, count: 1000 } — keep 1 day or 1000 latest
 *   - removeOnFail:    { age: 604800 } — keep failed jobs for 7 days, then trim
 *
 * Per-queue overrides land in QUEUE_DEFAULT_JOB_OPTIONS as the worker set
 * fills out in later steps. The audit.write queue, for example, wants more
 * attempts than 3 (Section 9.2 says 5).
 */

import { BullModule } from '@nestjs/bullmq';
import { Global, Module, type DynamicModule } from '@nestjs/common';

import { ConfigModule } from '../core/config/config.module';
import { RedisModule } from '../core/redis/redis.module';
import { RedisService } from '../core/redis/redis.service';

import { QUEUE_NAMES, dlqName, type QueueName } from './queues.constants';

import type { JobsOptions, QueueOptions } from 'bullmq';

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 86_400, count: 1_000 },
  removeOnFail: { age: 604_800 },
};

/** Per-queue overrides applied on top of DEFAULT_JOB_OPTIONS. */
export const QUEUE_DEFAULT_JOB_OPTIONS: Partial<Record<QueueName, Partial<JobsOptions>>> = {
  'audit.write': { attempts: 5 },
  'notifications.push': { attempts: 5, backoff: { type: 'exponential', delay: 1_000 } },
  'notifications.sms': { attempts: 3, backoff: { type: 'exponential', delay: 2_000 } },
  'auth.sms.otp': { attempts: 3, backoff: { type: 'exponential', delay: 2_000 } },
  // DLQ entries never auto-retry: they're a manual-replay queue.
};

/** Merge global + per-queue defaults into one JobsOptions. */
export function jobOptionsFor(queue: QueueName): JobsOptions {
  return { ...DEFAULT_JOB_OPTIONS, ...(QUEUE_DEFAULT_JOB_OPTIONS[queue] ?? {}) };
}

/**
 * Build the static array of { name, defaultJobOptions } the BullModule wants.
 * Includes both the primary queues and their `.dlq` counterparts so admin
 * endpoints can read/replay/delete via @InjectQueue.
 */
function buildQueueRegistrations() {
  const regs: Array<{ name: string; defaultJobOptions: JobsOptions }> = [];
  for (const name of QUEUE_NAMES) {
    regs.push({ name, defaultJobOptions: jobOptionsFor(name) });
    // DLQ: never auto-retry — these jobs already exhausted their budget.
    regs.push({
      name: dlqName(name),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
      },
    });
  }
  return regs;
}

@Global()
@Module({})
export class QueuesModule {
  static forRoot(): DynamicModule {
    const registrations = buildQueueRegistrations();
    const bullRoot = BullModule.forRootAsync({
      imports: [RedisModule, ConfigModule],
      inject: [RedisService],
      useFactory: (redis: RedisService): QueueOptions => ({
        // Reuse the dedicated BullMQ ioredis client (no keyPrefix, retries:null).
        connection: redis.bullmqClient,
      }),
    });
    const bullQueues = BullModule.registerQueue(...registrations);

    return {
      module: QueuesModule,
      global: true,
      imports: [RedisModule, ConfigModule, bullRoot, bullQueues],
      exports: [bullRoot, bullQueues],
    };
  }
}
