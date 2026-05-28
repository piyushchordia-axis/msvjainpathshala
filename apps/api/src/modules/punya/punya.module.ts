/**
 * PunyaModule — Step 16.
 *
 * Exports `PunyaService` so domain modules (attendance/niyam/homework/exam)
 * can `award()` directly instead of writing to the ledger by hand.
 *
 * Wired modules:
 *   - AuditModule for the manual-award + reverse audit rows.
 *   - QueuesModule (global) provides the BullMQ tokens for the leaderboard
 *     refresh and notifications fanout queues.
 */

import { Module } from '@nestjs/common';

import {
  CentresRepository,
  PunyaFeaturesRepository,
  PunyaTransactionsRepository,
  StudentsRepository,
} from '../../db/repositories';
import { AuditModule } from '../audit/audit.module';

import { LeaderboardService } from './leaderboard.service';
import { PunyaReconcileService } from './punya-reconcile.service';
import { PunyaController } from './punya.controller';
import { PunyaService } from './punya.service';

@Module({
  imports: [AuditModule],
  controllers: [PunyaController],
  providers: [
    PunyaService,
    LeaderboardService,
    PunyaReconcileService,
    PunyaFeaturesRepository,
    PunyaTransactionsRepository,
    StudentsRepository,
    CentresRepository,
  ],
  exports: [PunyaService, LeaderboardService, PunyaReconcileService],
})
export class PunyaModule {}
