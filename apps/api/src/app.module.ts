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
import { StorageModule } from './core/storage/storage.module';
import { SystemConfigModule } from './core/system-config/system-config.module';
import { GlobalThrottlerModule } from './core/throttler/throttler.module';
import { AdminQueuesModule } from './modules/admin-queues/admin-queues.module';
import { AiModule } from './modules/ai/ai.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';
import { ScopeGuard } from './modules/auth/guards/scope.guard';
import { BatchesModule } from './modules/batches/batches.module';
import { CentreHolidaysModule } from './modules/centre-holidays/centre-holidays.module';
import { CentresModule } from './modules/centres/centres.module';
import { CompetitionsModule } from './modules/competitions/competitions.module';
import { CurriculumModule } from './modules/curriculum/curriculum.module';
import { DonationsModule } from './modules/donations/donations.module';
import { EnrolmentsModule } from './modules/enrolments/enrolments.module';
import { ExamsModule } from './modules/exams/exams.module';
import { FormConfigsModule } from './modules/form-configs/form-configs.module';
import { GalleryModule } from './modules/gallery/gallery.module';
import { GeographyModule } from './modules/geography/geography.module';
import { HomeworkModule } from './modules/homework/homework.module';
import { LibraryModule } from './modules/library/library.module';
import { MediaModule } from './modules/media/media.module';
import { MsvModule } from './modules/msv/msv.module';
import { NiyamsModule } from './modules/niyams/niyams.module';
import { NoticesModule } from './modules/notices/notices.module';
import { AdminBroadcastModule } from './modules/notifications/admin-broadcast.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PunyaModule } from './modules/punya/punya.module';
import { QuizzesModule } from './modules/quizzes/quizzes.module';
import { ReportsModule } from './modules/reports/reports.module';
import { ServiceRequestsModule } from './modules/service-requests/service-requests.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { ShivirsModule } from './modules/shivirs/shivirs.module';
import { StudentsModule } from './modules/students/students.module';
import { SyncModule } from './modules/sync/sync.module';
import { ObservabilityModule } from './observability/observability.module';
import { QueuesModule } from './queues/queues.module';
import { RealtimeModule } from './realtime/realtime.module';

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
    StorageModule,
    SystemConfigModule,
    GlobalThrottlerModule,
    QueuesModule.forRoot(),
    AuditModule,
    AuthModule,
    GeographyModule,
    CentresModule,
    BatchesModule,
    CentreHolidaysModule,
    FormConfigsModule,
    EnrolmentsModule,
    StudentsModule,
    MsvModule,
    MediaModule,
    NotificationsModule,
    AdminBroadcastModule,
    SessionsModule,
    AttendanceModule,
    ShivirsModule,
    PunyaModule,
    NiyamsModule,
    GalleryModule,
    HomeworkModule,
    NoticesModule,
    CompetitionsModule,
    CurriculumModule,
    ExamsModule,
    QuizzesModule,
    DonationsModule,
    AiModule,
    LibraryModule,
    ServiceRequestsModule,
    ReportsModule,
    AnalyticsModule,
    SyncModule,
    RealtimeModule,
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
