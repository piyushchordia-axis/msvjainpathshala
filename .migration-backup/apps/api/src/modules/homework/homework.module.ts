/**
 * HomeworkModule — Step 18.
 *
 * Wires the homework assign / mark-done / grade endpoints + the offline-sync
 * handler. Punya is awarded via PunyaService with idempotency_key
 * `homework:{submission_id}`.
 */

import { Module } from '@nestjs/common';

import {
  BatchesRepository,
  HomeworkAssignmentsRepository,
  HomeworkSubmissionsRepository,
  PunyaFeaturesRepository,
  PunyaTransactionsRepository,
  StudentsRepository,
} from '../../db/repositories';
import { AuditModule } from '../audit/audit.module';
import { PunyaModule } from '../punya/punya.module';

import { HomeworkSubmissionSyncHandler } from './handlers/homework-submission.handler';
import { HomeworkController } from './homework.controller';
import { HomeworkService } from './homework.service';

@Module({
  imports: [AuditModule, PunyaModule],
  controllers: [HomeworkController],
  providers: [
    HomeworkService,
    HomeworkSubmissionSyncHandler,
    HomeworkAssignmentsRepository,
    HomeworkSubmissionsRepository,
    StudentsRepository,
    BatchesRepository,
    PunyaFeaturesRepository,
    PunyaTransactionsRepository,
  ],
  exports: [HomeworkService, HomeworkSubmissionSyncHandler],
})
export class HomeworkModule {}
