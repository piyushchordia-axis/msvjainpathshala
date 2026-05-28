import { Global, Module } from '@nestjs/common';

import { AuditService } from './audit.service';

/**
 * Global module — every feature module DI-injects `AuditService` from here.
 * The matching BullMQ worker that drains QUEUES.AUDIT_WRITE lands in Step 7.
 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
