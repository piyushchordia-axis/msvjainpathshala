/**
 * GalleryModule — Step 17.
 *
 * Wires the public gallery read, admin feature/unfeature/remove, and the
 * parent's blanket gallery-visibility toggle (Q6).
 */

import { Module } from '@nestjs/common';

import { GalleryItemsRepository, StudentsRepository, UsersRepository } from '../../db/repositories';
import { AuditModule } from '../audit/audit.module';

import { GalleryController } from './gallery.controller';
import { GalleryService } from './gallery.service';

@Module({
  imports: [AuditModule],
  controllers: [GalleryController],
  providers: [GalleryService, GalleryItemsRepository, StudentsRepository, UsersRepository],
  exports: [GalleryService, GalleryItemsRepository],
})
export class GalleryModule {}
