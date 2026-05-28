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
  AttendanceRepository,
  BatchesRepository,
  CentresRepository,
  DeviceTokensRepository,
  MediaAssetsRepository,
  NotificationsRepository,
  PunyaFeaturesRepository,
  PunyaTransactionsRepository,
  SanchalakAssignmentsRepository,
  SmsLogsRepository,
  StudentNotesRepository,
  StudentsRepository,
  UsersRepository,
} from '../db/repositories';
import { NotificationsModule } from '../modules/notifications/notifications.module';
import { PunyaModule } from '../modules/punya/punya.module';

import { AttendanceConsecutiveCheckProcessor } from './processors/attendance-consecutive-check.processor';
import { AttendancePostProcessProcessor } from './processors/attendance-post-process.processor';
import { DebugEchoProcessor } from './processors/debug-echo.processor';
import { IdCardGenerationProcessor } from './processors/idcard-generation.processor';
import { MediaProcessingProcessor } from './processors/media-processing.processor';
import { NotificationEmailProcessor } from './processors/notification-email.processor';
import { NotificationFanoutProcessor } from './processors/notification-fanout.processor';
import { NotificationPushProcessor } from './processors/notification-push.processor';
import { NotificationSmsProcessor } from './processors/notification-sms.processor';
import { PunyaLeaderboardRefreshProcessor } from './processors/punya-leaderboard-refresh.processor';
import { PunyaReconcileProcessor } from './processors/punya-reconcile.processor';

@Module({
  imports: [RedisModule, NotificationsModule, PunyaModule],
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
  ],
})
export class QueueProcessorsModule {}
