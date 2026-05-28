import { Module } from '@nestjs/common';

import { HealthModule } from '../core/health/health.module';
import { RedisModule } from '../core/redis/redis.module';

import { QueueMetricsService } from './queue-metrics.service';

/**
 * ObservabilityModule — hosts the queue-metrics exporter and any future
 * periodic Prometheus emitters. Loaded by both the HTTP and worker apps:
 * each process scrapes its own queue counts (cheap; same numbers since
 * BullMQ stores them in Redis), and only the HTTP side exposes /metrics.
 */
@Module({
  imports: [RedisModule, HealthModule],
  providers: [QueueMetricsService],
  exports: [QueueMetricsService],
})
export class ObservabilityModule {}
