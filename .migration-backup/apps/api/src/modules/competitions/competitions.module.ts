/**
 * CompetitionsModule — Step 18.
 *
 * Wires the create / register / record-results / publish-results endpoints +
 * the Punya award path. Punya keys: `competition:{competition_id}:{student_id}`.
 */

import { Module } from '@nestjs/common';

import {
  CentresRepository,
  CompetitionRegistrationsRepository,
  CompetitionsRepository,
  MsvEnrolmentsRepository,
  PunyaFeaturesRepository,
  PunyaTransactionsRepository,
  StudentsRepository,
} from '../../db/repositories';
import { AuditModule } from '../audit/audit.module';
import { PunyaModule } from '../punya/punya.module';

import { CompetitionsController } from './competitions.controller';
import { CompetitionsService } from './competitions.service';

@Module({
  imports: [AuditModule, PunyaModule],
  controllers: [CompetitionsController],
  providers: [
    CompetitionsService,
    CompetitionsRepository,
    CompetitionRegistrationsRepository,
    StudentsRepository,
    CentresRepository,
    MsvEnrolmentsRepository,
    PunyaFeaturesRepository,
    PunyaTransactionsRepository,
  ],
  exports: [CompetitionsService],
})
export class CompetitionsModule {}
