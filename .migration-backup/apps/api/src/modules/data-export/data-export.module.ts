/**
 * DataExportModule — parent self-service data export wiring.
 */

import { Module } from '@nestjs/common';

import { DonationsRepository } from '../../db/repositories/donations.repository';
import { ProgressReportsRepository } from '../../db/repositories/progress-reports.repository';
import { StudentsRepository } from '../../db/repositories/students.repository';
import { UsersRepository } from '../../db/repositories/users.repository';
import { AuditModule } from '../audit/audit.module';

import { DataExportController } from './data-export.controller';
import { DataExportService } from './data-export.service';

@Module({
  imports: [AuditModule],
  controllers: [DataExportController],
  providers: [
    DataExportService,
    UsersRepository,
    StudentsRepository,
    ProgressReportsRepository,
    DonationsRepository,
  ],
})
export class DataExportModule {}
