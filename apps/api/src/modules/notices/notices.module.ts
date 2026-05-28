/**
 * NoticesModule — Step 18.
 *
 * Wires:
 *   - POST/GET /v1/notices and /v1/admin/notices
 *   - Critical-notice SMS fallback via the existing fanout queue
 *   - Cron-driven scheduled-publish processor
 */

import { Module } from '@nestjs/common';

import {
  CentresRepository,
  MsvEnrolmentsRepository,
  NoticeReadsRepository,
  NoticesRepository,
  StudentsRepository,
  UsersRepository,
} from '../../db/repositories';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';

import { NoticesController } from './notices.controller';
import { NoticesService } from './notices.service';

@Module({
  imports: [AuditModule, NotificationsModule],
  controllers: [NoticesController],
  providers: [
    NoticesService,
    NoticesRepository,
    NoticeReadsRepository,
    UsersRepository,
    StudentsRepository,
    CentresRepository,
    MsvEnrolmentsRepository,
  ],
  exports: [NoticesService, NoticesRepository, NoticeReadsRepository],
})
export class NoticesModule {}
