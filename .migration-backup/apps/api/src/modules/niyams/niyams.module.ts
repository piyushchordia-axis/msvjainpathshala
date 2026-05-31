/**
 * NiyamsModule — Step 17.
 *
 * Wires the niyam CRUD + auto-approve submit + retro-reject (Q5) flows.
 *
 *   - Auto-approval awards Punya transactionally via PunyaService.
 *   - Gallery insert (Q6) goes through GalleryItemsRepository inline; the
 *     bulk opt-in/opt-out backfill is handled by GalleryService.
 *   - niyam.streak.recompute jobs are enqueued by this service; the
 *     processor lives under apps/api/src/queues/processors/.
 */

import { Module } from '@nestjs/common';

import {
  CentresRepository,
  GalleryItemsRepository,
  MediaAssetsRepository,
  MsvEnrolmentsRepository,
  NiyamsRepository,
  NiyamStreaksRepository,
  NiyamSubmissionsRepository,
  PunyaFeaturesRepository,
  PunyaTransactionsRepository,
  StudentsRepository,
  UsersRepository,
} from '../../db/repositories';
import { AuditModule } from '../audit/audit.module';
import { PunyaModule } from '../punya/punya.module';

import { NiyamSubmissionSyncHandler } from './handlers/niyam-submission.handler';
import { NiyamsController } from './niyams.controller';
import { NiyamsService } from './niyams.service';

@Module({
  imports: [AuditModule, PunyaModule],
  controllers: [NiyamsController],
  providers: [
    NiyamsService,
    NiyamSubmissionSyncHandler,
    NiyamsRepository,
    NiyamSubmissionsRepository,
    NiyamStreaksRepository,
    GalleryItemsRepository,
    StudentsRepository,
    UsersRepository,
    CentresRepository,
    MediaAssetsRepository,
    MsvEnrolmentsRepository,
    PunyaTransactionsRepository,
    PunyaFeaturesRepository,
  ],
  exports: [
    NiyamsService,
    NiyamSubmissionSyncHandler,
    NiyamsRepository,
    NiyamSubmissionsRepository,
    NiyamStreaksRepository,
  ],
})
export class NiyamsModule {}
