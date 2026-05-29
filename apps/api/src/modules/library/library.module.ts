/**
 * LibraryModule — Step 22 (SPEC §5.16, §6.20).
 *
 * Wires the four-tier library: list/read endpoints are public (callers'
 * visible tier is computed from role + MSV state); create/delete are
 * shikshak+ scoped. Q7 invariants (video → embed_url, others → asset_id)
 * are enforced both at the Zod and service layers.
 */

import { Module } from '@nestjs/common';

import {
  LibraryRepository,
  MsvEnrolmentsRepository,
  StudentsRepository,
} from '../../db/repositories';

import { LibraryController } from './library.controller';
import { LibraryService } from './library.service';

@Module({
  controllers: [LibraryController],
  providers: [LibraryService, LibraryRepository, StudentsRepository, MsvEnrolmentsRepository],
  exports: [LibraryService, LibraryRepository],
})
export class LibraryModule {}
