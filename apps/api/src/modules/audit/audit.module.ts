import { Global, Module } from '@nestjs/common';

import { AuditLogsRepository } from '../../db/repositories/audit-logs.repository';

import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

/**
 * Global module — every feature module DI-injects `AuditService` from here.
 * The matching BullMQ worker that drains QUEUES.AUDIT_WRITE lands in Step 7.
 *
 * The read side (`GET /v1/admin/audit-logs`) is served by AuditController via
 * the read-only AuditLogsRepository.
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditLogsRepository],
  exports: [AuditService],
})
export class AuditModule {}
