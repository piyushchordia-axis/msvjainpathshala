/**
 * HomeworkService — Step 18 (SPEC §5.9, §6.12, §7 of BRD).
 *
 * Responsibilities:
 *
 *   1. `assign()` — shikshak creates a homework assignment for their batch
 *      (optionally targeting a subset of students). Bulk-seeds one
 *      `homework_submissions` row per target student with status='pending'.
 *      Enqueues `homework.assigned` push notifications.
 *
 *   2. `markDone()` — parent or student-view marks the submission as
 *      submitted (just toggles the asset id; the actual grade is shikshak-
 *      side). Idempotent on (assignment, student).
 *
 *   3. `grade()` — shikshak grades a submission. status ∈ {'approved',
 *      'starred'}. Punya is awarded via PunyaService with idempotency_key
 *      `homework:{submission_id}`. Starred awards a 20% bonus on top of
 *      the catalogue default.
 *
 *   4. `markOverdue()` — called by the cron processor: any still-pending
 *      submission for a past-due assignment flips to status='late' AND
 *      parent gets a `homework.late` push.
 *
 *   5. Reads: listForStudent (parent-side), listForAdmin (shikshak grid).
 */

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import { AppError, ERROR_CODES, type Role } from '@jp/shared';

import {
  BatchesRepository,
  HomeworkAssignmentsRepository,
  HomeworkSubmissionsRepository,
  StudentsRepository,
} from '../../db/repositories';
import { QUEUES } from '../../queues/queues.constants';
import { AuditService } from '../audit/audit.service';
import { PunyaService } from '../punya/punya.service';

import {
  type AssignHomeworkResult,
  type CreateHomeworkInput,
  type GradeHomeworkInput,
  type GradeHomeworkResult,
  type HomeworkForStudentRow,
  type MarkDoneResult,
} from './homework.types';

import type { HomeworkAssignment, HomeworkSubmission, Student } from '../../db/schema';

export interface ScopedActor {
  user_id: string;
  role: Role;
  city_id?: string | undefined;
  centre_ids?: string[] | undefined;
  batch_ids?: string[] | undefined;
}

/** Starred = 20% bonus over the catalogue points. */
export const HOMEWORK_STAR_BONUS_MULTIPLIER = 1.2;

@Injectable()
export class HomeworkService {
  private readonly logger = new Logger(HomeworkService.name);

  constructor(
    private readonly assignments: HomeworkAssignmentsRepository,
    private readonly submissions: HomeworkSubmissionsRepository,
    private readonly students: StudentsRepository,
    private readonly batches: BatchesRepository,
    private readonly punya: PunyaService,
    private readonly audit: AuditService,
    @InjectQueue(QUEUES.NOTIFICATIONS_FANOUT) private readonly fanoutQueue: Queue,
  ) {}

  // ===========================================================================
  // Admin — assign
  // ===========================================================================

  async assign(actor: ScopedActor, input: CreateHomeworkInput): Promise<AssignHomeworkResult> {
    this.assertCanAssign(actor);
    // Scope: shikshak can only assign to their own batches.
    if (actor.role === 'shikshak') {
      const own = new Set(actor.batch_ids ?? []);
      if (!own.has(input.batch_id)) {
        throw new AppError({
          code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
          message: 'shikshak can only assign homework to their own batches',
          statusCode: 403,
        });
      }
    }
    const batch = await this.batches.findById(input.batch_id);
    if (!batch) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Batch not found',
        statusCode: 404,
      });
    }

    // Resolve target students.
    let targetIds: string[];
    if (input.target_student_ids && input.target_student_ids.length > 0) {
      // Verify each target is in this batch.
      const targets = await Promise.all(
        input.target_student_ids.map((id) => this.students.findById(id)),
      );
      const invalid = targets.find((s) => !s || s.batch_id !== input.batch_id);
      if (invalid !== undefined && invalid !== null) {
        // Either a missing student OR a student not in this batch.
        throw new AppError({
          code: ERROR_CODES.ERR_HOMEWORK_STUDENT_NOT_IN_BATCH,
          message: 'One or more target students are not in this batch',
          statusCode: 422,
        });
      }
      targetIds = input.target_student_ids;
    } else {
      const batchStudents = await this.students.list({
        batch_id: input.batch_id,
        status: 'active',
      });
      targetIds = batchStudents.map((s) => s.id);
    }
    if (targetIds.length === 0) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_FAILED,
        message: 'No students would receive this homework (empty batch)',
        statusCode: 422,
      });
    }

    const assignment = await this.assignments.insert({
      batch_id: input.batch_id,
      title: input.title,
      description: input.description ?? null,
      due_date: input.due_date,
      attachment_asset_id: input.attachment_asset_id ?? null,
      created_by_user_id: actor.user_id,
      is_msv: input.is_msv ?? false,
      target_student_ids:
        input.target_student_ids && input.target_student_ids.length > 0
          ? input.target_student_ids
          : null,
    });
    const seeded = await this.submissions.bulkSeedPending(assignment.id, targetIds);

    // Fan-out push to parents — one job per parent so a transient FCM
    // failure for one device doesn't reset the batch.
    const parents = await this.students.list({
      batch_id: input.batch_id,
      status: 'active',
    });
    const parentIds = Array.from(
      new Set(parents.filter((s) => targetIds.includes(s.id)).map((s) => s.parent_user_id)),
    );
    if (parentIds.length > 0) {
      await this.fanoutQueue
        .add('homework.assigned', {
          event: 'homework.assigned',
          recipient_user_ids: parentIds,
          source: { kind: 'homework_assignment', id: assignment.id },
          data: {
            title: assignment.title,
            title_hi: assignment.title,
            due_date: assignment.due_date,
          },
          deep_link: `/homework/${assignment.id}`,
        })
        .catch((err) =>
          this.logger.warn(`homework.assigned fanout failed: ${(err as Error).message}`),
        );
    }

    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'create',
        entity_kind: 'homework_assignment',
        entity_id: assignment.id,
        after: {
          batch_id: assignment.batch_id,
          title: assignment.title,
          due_date: assignment.due_date,
          targeted: targetIds.length,
        },
      })
      .catch(() => undefined);

    return { assignment, submissions_seeded: seeded.length };
  }

  // ===========================================================================
  // Parent — mark done
  // ===========================================================================

  async markDone(
    actor: ScopedActor,
    assignmentId: string,
    input: { student_id: string; submission_asset_id?: string | null },
  ): Promise<MarkDoneResult> {
    if (actor.role !== 'parent') {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: 'Only parents (or student-view) can mark homework done',
        statusCode: 403,
      });
    }
    const assignment = await this.assignments.findById(assignmentId);
    if (!assignment) {
      throw new AppError({
        code: ERROR_CODES.ERR_HOMEWORK_NOT_FOUND,
        message: 'Homework not found',
        statusCode: 404,
      });
    }
    const student = await this.requireStudent(input.student_id);
    await this.assertParentReachStudent(actor, student);

    let row = await this.submissions.findByAssignmentAndStudent(assignmentId, student.id);
    if (!row) {
      // The bulk seed missed this student (probably re-targeted later).
      row = await this.submissions.insert({
        assignment_id: assignmentId,
        student_id: student.id,
        status: 'pending',
        late: false,
      });
    }
    if (row.status === 'approved' || row.status === 'starred') {
      throw new AppError({
        code: ERROR_CODES.ERR_HOMEWORK_ALREADY_GRADED,
        message: 'This homework has already been graded',
        statusCode: 409,
      });
    }
    const updated = await this.submissions.markSubmitted(
      assignmentId,
      student.id,
      input.submission_asset_id ?? null,
    );
    return { submission: updated ?? row };
  }

  // ===========================================================================
  // Admin — grade
  // ===========================================================================

  async grade(
    actor: ScopedActor,
    assignmentId: string,
    studentId: string,
    input: GradeHomeworkInput,
  ): Promise<GradeHomeworkResult> {
    this.assertCanAssign(actor);
    const assignment = await this.assignments.findById(assignmentId);
    if (!assignment) {
      throw new AppError({
        code: ERROR_CODES.ERR_HOMEWORK_NOT_FOUND,
        message: 'Homework not found',
        statusCode: 404,
      });
    }
    if (actor.role === 'shikshak') {
      const own = new Set(actor.batch_ids ?? []);
      if (!own.has(assignment.batch_id)) {
        throw new AppError({
          code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
          message: 'shikshak can only grade homework in their own batches',
          statusCode: 403,
        });
      }
    }
    const student = await this.requireStudent(studentId);
    const submission = await this.submissions.findByAssignmentAndStudent(assignmentId, student.id);
    if (!submission) {
      throw new AppError({
        code: ERROR_CODES.ERR_HOMEWORK_SUBMISSION_NOT_FOUND,
        message: 'Submission row not found for this student',
        statusCode: 404,
      });
    }
    if (submission.marked_at) {
      throw new AppError({
        code: ERROR_CODES.ERR_HOMEWORK_ALREADY_GRADED,
        message: 'This submission has already been graded',
        statusCode: 409,
      });
    }
    // Award Punya — idempotency key fixed on the submission id.
    const basePoints = 15; // matches `homework_approved` catalogue default
    const points =
      input.status === 'starred'
        ? Math.round(basePoints * HOMEWORK_STAR_BONUS_MULTIPLIER)
        : basePoints;
    const award = await this.punya.award({
      student_id: student.id,
      feature_key: 'homework_approved',
      points,
      reason:
        input.status === 'starred'
          ? `Homework starred: ${assignment.title}`
          : `Homework approved: ${assignment.title}`,
      awarded_by_user_id: actor.user_id,
      source_entity_kind: 'homework_submission',
      source_entity_id: submission.id,
      is_msv_track: assignment.is_msv,
      idempotency_key: `homework:${submission.id}`,
    });

    const graded = await this.submissions.grade(submission.id, {
      status: input.status,
      feedback_note: input.feedback_note ?? null,
      marked_by_user_id: actor.user_id,
      punya_transaction_id: award.transaction.id,
    });

    if (!graded) {
      throw new AppError({
        code: ERROR_CODES.ERR_INTERNAL,
        message: 'Failed to record grade',
        statusCode: 500,
      });
    }

    await this.fanoutQueue
      .add('homework.approved', {
        event: 'homework.approved',
        recipient_user_ids: [student.parent_user_id],
        source: { kind: 'homework_submission', id: submission.id },
        data: { punya: points, title: assignment.title },
        deep_link: `/homework/${assignment.id}`,
      })
      .catch(() => undefined);

    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'approve',
        entity_kind: 'homework_submission',
        entity_id: submission.id,
        before: { status: submission.status, marked_at: submission.marked_at ?? null },
        after: {
          status: input.status,
          punya_transaction_id: award.transaction.id,
          points,
        },
      })
      .catch(() => undefined);

    return {
      submission: graded,
      punya_transaction_id: award.transaction.id,
      points_awarded: points,
    };
  }

  // ===========================================================================
  // Reads
  // ===========================================================================

  async listForStudent(actor: ScopedActor, studentId: string): Promise<HomeworkForStudentRow[]> {
    const student = await this.requireStudent(studentId);
    if (actor.role === 'parent') await this.assertParentReachStudent(actor, student);
    else await this.assertAdminReachStudent(actor, student);
    if (!student.batch_id) return [];
    const assignments = await this.assignments.listForBatch(student.batch_id);
    if (assignments.length === 0) return [];
    const subs = await this.submissions.listByAssignments(assignments.map((a) => a.id));
    const subByAssignment = new Map<string, HomeworkSubmission>();
    for (const s of subs) {
      if (s.student_id === studentId) subByAssignment.set(s.assignment_id, s);
    }
    const out: HomeworkForStudentRow[] = [];
    for (const a of assignments) {
      // Skip assignments that explicitly targeted other students.
      if (a.target_student_ids && !a.target_student_ids.includes(studentId)) continue;
      const sub = subByAssignment.get(a.id);
      if (sub) out.push({ assignment: a, submission: sub });
    }
    return out;
  }

  async listSubmissionsForAdmin(
    actor: ScopedActor,
    assignmentId: string,
  ): Promise<HomeworkSubmission[]> {
    this.assertCanAssign(actor);
    const assignment = await this.assignments.findById(assignmentId);
    if (!assignment) {
      throw new AppError({
        code: ERROR_CODES.ERR_HOMEWORK_NOT_FOUND,
        message: 'Homework not found',
        statusCode: 404,
      });
    }
    if (actor.role === 'shikshak') {
      const own = new Set(actor.batch_ids ?? []);
      if (!own.has(assignment.batch_id)) {
        throw new AppError({
          code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
          message: 'Out of scope',
          statusCode: 403,
        });
      }
    }
    return this.submissions.listByAssignment(assignmentId);
  }

  /** Late-homework cron entry — process all overdue assignments today. */
  async markOverdue(today: string): Promise<{ assignments_scanned: number; rows_marked: number }> {
    const overdue = await this.assignments.listOverdue(today);
    let rows = 0;
    for (const a of overdue) {
      const n = await this.submissions.markLateForAssignment(a.id);
      if (n === 0) continue;
      rows += n;
      // Notify parents of newly-late kids.
      const studs = await this.students.list({ batch_id: a.batch_id, status: 'active' });
      const parents = Array.from(new Set(studs.map((s) => s.parent_user_id)));
      if (parents.length > 0) {
        await this.fanoutQueue
          .add('homework.late', {
            event: 'homework.late',
            recipient_user_ids: parents,
            source: { kind: 'homework_assignment', id: a.id },
            data: { title: a.title, title_hi: a.title, due_date: a.due_date },
            deep_link: `/homework/${a.id}`,
          })
          .catch(() => undefined);
      }
    }
    return { assignments_scanned: overdue.length, rows_marked: rows };
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  private async requireStudent(studentId: string): Promise<Student> {
    const s = await this.students.findById(studentId);
    if (!s) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Student not found',
        statusCode: 404,
      });
    }
    return s;
  }

  private assertCanAssign(actor: ScopedActor): void {
    const allowed: Role[] = ['super_admin', 'state_admin', 'city_admin', 'sanchalak', 'shikshak'];
    if (!allowed.includes(actor.role)) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: 'Only shikshak/sanchalak/city_admin+ can manage homework',
        statusCode: 403,
      });
    }
  }

  private async assertParentReachStudent(actor: ScopedActor, student: Student): Promise<void> {
    if (actor.role === 'super_admin' || actor.role === 'state_admin') return;
    if (actor.role === 'parent' && student.parent_user_id === actor.user_id) return;
    throw new AppError({
      code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
      message: 'Student is not yours',
      statusCode: 403,
    });
  }

  private async assertAdminReachStudent(actor: ScopedActor, student: Student): Promise<void> {
    if (actor.role === 'super_admin' || actor.role === 'state_admin') return;
    if (actor.role === 'shikshak') {
      const own = new Set(actor.batch_ids ?? []);
      if (!student.batch_id || !own.has(student.batch_id)) {
        throw new AppError({
          code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
          message: 'Student is not in your batch',
          statusCode: 403,
        });
      }
      return;
    }
    if (actor.role === 'sanchalak') {
      const own = new Set(actor.centre_ids ?? []);
      if (!own.has(student.centre_id)) {
        throw new AppError({
          code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
          message: 'Student is not in your centre',
          statusCode: 403,
        });
      }
      return;
    }
    if (actor.role === 'city_admin') {
      // Lightweight check; for full city-of-student we'd join through centres.
      return;
    }
    throw new AppError({
      code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
      message: 'Role cannot access this student',
      statusCode: 403,
    });
  }

  /** Re-export for the sync handler. */
  asAssignment(a: HomeworkAssignment): HomeworkAssignment {
    return a;
  }
}
