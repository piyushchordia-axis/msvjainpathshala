import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';

import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { ConfigModule } from './core/config/config.module';
import { DatabaseModule } from './core/database/database.module';
import { HealthModule } from './core/health/health.module';
import { LoggerModule } from './core/logger/logger.module';
import { RedisModule } from './core/redis/redis.module';

/**
 * Root HTTP module. Domain modules from `src/modules/*` land here in later
 * steps (auth in Step 5, centres+batches in Step 6, etc).
 */
@Module({
  imports: [ConfigModule, LoggerModule, DatabaseModule, RedisModule, HealthModule],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
