/**
 * CurriculumModule — Step 19.
 *
 * Wires the curriculum templates / curricula / sections / items / assignments
 * / per-student progress endpoints. The Q2 "MSV → super_admin only" rule
 * lives in CurriculumService (service-layer enforcement, CLAUDE.md Q2).
 *
 * Optional Punya on `level='mastered'` flows through PunyaService with key
 * `curriculum:{student_id}:{item_id}`.
 */

import { Module } from '@nestjs/common';

import {
  BatchesRepository,
  CentresRepository,
  CurriculumRepository,
  PunyaFeaturesRepository,
  PunyaTransactionsRepository,
  StudentsRepository,
} from '../../db/repositories';
import { AuditModule } from '../audit/audit.module';
import { PunyaModule } from '../punya/punya.module';

import { CurriculumController } from './curriculum.controller';
import { CurriculumService } from './curriculum.service';

@Module({
  imports: [AuditModule, PunyaModule],
  controllers: [CurriculumController],
  providers: [
    CurriculumService,
    CurriculumRepository,
    StudentsRepository,
    CentresRepository,
    BatchesRepository,
    PunyaFeaturesRepository,
    PunyaTransactionsRepository,
  ],
  exports: [CurriculumService],
})
export class CurriculumModule {}
