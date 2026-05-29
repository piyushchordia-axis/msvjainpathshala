/**
 * QueueProcessorsModule — worker-side wiring of every @Processor.
 *
 * Mounted ONLY by `WorkerModule` (i.e. when `apps/api` runs as
 * `pnpm dev:worker` / `node dist/worker.js`). The HTTP entrypoint mounts
 * only the producer side via `QueuesModule.forRoot()`.
 *
 * Step 12 adds the four notification processors: fanout (resolves
 * recipients → splits into per-channel jobs), push (FCM), sms (MSG91 with
 * Devanagari segment math + spend cap), and email (Resend / console).
 */

import { Module } from '@nestjs/common';

import { RedisModule } from '../core/redis/redis.module';
import {
  AnalyticsRepository,
  AttendanceRepository,
  BatchesRepository,
  CentresRepository,
  DeviceTokensRepository,
  DonationsRepository,
  ExportJobsRepository,
  MediaAssetsRepository,
  NiyamsRepository,
  NiyamStreaksRepository,
  NiyamSubmissionsRepository,
  NotificationsRepository,
  PlatformSettingsRepository,
  ProgressReportsRepository,
  PunyaFeaturesRepository,
  PunyaTransactionsRepository,
  QuestionsRepository,
  SanchalakAssignmentsRepository,
  ServiceRequestsRepository,
  SmsLogsRepository,
  StudentNotesRepository,
  StudentsRepository,
  UsersRepository,
} from '../db/repositories';
import { AnalyticsModule } from '../modules/analytics/analytics.module';
import { DonationsModule } from '../modules/donations/donations.module';
import { NotificationsModule } from '../modules/notifications/notifications.module';
import { PunyaModule } from '../modules/punya/punya.module';
import { ReportsModule } from '../modules/reports/reports.module';

import { AiQuizGenerateProcessor } from './processors/ai-quiz-generate.processor';
import { AnalyticsRefreshViewsProcessor } from './processors/analytics-refresh-views.processor';
import { AttendanceConsecutiveCheckProcessor } from './processors/attendance-consecutive-check.processor';
import { AttendancePostProcessProcessor } from './processors/attendance-post-process.processor';
import { DebugEchoProcessor } from './processors/debug-echo.processor';
import { DigestWeeklyEmailProcessor } from './processors/digest-weekly-email.processor';
import { DonationEightyGCertProcessor } from './processors/donation-eightyg-cert.processor';
import { DonationReceiptGenerateProcessor } from './processors/donation-receipt-generate.processor';
import { ExportBulkZipProcessor } from './processors/export-bulk-zip.processor';
import { ExportStudentPdfProcessor } from './processors/export-student-pdf.processor';
import { IdCardGenerationProcessor } from './processors/idcard-generation.processor';
import { MediaProcessingProcessor } from './processors/media-processing.processor';
import { NiyamStreakRecomputeProcessor } from './processors/niyam-streak-recompute.processor';
import { NotificationEmailProcessor } from './processors/notification-email.processor';
import { NotificationFanoutProcessor } from './processors/notification-fanout.processor';
import { NotificationPushProcessor } from './processors/notification-push.processor';
import { NotificationSmsProcessor } from './processors/notification-sms.processor';
import { NotificationsMonthlyReportsProcessor } from './processors/notifications-monthly-reports.processor';
import { PunyaLeaderboardRefreshProcessor } from './processors/punya-leaderboard-refresh.processor';
import { PunyaReconcileProcessor } from './processors/punya-reconcile.processor';
import { ReportGenerationProcessor } from './processors/report-generation.processor';

@Module({
  imports: [
    RedisModule,
    NotificationsModule,
    PunyaModule,
    DonationsModule,
    ReportsModule,
    AnalyticsModule,
  ],
  providers: [
    DebugEchoProcessor,
    MediaProcessingProcessor,
    IdCardGenerationProcessor,

    NotificationFanoutProcessor,
    NotificationPushProcessor,
    NotificationSmsProcessor,
    NotificationEmailProcessor,

    AttendancePostProcessProcessor,
    AttendanceConsecutiveCheckProcessor,

    PunyaLeaderboardRefreshProcessor,
    PunyaReconcileProcessor,

    NiyamStreakRecomputeProcessor,

    // Step 21 — AI + donations workers
    AiQuizGenerateProcessor,
    DonationReceiptGenerateProcessor,
    DonationEightyGCertProcessor,

    // Step 22 — reports / exports / analytics / weekly digest workers
    ReportGenerationProcessor,
    NotificationsMonthlyReportsProcessor,
    ExportStudentPdfProcessor,
    ExportBulkZipProcessor,
    AnalyticsRefreshViewsProcessor,
    DigestWeeklyEmailProcessor,

    // repos used by processors
    MediaAssetsRepository,
    NotificationsRepository,
    DeviceTokensRepository,
    SmsLogsRepository,
    AttendanceRepository,
    BatchesRepository,
    CentresRepository,
    PunyaFeaturesRepository,
    PunyaTransactionsRepository,
    SanchalakAssignmentsRepository,
    StudentNotesRepository,
    StudentsRepository,
    UsersRepository,
    NiyamsRepository,
    NiyamSubmissionsRepository,
    NiyamStreaksRepository,
    QuestionsRepository,
    DonationsRepository,
    PlatformSettingsRepository,
    ProgressReportsRepository,
    ExportJobsRepository,
    AnalyticsRepository,
    ServiceRequestsRepository,
  ],
  exports: [
    DebugEchoProcessor,
    MediaProcessingProcessor,
    IdCardGenerationProcessor,
    NotificationFanoutProcessor,
    NotificationPushProcessor,
    NotificationSmsProcessor,
    NotificationEmailProcessor,
    AttendancePostProcessProcessor,
    AttendanceConsecutiveCheckProcessor,
    PunyaLeaderboardRefreshProcessor,
    PunyaReconcileProcessor,
    NiyamStreakRecomputeProcessor,
    AiQuizGenerateProcessor,
    DonationReceiptGenerateProcessor,
    DonationEightyGCertProcessor,
    ReportGenerationProcessor,
    NotificationsMonthlyReportsProcessor,
    ExportStudentPdfProcessor,
    ExportBulkZipProcessor,
    AnalyticsRefreshViewsProcessor,
    DigestWeeklyEmailProcessor,
  ],
})
export class QueueProcessorsModule {}
