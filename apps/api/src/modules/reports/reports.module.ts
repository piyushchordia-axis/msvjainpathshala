/**
 * ReportsModule — Step 22 (SPEC §5.20, §12.4, §12.5, §12.6).
 *
 * The cron entry point for monthly reports is the
 * NOTIFICATIONS_MONTHLY_REPORTS scheduler (1st of month 02:00 IST); the
 * worker calls into ReportsService.enqueueMonthlyForAllActive. Per-student
 * PDF generation is the `report.generation` queue.
 */

import { Module } from '@nestjs/common';

import {
  ExportJobsRepository,
  ProgressReportsRepository,
  StudentsRepository,
} from '../../db/repositories';

import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, StudentsRepository, ProgressReportsRepository, ExportJobsRepository],
  exports: [ReportsService, ProgressReportsRepository, ExportJobsRepository],
})
export class ReportsModule {}
