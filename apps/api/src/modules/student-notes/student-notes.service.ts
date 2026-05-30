/**
 * StudentNotesService — Step 13 (SPEC §5.20). Shikshak working notes on a
 * student. Backed by the `student_notes` table (single `note` text column,
 * soft-deletable). Never shown to parent/student.
 *
 * Scope (who may write/read notes for a student):
 *   - super_admin / state_admin / city_admin → any student
 *   - sanchalak → student.centre_id ∈ actor.centre_ids
 *   - shikshak  → student.batch_id  ∈ actor.batch_ids
 */

import { Injectable } from '@nestjs/common';

import { AppError, ERROR_CODES, type Role } from '@jp/shared';

import { StudentNotesRepository } from '../../db/repositories/student-notes.repository';
import { StudentsRepository } from '../../db/repositories/students.repository';
import { AuditService } from '../audit/audit.service';

import type { StudentNote } from '../../db/schema';

export interface NotesActor {
  user_id: string;
  role: Role;
  city_id?: string | undefined;
  centre_ids?: string[] | undefined;
  batch_ids?: string[] | undefined;
}

@Injectable()
export class StudentNotesService {
  constructor(
    private readonly repo: StudentNotesRepository,
    private readonly students: StudentsRepository,
    private readonly audit: AuditService,
  ) {}

  async create(
    actor: NotesActor,
    studentId: string,
    input: { note: string },
  ): Promise<StudentNote> {
    await this.assertStudentInScope(actor, studentId);
    const note = input.note?.trim();
    if (!note) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_FAILED,
        message: 'Note text is required',
        statusCode: 422,
      });
    }
    const row = await this.repo.insert({
      student_id: studentId,
      author_user_id: actor.user_id,
      note,
    });
    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'create',
        entity_kind: 'student_note',
        entity_id: row.id,
        after: { student_id: studentId },
      })
      .catch(() => undefined);
    return row;
  }

  async listForStudent(actor: NotesActor, studentId: string): Promise<StudentNote[]> {
    await this.assertStudentInScope(actor, studentId);
    return this.repo.listForStudent(studentId);
  }

  // ===========================================================================
  // Scope
  // ===========================================================================

  private async assertStudentInScope(actor: NotesActor, studentId: string): Promise<void> {
    const allowed: Role[] = ['shikshak', 'sanchalak', 'city_admin', 'state_admin', 'super_admin'];
    if (!allowed.includes(actor.role)) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: 'Only staff can manage student notes',
        statusCode: 403,
      });
    }
    const student = await this.students.findById(studentId);
    if (!student) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Student not found',
        statusCode: 404,
      });
    }
    if (
      actor.role === 'super_admin' ||
      actor.role === 'state_admin' ||
      actor.role === 'city_admin'
    ) {
      return;
    }
    if (actor.role === 'sanchalak') {
      const own = new Set(actor.centre_ids ?? []);
      if (!own.has(student.centre_id)) {
        throw new AppError({
          code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
          message: 'Student is outside your centre scope',
          statusCode: 403,
        });
      }
      return;
    }
    // shikshak
    const ownBatches = new Set(actor.batch_ids ?? []);
    if (!student.batch_id || !ownBatches.has(student.batch_id)) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
        message: 'Student is outside the batches you teach',
        statusCode: 403,
      });
    }
  }
}
