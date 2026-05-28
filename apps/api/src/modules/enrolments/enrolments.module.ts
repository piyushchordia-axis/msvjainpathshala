import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';

import { EnrolmentsController } from './enrolments.controller';
import { EnrolmentsService } from './enrolments.service';

@Module({
  imports: [AuditModule],
  controllers: [EnrolmentsController],
  providers: [EnrolmentsService],
  exports: [EnrolmentsService],
})
export class EnrolmentsModule {}
