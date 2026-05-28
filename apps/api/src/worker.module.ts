import { Module } from '@nestjs/common';

import { ConfigModule } from './core/config/config.module';
import { DatabaseModule } from './core/database/database.module';
import { LoggerModule } from './core/logger/logger.module';
import { RedisModule } from './core/redis/redis.module';
import { QueueModule } from './queue/queue.module';

/**
 * Worker root module — NO HTTP controllers, only what the BullMQ side needs
 * for DI (config, logger, database, redis, queue registry).
 *
 * Mounted via NestFactory.createApplicationContext in `src/worker.ts` so no
 * Express adapter is started; the small `/healthz` listener for ECS lives in
 * `src/worker.ts` directly.
 */
@Module({
  imports: [ConfigModule, LoggerModule, DatabaseModule, RedisModule, QueueModule],
})
export class WorkerModule {}
