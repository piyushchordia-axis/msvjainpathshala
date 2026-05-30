import { Module } from '@nestjs/common';

import { ConfigModule } from './core/config/config.module';
import { DatabaseModule } from './core/database/database.module';
import { PdfModule } from './core/pdf/pdf.module';
import { HealthModule } from './core/health/health.module';
import { LoggerModule } from './core/logger/logger.module';
import { RedisModule } from './core/redis/redis.module';
import { StorageModule } from './core/storage/storage.module';
import { ObservabilityModule } from './observability/observability.module';
import { QueueProcessorsModule } from './queues/queue-processors.module';
import { QueuesModule } from './queues/queues.module';
import { SchedulerModule } from './queues/scheduler.module';

/**
 * Worker root module — NO HTTP controllers. Loads the queue infrastructure
 * (Step 7), every @Processor under `queues/processors/*`, the cron
 * scheduler, and the queue-metrics exporter.
 *
 * Mounted via NestFactory.createApplicationContext in `src/worker.ts` so no
 * Express adapter is started; the small `/healthz` listener for ECS lives
 * in `src/worker.ts` directly.
 */
@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    DatabaseModule,
    PdfModule,
    RedisModule,
    StorageModule,
    HealthModule, // exports MetricsService used by QueueMetricsService
    QueuesModule.forRoot(),
    QueueProcessorsModule,
    SchedulerModule,
    ObservabilityModule,
  ],
})
export class WorkerModule {}
