/**
 * Worker-side BullMQ module.
 *
 * Bootstraps every processor that should run when `apps/api` is invoked as a
 * worker (`pnpm dev:worker` / `node dist/worker.js`). Step 3 ships only the
 * `debug.echo` smoke processor; Step 7 expands to the full 30-queue set from
 * SPEC §9.1.
 */

import {
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';

import { ConfigModule } from '../core/config/config.module';
import { DatabaseModule } from '../core/database/database.module';
import { LoggerModule } from '../core/logger/logger.module';
import { RedisModule } from '../core/redis/redis.module';
import { type RedisService } from '../core/redis/redis.service';

import { createDebugEchoWorker } from './processors/debug-echo.processor';

import type { Worker } from 'bullmq';

@Injectable()
export class QueueRegistry implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(QueueRegistry.name);
  private readonly workers: Worker[] = [];

  constructor(private readonly redis: RedisService) {}

  onModuleInit(): void {
    const debugEcho = createDebugEchoWorker(this.redis.bullmqClient, this.logger);
    this.workers.push(debugEcho);
    this.logger.log(`Started ${this.workers.length} BullMQ worker(s)`);
  }

  /**
   * Graceful shutdown (SPEC §18 + Step 3 prompt's 25s drain).
   * BullMQ's Worker#close(force=false) waits for in-flight jobs to finish
   * before resolving — bounded externally by the caller via Promise.race.
   */
  async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log(`Draining ${this.workers.length} worker(s) (signal=${signal ?? 'n/a'})`);
    await Promise.allSettled(this.workers.map((w) => w.close()));
    this.logger.log('All workers drained');
  }
}

@Module({
  imports: [ConfigModule, LoggerModule, DatabaseModule, RedisModule],
  providers: [QueueRegistry],
  exports: [QueueRegistry],
})
export class QueueModule {}
