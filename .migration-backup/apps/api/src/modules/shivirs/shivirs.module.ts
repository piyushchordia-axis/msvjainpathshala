/**
 * ShivirsModule — Step 15.
 *
 * Exports `ShivirsService` so the sync module can register the
 * `shivir.scan` handler against it without re-instantiating the service
 * tree. The handler classes themselves live under
 * `apps/api/src/modules/shivirs/handlers/` and are registered by
 * `SyncModule.providers` (one place owns the sync registry).
 *
 * Dependencies:
 *   - AuditModule for `audit.emit()`.
 *   - RealtimeModule (global) for the Socket.IO gateway.
 *   - BullModule already provides queue tokens globally; we re-declare
 *     `REPORT_SHIVIR_EXPORT` + `SHIVIR_LIVE_BROADCAST` here for clarity.
 */

import { Module } from '@nestjs/common';

import { ShivirsRepository, StudentsRepository, UsersRepository } from '../../db/repositories';
import { AuditModule } from '../audit/audit.module';

import { ShivirScanSyncHandler } from './handlers/shivir-scan.handler';
import { ShivirsController } from './shivirs.controller';
import { ShivirsService } from './shivirs.service';

@Module({
  // BullMQ queues are registered globally by QueuesModule (apps/api/src/queues),
  // so the @InjectQueue(...) tokens are available without re-importing them
  // here. AuditModule is required for `audit.emit()` from the service.
  imports: [AuditModule],
  controllers: [ShivirsController],
  providers: [
    ShivirsService,
    ShivirsRepository,
    StudentsRepository,
    UsersRepository,
    ShivirScanSyncHandler,
  ],
  exports: [ShivirsService, ShivirScanSyncHandler],
})
export class ShivirsModule {}
