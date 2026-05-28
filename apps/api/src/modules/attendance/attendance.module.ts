import { Module } from '@nestjs/common';

import {
  AbsenceNotificationsRepository,
  AttendanceRepository,
  BatchesRepository,
  CentresRepository,
  PunyaTransactionsRepository,
  SessionsRepository,
  StudentsRepository,
} from '../../db/repositories';
import { AuditModule } from '../audit/audit.module';

import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';

@Module({
  imports: [AuditModule],
  controllers: [AttendanceController],
  providers: [
    AttendanceService,
    AttendanceRepository,
    SessionsRepository,
    AbsenceNotificationsRepository,
    StudentsRepository,
    BatchesRepository,
    CentresRepository,
    PunyaTransactionsRepository,
  ],
  exports: [AttendanceService, AttendanceRepository],
})
export class AttendanceModule {}
