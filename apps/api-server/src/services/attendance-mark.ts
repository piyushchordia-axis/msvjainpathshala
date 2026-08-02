/**
 * Attendance marking — AT3, AT17–AT21, AT24, AT26.
 * Single implementation for bulk POST and single-student PATCH.
 */
import {
  db,
  sessions,
  attendance,
  students,
  enrolments,
  sync_operations,
  punya_transactions,
  batches,
  absence_notifications,
  type User,
} from "@workspace/db";
import { and, eq, isNull, lte, gte, sql } from "drizzle-orm";
import { EventEmitter } from "node:events";
import {
  ATTENDANCE_FEATURE_KEY,
  awardValueForStatus,
  resolveAttendanceAwardPointsForBatch,
} from "../lib/attendance-points";
import { tierForPoints } from "@workspace/db/enums";
import { inBatchWriteScope, resolveAdminScope } from "../lib/scope";
import { writeAudit } from "../lib/audit";

export const attendanceEvents = new EventEmitter();

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type AttendanceStatus = "present" | "absent" | "late" | "excused";

export type MarkItemResult =
  | { student_id: string; result: "applied"; revision: number; status: AttendanceStatus }
  | { student_id: string; result: "duplicate"; reason?: string }
  | { student_id: string; result: "rejected"; code: string; message: string };

export class AttendanceMarkError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AttendanceMarkError";
  }
}

export interface MarkInput {
  sessionId: string;
  userId: string;
  /** Service-layer scope (Q2/MSV) — required for write paths including sync/batch. */
  actor?: User;
  markedAt: Date;
  marks: Array<{
    student_id: string;
    status: AttendanceStatus;
    notes?: string | null;
    client_op_id: string;
  }>;
  /** Bulk route only — drives sync_operations replay. */
  submissionOpId?: string;
  /** When false, caller (sync/batch) owns the sync_operations write. Default true. */
  recordSync?: boolean;
}

export interface MarkResponse {
  session_id: string;
  items: MarkItemResult[];
  applied: number;
  duplicate: number;
  rejected: number;
}

/* ------------------------------------------------------------------ */
/* Edit window (AT26) — Asia/Kolkata calendar day vs session date      */
/* ------------------------------------------------------------------ */

/** Format an instant as YYYY-MM-DD in Asia/Kolkata. */
export function kolkataDateString(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/**
 * Same-day edit window: client's marked_at must fall on the session's
 * scheduled_date in Asia/Kolkata. Enforced in the SERVICE layer (AT26).
 */
export function assertEditWindow(scheduledDate: string, clientMarkedAt: Date): void {
  const markedDay = kolkataDateString(clientMarkedAt);
  if (markedDay !== scheduledDate) {
    throw new AttendanceMarkError(
      409,
      "ERR_ATTENDANCE_EDIT_WINDOW_EXPIRED",
      "The same-day edit window for this mark has closed (Asia/Kolkata).",
    );
  }
}

/* ------------------------------------------------------------------ */
/* Post-process debounce (AT31) — once per session, never per item     */
/* ------------------------------------------------------------------ */

const postProcessTimers = new Map<string, ReturnType<typeof setTimeout>>();
const POST_PROCESS_DEBOUNCE_MS = 5_000;

export function enqueueAttendancePostProcess(sessionId: string): void {
  const prev = postProcessTimers.get(sessionId);
  if (prev) clearTimeout(prev);
  const t = setTimeout(() => {
    postProcessTimers.delete(sessionId);
    attendanceEvents.emit("attendance.post_process", { session_id: sessionId });
  }, POST_PROCESS_DEBOUNCE_MS);
  // Don't keep the process alive solely for debounce in tests.
  if (typeof t === "object" && "unref" in t) (t as NodeJS.Timeout).unref();
  postProcessTimers.set(sessionId, t);
}

/* ------------------------------------------------------------------ */
/* Punya reverse / award (AT17–AT20)                                   */
/* ------------------------------------------------------------------ */

function awardIdempotencyKey(sessionId: string, studentId: string, revision: number): string {
  return `attendance:${sessionId}:${studentId}:${revision}`;
}

function reversalIdempotencyKey(sessionId: string, studentId: string, revision: number): string {
  return `attendance:${sessionId}:${studentId}:${revision}:rev`;
}

async function creditBalance(tx: Tx, studentId: string, delta: number): Promise<void> {
  if (delta === 0) return;
  const result = await tx.execute(sql`
    insert into punya_balances (student_id, total_points)
    values (${studentId}, ${delta})
    on conflict (student_id) do update
      set total_points = punya_balances.total_points + ${delta},
          updated_at = now()
    returning total_points
  `);
  const rows = (result as unknown as { rows?: Array<{ total_points: number }> }).rows ?? [];
  const total = Number(rows[0]?.total_points ?? delta);
  await tx.execute(sql`
    update punya_balances
    set tier = ${tierForPoints(total)}::tier_enum
    where student_id = ${studentId}
  `);
}

/** Most recent UNREVERSED attendance award for (session, student) — AT18. */
async function findLatestUnreversedAward(
  tx: Tx,
  sessionId: string,
  studentId: string,
): Promise<{ id: string; points: number; idempotency_key: string | null } | null> {
  const prefix = `attendance:${sessionId}:${studentId}:`;
  const result = await tx.execute(sql`
    select t.id, t.points, t.idempotency_key
    from punya_transactions t
    where t.student_id = ${studentId}
      and t.source_entity_kind = 'attendance'
      and t.source_entity_id = ${sessionId}::uuid
      and t.points > 0
      and t.idempotency_key like ${prefix + "%"}
      and t.idempotency_key not like ${"%:rev"}
      and not exists (
        select 1 from punya_transactions r
        where r.reversal_of = t.id
      )
    order by t.created_at desc, t.id desc
    limit 1
  `);
  const rows =
    (result as unknown as {
      rows?: Array<{ id: string; points: number; idempotency_key: string | null }>;
    }).rows ?? [];
  return rows[0] ?? null;
}

/**
 * Reverse the current attendance award for a student (force_cancel / AT18).
 * Caller supplies the revision that will be written on the attendance row
 * (the revision AFTER the bump that accompanies the reversal).
 */
export async function reverseAttendanceAward(
  tx: Tx,
  opts: {
    sessionId: string;
    studentId: string;
    newRevision: number;
    awardedBy?: string | null;
  },
): Promise<{ reversed: boolean; amount: number }> {
  const prior = await findLatestUnreversedAward(tx, opts.sessionId, opts.studentId);
  if (!prior || prior.points <= 0) return { reversed: false, amount: 0 };

  const key = reversalIdempotencyKey(opts.sessionId, opts.studentId, opts.newRevision);
  const debit = -Math.abs(prior.points);

  const insertResult = await tx.execute(sql`
    insert into punya_transactions (
      student_id, feature_key, points, note, awarded_by,
      idempotency_key, reversal_of, source_entity_kind, source_entity_id
    ) values (
      ${opts.studentId}, ${ATTENDANCE_FEATURE_KEY}, ${debit},
      ${"attendance reversal"}, ${opts.awardedBy ?? null},
      ${key}, ${prior.id}::uuid, ${"attendance"}, ${opts.sessionId}::uuid
    )
    on conflict (idempotency_key) where idempotency_key is not null
    do nothing
    returning points
  `);
  const inserted =
    (insertResult as unknown as { rows?: Array<{ points: number }> }).rows ?? [];
  // AT20 — balance moves ONLY by COALESCE(RETURNING, 0)
  const reversedAmount = inserted.length > 0 ? Number(inserted[0]!.points) : 0;
  await creditBalance(tx, opts.studentId, reversedAmount);
  return { reversed: reversedAmount !== 0, amount: reversedAmount };
}

async function awardAttendancePunya(
  tx: Tx,
  opts: {
    sessionId: string;
    studentId: string;
    newRevision: number;
    amount: number;
    awardedBy?: string | null;
  },
): Promise<number> {
  if (opts.amount <= 0) return 0;
  const key = awardIdempotencyKey(opts.sessionId, opts.studentId, opts.newRevision);
  const insertResult = await tx.execute(sql`
    insert into punya_transactions (
      student_id, feature_key, points, note, awarded_by,
      idempotency_key, source_entity_kind, source_entity_id
    ) values (
      ${opts.studentId}, ${ATTENDANCE_FEATURE_KEY}, ${opts.amount},
      ${"attendance award"}, ${opts.awardedBy ?? null},
      ${key}, ${"attendance"}, ${opts.sessionId}::uuid
    )
    on conflict (idempotency_key) where idempotency_key is not null
    do nothing
    returning points
  `);
  const inserted =
    (insertResult as unknown as { rows?: Array<{ points: number }> }).rows ?? [];
  const awardedAmount = inserted.length > 0 ? Number(inserted[0]!.points) : 0;
  await creditBalance(tx, opts.studentId, awardedAmount);
  return awardedAmount;
}

/* ------------------------------------------------------------------ */
/* Enrolment (per item)                                                */
/* ------------------------------------------------------------------ */

async function isActivelyEnrolled(
  tx: Tx,
  studentId: string,
  batchId: string,
): Promise<boolean> {
  const [stu] = await tx
    .select({
      batch_id: students.batch_id,
      status: students.status,
    })
    .from(students)
    .where(eq(students.id, studentId))
    .limit(1);
  if (!stu) return false;
  if (stu.status !== "active") return false;
  if (stu.batch_id === batchId) return true;

  const [enr] = await tx
    .select({ id: enrolments.id })
    .from(enrolments)
    .where(
      and(
        eq(enrolments.student_id, studentId),
        eq(enrolments.requested_batch_id, batchId),
        eq(enrolments.status, "approved"),
      ),
    )
    .limit(1);
  return !!enr;
}

/* ------------------------------------------------------------------ */
/* Single-item transition (inside open txn)                            */
/* ------------------------------------------------------------------ */

async function applyOneMark(
  tx: Tx,
  opts: {
    sessionId: string;
    scheduledDate: string;
    batchId: string;
    userId: string;
    markedAt: Date;
    configuredPoints: number;
    mark: MarkInput["marks"][number];
  },
): Promise<MarkItemResult> {
  const { mark } = opts;

  if (!(await isActivelyEnrolled(tx, mark.student_id, opts.batchId))) {
    return {
      student_id: mark.student_id,
      result: "rejected",
      code: "ERR_STUDENT_NOT_ENROLLED",
      message: "That student is not on this batch roster.",
    };
  }

  // Serialize concurrent devices on the same (session, student) slot.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${opts.sessionId + ":" + mark.student_id}))`,
  );

  // Capture prior state ATOMICALLY (FOR UPDATE) — no SELECT-then-UPSERT TOCTOU.
  const priorResult = await tx.execute(sql`
    select status, revision, marked_at
    from attendance
    where session_id = ${opts.sessionId}::uuid
      and student_id = ${mark.student_id}::uuid
    for update
  `);
  const priorRows =
    (priorResult as unknown as {
      rows?: Array<{ status: string; revision: number; marked_at: Date | string }>;
    }).rows ?? [];
  const prior = priorRows[0] ?? null;

  if (prior) {
    const priorMarkedAt = new Date(prior.marked_at);
    if (priorMarkedAt.getTime() > opts.markedAt.getTime()) {
      return { student_id: mark.student_id, result: "duplicate", reason: "newer_marked_at_wins" };
    }
  }

  const oldStatus = prior?.status ?? null;
  const oldAward = awardValueForStatus(oldStatus, opts.configuredPoints);
  const newAward = awardValueForStatus(mark.status, opts.configuredPoints);

  // Resync with identical award-worthiness — do NOT bump revision (AT18).
  if (oldStatus === mark.status && oldAward === newAward) {
    return { student_id: mark.student_id, result: "duplicate", reason: "unchanged" };
  }

  const upsertResult = await tx.execute(sql`
    insert into attendance (
      session_id, student_id, status, notes, marked_at, marked_by,
      client_op_id, session_date, revision, marked_method
    ) values (
      ${opts.sessionId}::uuid, ${mark.student_id}::uuid, ${mark.status}::attendance_status_enum,
      ${mark.notes ?? null}, ${opts.markedAt.toISOString()}::timestamptz, ${opts.userId}::uuid,
      ${mark.client_op_id}, ${opts.scheduledDate}::date, 1, 'manual'::attendance_method_enum
    )
    on conflict (session_id, student_id) do update set
      status = excluded.status,
      notes = excluded.notes,
      marked_at = excluded.marked_at,
      marked_by = excluded.marked_by,
      client_op_id = excluded.client_op_id,
      session_date = excluded.session_date,
      revision = attendance.revision + 1,
      updated_at = now()
    returning revision, status
  `);
  const upserted =
    (upsertResult as unknown as { rows?: Array<{ revision: number; status: string }> }).rows ?? [];
  const newRevision = Number(upserted[0]!.revision);

  // AT18 — always reverse-then-award on award-worthiness / value change.
  if (oldAward > 0) {
    await reverseAttendanceAward(tx, {
      sessionId: opts.sessionId,
      studentId: mark.student_id,
      newRevision,
      awardedBy: opts.userId,
    });
  }
  if (newAward > 0) {
    await awardAttendancePunya(tx, {
      sessionId: opts.sessionId,
      studentId: mark.student_id,
      newRevision,
      amount: newAward,
      awardedBy: opts.userId,
    });
  }

  // AT22 — if a mark that completed a streak is corrected away from attended, reverse the bonus.
  const wasAttended = oldStatus === "present" || oldStatus === "late";
  const nowAttended = mark.status === "present" || mark.status === "late";
  if (wasAttended && !nowAttended) {
    const { reverseStreakBonusForSession } = await import("./attendance-post-process");
    await reverseStreakBonusForSession(mark.student_id, opts.sessionId, newRevision);
  }

  // AT4 — marking a session covered by an advance absence consumes the notification.
  await tx
    .update(absence_notifications)
    .set({ resolved_at: new Date() })
    .where(
      and(
        eq(absence_notifications.student_id, mark.student_id),
        isNull(absence_notifications.resolved_at),
        lte(absence_notifications.start_date, opts.scheduledDate),
        gte(absence_notifications.end_date, opts.scheduledDate),
      ),
    );

  return {
    student_id: mark.student_id,
    result: "applied",
    revision: newRevision,
    status: mark.status,
  };
}

/* ------------------------------------------------------------------ */
/* Public entry points                                                 */
/* ------------------------------------------------------------------ */

async function loadSessionOrThrow(sessionId: string) {
  const [row] = await db
    .select({
      id: sessions.id,
      status: sessions.status,
      scheduled_date: sessions.scheduled_date,
      batch_id: sessions.batch_id,
      centre_id: batches.centre_id,
    })
    .from(sessions)
    .innerJoin(batches, eq(batches.id, sessions.batch_id))
    .where(eq(sessions.id, sessionId))
    .limit(1);
  if (!row) {
    throw new AttendanceMarkError(404, "ERR_NOT_FOUND", "Session not found.");
  }
  return row;
}

async function maybeReplaySubmission(
  userId: string,
  submissionOpId: string,
): Promise<MarkResponse | null> {
  const [existing] = await db
    .select({
      status: sync_operations.status,
      response_payload: sync_operations.response_payload,
    })
    .from(sync_operations)
    .where(
      and(eq(sync_operations.user_id, userId), eq(sync_operations.submission_op_id, submissionOpId)),
    )
    .limit(1);
  if (existing?.status === "success" && existing.response_payload) {
    return existing.response_payload as MarkResponse;
  }
  return null;
}

/**
 * Mark attendance for one or many students. Pre-conditions (sync replay,
 * cancelled, edit window) run BEFORE the transaction. Per-item enrolment
 * failures are reported without aborting siblings.
 */
export async function markAttendance(input: MarkInput): Promise<MarkResponse> {
  if (input.submissionOpId) {
    const replay = await maybeReplaySubmission(input.userId, input.submissionOpId);
    if (replay) return replay;
  }

  const session = await loadSessionOrThrow(input.sessionId);

  // Scope in the SERVICE layer (not only a route guard) — sync/batch shares this path.
  if (input.actor) {
    const scope = await resolveAdminScope(input.actor);
    if (!inBatchWriteScope(scope, session.batch_id, session.centre_id)) {
      throw new AttendanceMarkError(403, "ERR_FORBIDDEN", "Session is outside your scope.");
    }
  }

  // AT24 — cancelled guard (before txn).
  if (session.status === "cancelled") {
    throw new AttendanceMarkError(
      409,
      "ERR_SESSION_CANCELLED",
      "This session was cancelled.",
    );
  }

  // AT26 — client marked_at vs session date (service layer).
  assertEditWindow(session.scheduled_date, input.markedAt);

  const { points: configuredPoints } = await resolveAttendanceAwardPointsForBatch(session.batch_id);

  const items = await db.transaction(async (tx) => {
    const results: MarkItemResult[] = [];
    for (const mark of input.marks) {
      results.push(
        await applyOneMark(tx, {
          sessionId: session.id,
          scheduledDate: session.scheduled_date,
          batchId: session.batch_id,
          userId: input.userId,
          markedAt: input.markedAt,
          configuredPoints,
          mark,
        }),
      );
    }

    // Do NOT flip status to completed here — check-out / auto-checkout own that
    // transition so offline order checkin → mark → checkout stays valid.
    return results;
  });

  const response: MarkResponse = {
    session_id: session.id,
    items,
    applied: items.filter((i) => i.result === "applied").length,
    duplicate: items.filter((i) => i.result === "duplicate").length,
    rejected: items.filter((i) => i.result === "rejected").length,
  };

  // Emit AFTER commit (never inside the txn).
  attendanceEvents.emit("attendance.marked", {
    session_id: session.id,
    user_id: input.userId,
    items,
  });
  enqueueAttendancePostProcess(session.id);

  if (response.applied > 0) {
    await writeAudit({
      actorId: input.userId,
      actorRole: input.actor?.role ?? null,
      action: "update",
      entityKind: "attendance",
      entityId: session.id,
      summary: `Attendance marked (${response.applied} applied)`,
      metadata: {
        applied: response.applied,
        duplicate: response.duplicate,
        rejected: response.rejected,
        submission_op_id: input.submissionOpId ?? null,
      },
    });
  }

  // Online path may still record sync_operations; sync/batch owns writes when
  // recordSync=false so the two paths never double-insert.
  if (input.submissionOpId && input.recordSync !== false) {
    await db
      .insert(sync_operations)
      .values({
        user_id: input.userId,
        submission_op_id: input.submissionOpId,
        op_kind: "attendance",
        request_payload: {
          session_id: input.sessionId,
          marked_at: input.markedAt.toISOString(),
          marks: input.marks,
        },
        response_payload: response,
        status: "success",
      })
      .onConflictDoNothing();
  }

  return response;
}

/** PATCH single-student — same transition + guards. */
export async function patchAttendanceMark(opts: {
  sessionId: string;
  studentId: string;
  userId: string;
  actor?: User;
  markedAt: Date;
  status: AttendanceStatus;
  notes?: string | null;
  client_op_id: string;
  submissionOpId?: string;
}): Promise<MarkResponse> {
  return markAttendance({
    sessionId: opts.sessionId,
    userId: opts.userId,
    actor: opts.actor,
    markedAt: opts.markedAt,
    submissionOpId: opts.submissionOpId,
    marks: [
      {
        student_id: opts.studentId,
        status: opts.status,
        notes: opts.notes,
        client_op_id: opts.client_op_id,
      },
    ],
  });
}

/** Ledger invariant helper for tests (AT11 note in prompt). */
export async function sumAttendanceLedger(studentId: string): Promise<number> {
  const [row] = await db
    .select({
      sum: sql<number>`coalesce(sum(${punya_transactions.points}), 0)::int`,
    })
    .from(punya_transactions)
    .where(
      and(
        eq(punya_transactions.student_id, studentId),
        eq(punya_transactions.source_entity_kind, "attendance"),
      ),
    );
  return Number(row?.sum ?? 0);
}
