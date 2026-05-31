import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { ConfigModule } from '../config/config.module';
import { DatabaseModule } from '../database/database.module';
import { RedisModule } from '../redis/redis.module';

import { DbReadIndicator } from './db-read.indicator';
import { DbWriteIndicator } from './db-write.indicator';
import { HealthController } from './health.controller';
import { MetricsService } from './metrics.service';
import { RedisIndicator } from './redis.indicator';
import { StorageIndicator } from './storage.indicator';

@Module({
  imports: [TerminusModule, ConfigModule, DatabaseModule, RedisModule],
  controllers: [HealthController],
  providers: [DbWriteIndicator, DbReadIndicator, RedisIndicator, StorageIndicator, MetricsService],
  exports: [MetricsService],
})
export class HealthModule {}
