import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { ConfigModule } from './core/config/config.module';
import { DatabaseModule } from './core/database/database.module';
import { HealthModule } from './core/health/health.module';
import { LoggerModule } from './core/logger/logger.module';
import { RedisModule } from './core/redis/redis.module';
import { SystemConfigModule } from './core/system-config/system-config.module';
import { AdminQueuesModule } from './modules/admin-queues/admin-queues.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';
import { ScopeGuard } from './modules/auth/guards/scope.guard';
import { BatchesModule } from './modules/batches/batches.module';
import { CentreHolidaysModule } from './modules/centre-holidays/centre-holidays.module';
import { CentresModule } from './modules/centres/centres.module';
import { FormConfigsModule } from './modules/form-configs/form-configs.module';
import { GeographyModule } from './modules/geography/geography.module';
import { ObservabilityModule } from './observability/observability.module';
import { QueuesModule } from './queues/queues.module';

/**
 * Root HTTP module. Domain modules from `src/modules/*` land here per step.
 *
 * Auth guards are wired at APP_GUARD so every controller is protected by
 * default; `@Public()` is the per-route opt-out (health endpoints + the
 * three pre-auth routes /v1/auth/otp/send, /v1/auth/otp/verify, /v1/auth/refresh).
 */
@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    DatabaseModule,
    RedisModule,
    SystemConfigModule,
    QueuesModule.forRoot(),
    AuditModule,
    AuthModule,
    GeographyModule,
    CentresModule,
    BatchesModule,
    CentreHolidaysModule,
    FormConfigsModule,
    AdminQueuesModule,
    HealthModule,
    ObservabilityModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ScopeGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
