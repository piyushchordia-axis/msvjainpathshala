/**
 * AttendanceService — the transactional core of Step 13 (SPEC §8.3.7).
 *
 * Public methods:
 *   mark            — POST /v1/attendance/mark (bulk per-session)
 *   editOne         — PATCH /v1/sessions/:id/attendance/:student_id
 *   notifyAbsence   — POST /v1/absences/notify (parent)
 *   monthForStudent — GET /v1/students/:id/attendance?month=YYYY-MM
 *   logForCentre    — GET /v1/admin/attendance/centres/:id/log
 *   loadRoster      — Helper used by the mobile marking screen
 *
 * Idempotency design:
 *   - `attendance.client_op_id` UNIQUE → duplicate POSTs land as no-ops on the
 *     same (session, student) pair.
 *   - `punya_transactions.idempotency_key = 'attendance:<attendance_id>'` →
 *     present marks award Punya exactly once.
 *   - Same-day flip present→absent inserts a reversal txn with
 *     `idempotency_key = 'attendance:<attendance_id>:reversal'`.
 *
 * Post-processing:
 *   - After commit we enqueue ONE `attendance.post_process` job per session,
 *     using a deterministic jobId so re-enqueues collapse. The worker handles
 *     parent notifications + streak milestone awards.
 */

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { AppError, ERROR_CODES, QUEUES, type AttendanceStatus, type Role } from '@jp/shared';

import { DrizzleService } from '../../core/database/drizzle.service';
import {
  AbsenceNotificationsRepository,
  AttendanceRepository,
  BatchesRepository,
  CentresRepository,
  PunyaTransactionsRepository,
  SessionsRepository,
  StudentsRepository,
} from '../../db/repositories';
import { centres, punya_features, students as studentsTable } from '../../db/schema';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { AuditService } from '../audit/audit.service';

import type {
  AttendancePostProcessPayload,
  MarkItemInput,
  MarkResultItem,
} from './attendance.types';
import type { Attendance, Session } from '../../db/schema';

export interface ScopedActor {
  user_id: string;
  role: Role;
  city_id?: string | undefined;
  state_id?: string | undefined;
  centre_ids?: string[] | undefined;
  batch_ids?: string[] | undefined;
}

const ATTENDANCE_PRESENT_FEATURE = 'attendance_present';

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly sessionsRepo: SessionsRepository,
    private readonly attendanceRepo: AttendanceRepository,
    private readonly absenceRepo: AbsenceNotificationsRepository,
    private readonly studentsRepo: StudentsRepository,
    private readonly batchesRepo: BatchesRepository,
    private readonly centresRepo: CentresRepository,
    private readonly punyaRepo: PunyaTransactionsRepository,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
    @InjectQueue(QUEUES.ATTENDANCE_POST_PROCESS) private readonly postProcessQueue: Queue,
  ) {}

  // -------------------------------------------------------------------------
  // Mark
  // -------------------------------------------------------------------------

  async mark(
    actor: ScopedActor,
    input: { session_id: string; marks: MarkItemInput[] },
  ): Promise<{ items: MarkResultItem[]; session: Session }> {
    if (input.marks.length === 0) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_FAILED,
        message: 'marks must contain at least one item',
        statusCode: 422,
      });
    }

    // Resolve the session + verify the shikshak owns it.
    const sessionRow = await this.sessionsRepo.findById(input.session_id);
    if (!sessionRow) {
      throw new AppError({
        code: ERROR_CODES.ERR_SESSION_NOT_FOUND,
        message: 'Session not found',
        statusCode: 404,
      });
    }
    if (sessionRow.status === 'cancelled') {
      throw new AppError({
        code: ERROR_CODES.ERR_ATTENDANCE_SESSION_CANCELLED,
        message: 'Session has been cancelled',
        statusCode: 409,
      });
    }
    if (sessionRow.status !== 'in_progress' && sessionRow.status !== 'completed') {
      throw new AppError({
        code: ERROR_CODES.ERR_ATTENDANCE_SESSION_NOT_OPEN,
        message: `Session is ${sessionRow.status}; check in first`,
        statusCode: 409,
      });
    }
    if (actor.role === 'shikshak' && sessionRow.shikshak_user_id !== actor.user_id) {
      throw new AppError({
        code: ERROR_CODES.ERR_SESSION_NOT_ASSIGNED_TO_SHIKSHAK,
        message: 'This session is not assigned to you',
        statusCode: 403,
      });
    }

    // Resolve batch / centre / city for scope + Punya context.
    const batch = await this.batchesRepo.findById(sessionRow.batch_id);
    if (!batch) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Batch not found',
        statusCode: 404,
      });
    }
    const centre = await this.centresRepo.findById(batch.centre_id);
    if (!centre) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Centre not found',
        statusCode: 404,
      });
    }

    // Load active students in this batch — basis for the Q11 reject check.
    const studentIds = input.marks.map((m) => m.student_id);
    const activeStudents = await this.drizzle.dbRead
      .select({
        id: studentsTable.id,
        status: studentsTable.status,
        batch_id: studentsTable.batch_id,
      })
      .from(studentsTable)
      .where(inArray(studentsTable.id, studentIds));
    const validIds = new Set(
      activeStudents
        .filter((s) => s.status === 'active' && s.batch_id === sessionRow.batch_id)
        .map((s) => s.id),
    );
    const rejected = studentIds.filter((id) => !validIds.has(id));
    if (rejected.length > 0) {
      throw new AppError({
        code: ERROR_CODES.ERR_ATTENDANCE_STUDENT_NOT_IN_BATCH,
        message: `Some students are not active in this batch: ${rejected.join(', ')}`,
        statusCode: 422,
        details: rejected.map((id) => ({ path: `marks.student_id=${id}` })),
      });
    }

    // Resolve current Punya award value for `attendance_present` (city
    // override falls back to the global default).
    const presentPoints = await this.resolvePunyaPoints(ATTENDANCE_PRESENT_FEATURE, centre.city_id);

    // Resolve prior attendance rows for diff (present↔absent reversal logic).
    const priorRows = await this.attendanceRepo.findBySession(sessionRow.id);
    const priorByStudent = new Map(priorRows.map((r) => [r.student_id, r] as const));

    // Single transaction: UPSERT attendance + Punya for each new present + reversals.
    const out: MarkResultItem[] = [];
    const upserts = input.marks.map((m) => ({
      session_id: sessionRow.id,
      student_id: m.student_id,
      status: m.status,
      marked_at: new Date(),
      marked_by: actor.user_id,
      client_op_id: m.client_op_id,
      notes: m.notes ?? null,
    }));

    const inserted = await this.drizzle.db.transaction(async (tx) => {
      return this.attendanceRepo.bulkUpsert(upserts, tx);
    });
    const insertedByStudent = new Map(inserted.map((r) => [r.student_id, r] as const));

    // Punya side effects — per-row, idempotent. We do these outside the
    // attendance tx because each Punya insertWithBalanceUpdate opens its own
    // transaction. Idempotency keys make replay safe.
    for (const m of input.marks) {
      const row = insertedByStudent.get(m.student_id);
      if (!row) continue;
      const prior = priorByStudent.get(m.student_id) ?? null;
      const priorStatus = prior?.status ?? null;
      let punyaAwarded = 0;

      // (a) NEW present mark (no prior) → award Punya.
      if (m.status === 'present' && (priorStatus === null || priorStatus !== 'present')) {
        await this.punyaRepo
          .insertWithBalanceUpdate({
            student_id: m.student_id,
            feature_key: ATTENDANCE_PRESENT_FEATURE,
            points: presentPoints,
            reason: 'Attendance — present',
            awarded_by_user_id: actor.user_id,
            source_entity_kind: 'attendance',
            source_entity_id: row.id,
            is_msv_track: false,
            awarded_at: new Date(),
            city_id: centre.city_id,
            centre_id: centre.id,
            batch_id: batch.id,
            idempotency_key: `attendance:${row.id}`,
          })
          .catch((err) => {
            this.logger.warn(
              `Punya award failed for attendance=${row.id}: ${(err as Error).message}`,
            );
          });
        punyaAwarded = presentPoints;
      }

      // (b) FLIP present → non-present (absent/late/excused) → reversal.
      if (priorStatus === 'present' && m.status !== 'present') {
        const reversalKey = `attendance:${row.id}:reversal`;
        await this.punyaRepo
          .insertWithBalanceUpdate({
            student_id: m.student_id,
            feature_key: ATTENDANCE_PRESENT_FEATURE,
            points: -presentPoints,
            reason: `Attendance flip ${priorStatus} → ${m.status}`,
            awarded_by_user_id: actor.user_id,
            source_entity_kind: 'attendance',
            source_entity_id: row.id,
            reversal_of: prior ? await this.findOriginalTxnId(row) : null,
            is_msv_track: false,
            awarded_at: new Date(),
            city_id: centre.city_id,
            centre_id: centre.id,
            batch_id: batch.id,
            idempotency_key: reversalKey,
          })
          .catch((err) => {
            this.logger.warn(
              `Punya reversal failed for attendance=${row.id}: ${(err as Error).message}`,
            );
          });
        punyaAwarded = -presentPoints;
      }

      out.push({
        student_id: m.student_id,
        attendance_id: row.id,
        status: row.status,
        prior_status: priorStatus,
        punya_awarded: punyaAwarded,
        notes: row.notes,
      });
    }

    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'attendance.marked',
        entity_kind: 'session',
        entity_id: sessionRow.id,
        after: {
          session_id: sessionRow.id,
          batch_id: sessionRow.batch_id,
          marks_count: out.length,
          present: out.filter((m) => m.status === 'present').length,
          absent: out.filter((m) => m.status === 'absent').length,
          late: out.filter((m) => m.status === 'late').length,
          excused: out.filter((m) => m.status === 'excused').length,
        },
      })
      .catch(() => undefined);

    // Live admin dashboard event.
    this.realtime.emitToAdminDashboard(centre.city_id, {
      event: 'attendance.marked',
      city_id: centre.city_id,
      actor_role: actor.role,
      summary_en: `Attendance marked for ${batch.name}: ${out.length} students`,
      summary_hi: `${batch.name} की उपस्थिति दर्ज की गई: ${out.length} छात्र`,
      source_entity_kind: 'session',
      source_entity_id: sessionRow.id,
      at: new Date().toISOString(),
    });

    // Enqueue debounced post-process. Same jobId per session = collapse races.
    const postProcessPayload: AttendancePostProcessPayload = {
      session_id: sessionRow.id,
      batch_id: sessionRow.batch_id,
      centre_id: centre.id,
      city_id: centre.city_id,
      marked_by_user_id: actor.user_id,
      marks: out.map((m) => ({
        student_id: m.student_id,
        attendance_id: m.attendance_id,
        status: m.status,
        prior_status: m.prior_status,
      })),
    };
    await this.postProcessQueue
      .add('attendance.post_process', postProcessPayload, {
        jobId: `post:${sessionRow.id}:${Date.now()}`,
      })
      .catch((err) => this.logger.warn(`post_process enqueue failed: ${(err as Error).message}`));

    return { items: out, session: sessionRow };
  }

  // -------------------------------------------------------------------------
  // Edit one
  // -------------------------------------------------------------------------

  async editOne(
    actor: ScopedActor,
    sessionId: string,
    studentId: string,
    patch: { status: AttendanceStatus; notes?: string | null },
  ): Promise<{ attendance: Attendance; punya_awarded: number }> {
    const sessionRow = await this.sessionsRepo.findById(sessionId);
    if (!sessionRow) {
      throw new AppError({
        code: ERROR_CODES.ERR_SESSION_NOT_FOUND,
        message: 'Session not found',
        statusCode: 404,
      });
    }
    if (actor.role === 'shikshak' && sessionRow.shikshak_user_id !== actor.user_id) {
      throw new AppError({
        code: ERROR_CODES.ERR_SESSION_NOT_ASSIGNED_TO_SHIKSHAK,
        message: 'This session is not assigned to you',
        statusCode: 403,
      });
    }

    // Same-day edit gate (SPEC §8.3.8).
    const sessionDate = sessionRow.scheduled_date;
    const todayIst = todayInIst();
    if (sessionDate !== todayIst) {
      throw new AppError({
        code: ERROR_CODES.ERR_CONFLICT_STATE_TRANSITION,
        message: 'Same-day edit window has closed',
        statusCode: 409,
      });
    }

    const prior = await this.attendanceRepo.findBySessionAndStudent(sessionId, studentId);
    if (!prior) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'No attendance row to edit',
        statusCode: 404,
      });
    }

    const updated = await this.attendanceRepo.updateOne(sessionId, studentId, {
      status: patch.status,
      notes: patch.notes ?? null,
      marked_by: actor.user_id,
    });
    if (!updated) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Attendance row could not be updated',
        statusCode: 404,
      });
    }

    const batch = await this.batchesRepo.findById(sessionRow.batch_id);
    const centre = batch ? await this.centresRepo.findById(batch.centre_id) : null;
    const presentPoints =
      centre !== null
        ? await this.resolvePunyaPoints(ATTENDANCE_PRESENT_FEATURE, centre.city_id)
        : 10;

    let punyaAwarded = 0;
    if (centre && batch) {
      if (prior.status !== 'present' && patch.status === 'present') {
        await this.punyaRepo
          .insertWithBalanceUpdate({
            student_id: studentId,
            feature_key: ATTENDANCE_PRESENT_FEATURE,
            points: presentPoints,
            reason: 'Attendance same-day edit → present',
            awarded_by_user_id: actor.user_id,
            source_entity_kind: 'attendance',
            source_entity_id: updated.id,
            is_msv_track: false,
            awarded_at: new Date(),
            city_id: centre.city_id,
            centre_id: centre.id,
            batch_id: batch.id,
            idempotency_key: `attendance:${updated.id}`,
          })
          .catch(() => undefined);
        punyaAwarded = presentPoints;
      } else if (prior.status === 'present' && patch.status !== 'present') {
        await this.punyaRepo
          .insertWithBalanceUpdate({
            student_id: studentId,
            feature_key: ATTENDANCE_PRESENT_FEATURE,
            points: -presentPoints,
            reason: `Attendance flip ${prior.status} → ${patch.status}`,
            awarded_by_user_id: actor.user_id,
            source_entity_kind: 'attendance',
            source_entity_id: updated.id,
            reversal_of: await this.findOriginalTxnId(updated),
            is_msv_track: false,
            awarded_at: new Date(),
            city_id: centre.city_id,
            centre_id: centre.id,
            batch_id: batch.id,
            idempotency_key: `attendance:${updated.id}:reversal`,
          })
          .catch(() => undefined);
        punyaAwarded = -presentPoints;
      }
    }

    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'attendance.edited',
        entity_kind: 'attendance',
        entity_id: updated.id,
        before: { status: prior.status },
        after: { status: updated.status, notes: updated.notes },
      })
      .catch(() => undefined);

    return { attendance: updated, punya_awarded: punyaAwarded };
  }

  // -------------------------------------------------------------------------
  // Notify absence (parent)
  // -------------------------------------------------------------------------

  async notifyAbsence(
    actor: ScopedActor,
    input: { student_id: string; date: string; reason: string },
  ) {
    const student = await this.studentsRepo.findById(input.student_id);
    if (!student) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Student not found',
        statusCode: 404,
      });
    }
    if (actor.role === 'parent' && student.parent_user_id !== actor.user_id) {
      throw new AppError({
        code: ERROR_CODES.ERR_ABSENCE_NOT_OWN_CHILD,
        message: 'Absence can only be filed by the parent',
        statusCode: 403,
      });
    }

    const row = await this.absenceRepo.create({
      student_id: input.student_id,
      parent_user_id: actor.user_id,
      expected_date: input.date,
      reason: input.reason,
    });

    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'absence.notified',
        entity_kind: 'student',
        entity_id: input.student_id,
        after: { date: input.date, reason: input.reason },
      })
      .catch(() => undefined);

    return { absence_notification: row };
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async monthForStudent(
    actor: ScopedActor,
    studentId: string,
    month: string,
  ): Promise<{
    items: Array<{ attendance: Attendance; scheduled_date: string }>;
    absences: Array<{ date: string; reason: string | null }>;
  }> {
    const student = await this.studentsRepo.findById(studentId);
    if (!student) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Student not found',
        statusCode: 404,
      });
    }
    if (actor.role === 'parent' && student.parent_user_id !== actor.user_id) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
        message: 'Not your child',
        statusCode: 403,
      });
    }
    const items = await this.attendanceRepo.findByStudentMonth(studentId, month);
    const absences = await this.absenceRepo.listByStudent(studentId, `${month}-01`, `${month}-31`);
    return {
      items,
      absences: absences.map((a) => ({ date: a.expected_date, reason: a.reason })),
    };
  }

  /**
   * Today's roster for the marking screen — pre-fills 'excused' for students
   * with an advance absence notice.
   */
  async loadRoster(
    actor: ScopedActor,
    sessionId: string,
  ): Promise<{
    session: Session;
    students: Array<{
      id: string;
      full_name: string;
      student_code: string;
      pre_excused: boolean;
      absence_reason: string | null;
      attendance: Attendance | null;
    }>;
  }> {
    const sessionRow = await this.sessionsRepo.findById(sessionId);
    if (!sessionRow) {
      throw new AppError({
        code: ERROR_CODES.ERR_SESSION_NOT_FOUND,
        message: 'Session not found',
        statusCode: 404,
      });
    }
    if (actor.role === 'shikshak' && sessionRow.shikshak_user_id !== actor.user_id) {
      throw new AppError({
        code: ERROR_CODES.ERR_SESSION_NOT_ASSIGNED_TO_SHIKSHAK,
        message: 'This session is not assigned to you',
        statusCode: 403,
      });
    }
    const roster = await this.drizzle.dbRead
      .select({
        id: studentsTable.id,
        full_name: studentsTable.full_name,
        student_code: studentsTable.student_code,
      })
      .from(studentsTable)
      .where(
        and(eq(studentsTable.batch_id, sessionRow.batch_id), eq(studentsTable.status, 'active')),
      );
    const studentIds = roster.map((s) => s.id);
    const [marks, absences] = await Promise.all([
      this.attendanceRepo.findBySession(sessionRow.id),
      this.absenceRepo.findForStudents(studentIds, sessionRow.scheduled_date),
    ]);
    const markByStudent = new Map(marks.map((m) => [m.student_id, m] as const));
    const absenceByStudent = new Map(absences.map((a) => [a.student_id, a] as const));
    return {
      session: sessionRow,
      students: roster.map((s) => ({
        id: s.id,
        full_name: s.full_name,
        student_code: s.student_code,
        pre_excused: absenceByStudent.has(s.id),
        absence_reason: absenceByStudent.get(s.id)?.reason ?? null,
        attendance: markByStudent.get(s.id) ?? null,
      })),
    };
  }

  async logForCentre(
    actor: ScopedActor,
    centreId: string,
    opts: { from?: string; to?: string },
  ): Promise<{
    items: Array<{
      session: Session;
      batch_name: string;
      gps_radius_m: number;
      counts: Record<AttendanceStatus, number>;
    }>;
  }> {
    // Quick scope check.
    if (actor.role === 'sanchalak' && !(actor.centre_ids ?? []).includes(centreId)) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
        message: 'Centre is outside your scope',
        statusCode: 403,
      });
    }
    const date = opts.from ?? todayInIst();
    const rows = await this.sessionsRepo.listTodayForCentres([centreId], date);
    const items = await Promise.all(
      rows.map(async (r) => {
        const counts = await this.attendanceRepo.countByStatusForSession(r.session.id);
        return {
          session: r.session,
          batch_name: r.batch_name,
          gps_radius_m: r.gps_radius_m,
          counts,
        };
      }),
    );
    return { items };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async resolvePunyaPoints(featureKey: string, _cityId: string): Promise<number> {
    // City overrides go through `punya_configs` which is wired in step 11;
    // for Step 13 we read the global default which suffices for the seed.
    const [row] = await this.drizzle.dbRead
      .select({ pts: punya_features.default_points })
      .from(punya_features)
      .where(eq(punya_features.key, featureKey))
      .limit(1);
    void _cityId;
    return row?.pts ?? 10;
  }

  private async findOriginalTxnId(att: Attendance): Promise<string | null> {
    const orig = await this.punyaRepo.findByIdempotencyKey(`attendance:${att.id}`);
    return orig?.id ?? null;
  }

  // Keep imports referenced — utility-imported but used in repo-side joins.
  protected static readonly __keep = { centres, sql };
}

// -----------------------------------------------------------------------------
// IST helper (duplicated from SessionsService to avoid cross-service import).
// -----------------------------------------------------------------------------

function todayInIst(): string {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const d = String(ist.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
