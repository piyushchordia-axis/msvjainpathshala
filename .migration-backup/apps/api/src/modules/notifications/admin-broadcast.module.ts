/**
 * AdminBroadcastModule — HTTP-only module hosting `POST /v1/admin/broadcasts`.
 *
 * Lives separately from `NotificationsModule` (which is also loaded by the
 * worker process) so that the controller's AuditService dependency doesn't
 * drag the audit / system-config wiring into the worker bootstrap.
 *
 * AuditService transitively requires SystemConfigService, which the worker
 * doesn't import; keeping this module HTTP-only avoids that DI tangle.
 */

import { Module } from '@nestjs/common';

import { AdminBroadcastController } from './admin-broadcast.controller';

@Module({
  controllers: [AdminBroadcastController],
})
export class AdminBroadcastModule {}
