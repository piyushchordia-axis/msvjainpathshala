/**
 * ExamsModule — Step 19.
 *
 * Wires the online-exams pipeline: create → generate-OTP → start-attempt →
 * autosave → submit → grade → release-results. Punya is awarded via
 * PunyaService with idempotency keys `exam:{exam_id}:completion:{student_id}`
 * and `exam:{exam_id}:top:{student_id}`.
 */

import { Module } from '@nestjs/common';

import {
  ExamsRepository,
  PunyaFeaturesRepository,
  PunyaTransactionsRepository,
  StudentsRepository,
} from '../../db/repositories';
import { AuditModule } from '../audit/audit.module';
import { PunyaModule } from '../punya/punya.module';

import { ExamsController } from './exams.controller';
import { ExamsService } from './exams.service';

@Module({
  imports: [AuditModule, PunyaModule],
  controllers: [ExamsController],
  providers: [
    ExamsService,
    ExamsRepository,
    StudentsRepository,
    PunyaFeaturesRepository,
    PunyaTransactionsRepository,
  ],
  exports: [ExamsService],
})
export class ExamsModule {}
