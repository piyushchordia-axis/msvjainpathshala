/**
 * StudentNotesModule — Step 13 wiring.
 */

import { Module } from '@nestjs/common';

import { StudentNotesRepository } from '../../db/repositories/student-notes.repository';
import { StudentsRepository } from '../../db/repositories/students.repository';
import { AuditModule } from '../audit/audit.module';

import { StudentNotesController } from './student-notes.controller';
import { StudentNotesService } from './student-notes.service';

@Module({
  imports: [AuditModule],
  controllers: [StudentNotesController],
  providers: [StudentNotesService, StudentNotesRepository, StudentsRepository],
})
export class StudentNotesModule {}
