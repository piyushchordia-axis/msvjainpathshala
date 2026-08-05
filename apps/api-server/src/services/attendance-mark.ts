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
import { and, eq, inArray, isNull, lte, gte, or, sql } from "drizzle-orm";
import type { ErrorCode } from "@workspace/api-zod";
import {
  ATTENDANCE_FEATURE_KEY,
  awardValueForStatus,
  resolveAttendanceAwardPointsForBatch,
} from "../lib/attendance-points";
import { creditBalance, creditBalancesFromReturned } from "../lib/punya";
import { reverseStreakBonusForSession } from "../lib/punya-streak";
import { inBatchWriteScope, resolveAdminScope } from "../lib/scope";
import { writeAudit } from "../lib/audit";
import { enqueueDebouncedJob } from "../lib/queues";
import { QUEUE_NAMES } from "@jp/shared/constants";

/** @internal test-only — force a throw after streak reversal to prove txn rollback. */
export const __attendanceMarkTestHooks = {
  throwAfterStreakReversal: false,
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type AttendanceStatus = "present" | "absent" | "late" | "excused";

export type MarkItemResult =
  | { student_id: string; result: "applied"; revision: number; status: AttendanceStatus }
  | { student_id: string; result: "duplicate"; reason?: string }
  | { student_id: string; result: "rejected"; code: string; message: string };

export class AttendanceMarkError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: ErrorCode,
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
/* Post-process debounce (AT31) — BullMQ, once per session             */
/* ------------------------------------------------------------------ */

const POST_PROCESS_DEBOUNCE_MS = 5_000;

/** Sliding 5s debounce on QUEUE_NAMES.ATTENDANCE_POST_PROCESS. */
export async function enqueueAttendancePostProcess(sessionId: string): Promise<void> {
  await enqueueDebouncedJob(
    QUEUE_NAMES.ATTENDANCE_POST_PROCESS,
    { session_id: sessionId },
    { jobId: `attn-pp:${sessionId}`, delayMs: POST_PROCESS_DEBOUNCE_MS },
  );
}

/* ------------------------------------------------------------------ */
/* Payload guards                                                      */
/* ------------------------------------------------------------------ */

/** Reject whole submission when the same student_id appears more than once. */
export function assertNoDuplicateStudents(
  marks: Array<{ student_id: string }>,
): void {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const m of marks) {
    if (seen.has(m.student_id)) dupes.add(m.student_id);
    else seen.add(m.student_id);
  }
  if (dupes.size === 0) return;
  const listed = [...dupes].join(", ");
  throw new AttendanceMarkError(
    400,
    "ERR_VALIDATION_FAILED",
    `Duplicate student_id in marks: ${listed}`,
  );
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
    order by t.source_revision desc nulls last, t.created_at desc, t.id desc
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
      idempotency_key, reversal_of, source_entity_kind, source_entity_id,
      source_revision
    ) values (
      ${opts.studentId}, ${ATTENDANCE_FEATURE_KEY}, ${debit},
      ${"attendance reversal"}, ${opts.awardedBy ?? null},
      ${key}, ${prior.id}::uuid, ${"attendance"}, ${opts.sessionId}::uuid,
      ${opts.newRevision}
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
      idempotency_key, source_entity_kind, source_entity_id, source_revision
    ) values (
      ${opts.studentId}, ${ATTENDANCE_FEATURE_KEY}, ${opts.amount},
      ${"attendance award"}, ${opts.awardedBy ?? null},
      ${key}, ${"attendance"}, ${opts.sessionId}::uuid, ${opts.newRevision}
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

/** Pending ledger row for the batched AT20 flush (PERF #10 step 5). */
type PendingPunyaRow = {
  student_id: string;
  points: number;
  note: string;
  awarded_by: string | null;
  idempotency_key: string;
  reversal_of: string | null;
  session_id: string;
  revision: number;
};

/**
 * PERF #10 step 5 — one guarded INSERT … ON CONFLICT DO NOTHING RETURNING,
 * then balance moves only by SUM of returned points per student.
 */
async function flushAttendancePunyaRows(tx: Tx, rows: PendingPunyaRow[]): Promise<void> {
  if (rows.length === 0) return;

  const studentArr = sql`array[${sql.join(
    rows.map((r) => sql`${r.student_id}::uuid`),
    sql`, `,
  )}]::uuid[]`;
  const pointsArr = sql`array[${sql.join(
    rows.map((r) => sql`${r.points}::int`),
    sql`, `,
  )}]::int[]`;
  const noteArr = sql`array[${sql.join(
    rows.map((r) => sql`${r.note}`),
    sql`, `,
  )}]::text[]`;
  const awardedArr = sql`array[${sql.join(
    rows.map((r) => (r.awarded_by ? sql`${r.awarded_by}::uuid` : sql`null::uuid`)),
    sql`, `,
  )}]::uuid[]`;
  const keyArr = sql`array[${sql.join(
    rows.map((r) => sql`${r.idempotency_key}`),
    sql`, `,
  )}]::text[]`;
  const revOfArr = sql`array[${sql.join(
    rows.map((r) => (r.reversal_of ? sql`${r.reversal_of}::uuid` : sql`null::uuid`)),
    sql`, `,
  )}]::uuid[]`;
  const sessionArr = sql`array[${sql.join(
    rows.map((r) => sql`${r.session_id}::uuid`),
    sql`, `,
  )}]::uuid[]`;
  const revisionArr = sql`array[${sql.join(
    rows.map((r) => sql`${r.revision}::int`),
    sql`, `,
  )}]::int[]`;

  const insertResult = await tx.execute(sql`
    insert into punya_transactions (
      student_id, feature_key, points, note, awarded_by,
      idempotency_key, reversal_of, source_entity_kind, source_entity_id, source_revision
    )
    select
      s.student_id,
      ${ATTENDANCE_FEATURE_KEY},
      s.points,
      s.note,
      s.awarded_by,
      s.idempotency_key,
      s.reversal_of,
      ${"attendance"},
      s.session_id,
      s.revision
    from unnest(
      ${studentArr},
      ${pointsArr},
      ${noteArr},
      ${awardedArr},
      ${keyArr},
      ${revOfArr},
      ${sessionArr},
      ${revisionArr}
    ) as s(
      student_id, points, note, awarded_by, idempotency_key, reversal_of, session_id, revision
    )
    on conflict (idempotency_key) where idempotency_key is not null
    do nothing
    returning student_id, points
  `);
  const returned =
    (insertResult as unknown as { rows?: Array<{ student_id: string; points: number }> }).rows ??
    [];
  await creditBalancesFromReturned(tx, returned);
}

/* ------------------------------------------------------------------ */
/* Enrolment — one query for the whole roster                          */
/* ------------------------------------------------------------------ */

/** Active on-batch or approved enrolment for any of the given students. */
export async function resolveEligibleStudentIds(
  studentIds: string[],
  batchId: string,
): Promise<Set<string>> {
  if (studentIds.length === 0) return new Set();
  const unique = [...new Set(studentIds)];
  const rows = await db
    .select({ id: students.id })
    .from(students)
    .leftJoin(
      enrolments,
      and(
        eq(enrolments.student_id, students.id),
        eq(enrolments.requested_batch_id, batchId),
        eq(enrolments.status, "approved"),
      ),
    )
    .where(
      and(
        inArray(students.id, unique),
        eq(students.status, "active"),
        or(eq(students.batch_id, batchId), sql`${enrolments.id} is not null`),
      ),
    );
  return new Set(rows.map((r) => r.id));
}

/* ------------------------------------------------------------------ */
/* Sync claim (online path; sync/batch owns its own ledger)            */
/* ------------------------------------------------------------------ */

type ClaimOutcome =
  | { kind: "claimed" }
  | { kind: "replay"; response: MarkResponse }
  | { kind: "busy" };

async function claimSyncOperation(
  tx: Tx,
  opts: {
    userId: string;
    submissionOpId: string;
    requestPayload: Record<string, unknown>;
  },
): Promise<ClaimOutcome> {
  const insertResult = await tx.execute(sql`
    insert into sync_operations (
      user_id, submission_op_id, op_kind, request_payload, status
    ) values (
      ${opts.userId}::uuid,
      ${opts.submissionOpId},
      ${"attendance"},
      ${JSON.stringify(opts.requestPayload)}::jsonb,
      ${"processing"}::sync_op_status_enum
    )
    on conflict (user_id, submission_op_id) do nothing
    returning id
  `);
  const inserted =
    (insertResult as unknown as { rows?: Array<{ id: string }> }).rows ?? [];
  if (inserted.length > 0) return { kind: "claimed" };

  const [existing] = await tx
    .select({
      status: sync_operations.status,
      response_payload: sync_operations.response_payload,
    })
    .from(sync_operations)
    .where(
      and(
        eq(sync_operations.user_id, opts.userId),
        eq(sync_operations.submission_op_id, opts.submissionOpId),
      ),
    )
    .limit(1);

  if (existing?.status === "success" && existing.response_payload) {
    return { kind: "replay", response: existing.response_payload as MarkResponse };
  }
  return { kind: "busy" };
}

async function completeSyncOperation(
  tx: Tx,
  opts: { userId: string; submissionOpId: string; response: MarkResponse },
): Promise<void> {
  await tx
    .update(sync_operations)
    .set({
      status: "success",
      response_payload: opts.response,
      error: null,
      applied_at: new Date(),
      updated_at: new Date(),
    })
    .where(
      and(
        eq(sync_operations.user_id, opts.userId),
        eq(sync_operations.submission_op_id, opts.submissionOpId),
      ),
    );
}

/* ------------------------------------------------------------------ */
/* Single-item transition (inside open txn)                            */
/* ------------------------------------------------------------------ */

type ApplyOneOutcome = {
  result: MarkItemResult;
  punyaRows: PendingPunyaRow[];
  streakReverse: boolean;
};

async function applyOneMark(
  tx: Tx,
  opts: {
    sessionId: string;
    scheduledDate: string;
    userId: string;
    markedAt: Date;
    configuredPoints: number;
    enrolledIds: Set<string>;
    mark: MarkInput["marks"][number];
  },
): Promise<ApplyOneOutcome> {
  const { mark } = opts;

  if (!opts.enrolledIds.has(mark.student_id)) {
    return {
      result: {
        student_id: mark.student_id,
        result: "rejected",
        code: "ERR_STUDENT_NOT_ENROLLED",
        message: "That student is not on this batch roster.",
      },
      punyaRows: [],
      streakReverse: false,
    };
  }

  // PERF #10 step 3 — prior FOR UPDATE + upsert in one CTE (preserves AT18 prior status).
  const cteResult = await tx.execute(sql`
    with prior as (
      select status, revision, marked_at
      from attendance
      where session_id = ${opts.sessionId}::uuid
        and student_id = ${mark.student_id}::uuid
      for update
    ),
    up as (
      insert into attendance (
        session_id, student_id, status, notes, marked_at, marked_by,
        client_op_id, session_date, revision, marked_method
      )
      select
        ${opts.sessionId}::uuid, ${mark.student_id}::uuid,
        ${mark.status}::attendance_status_enum,
        ${mark.notes ?? null}, ${opts.markedAt.toISOString()}::timestamptz, ${opts.userId}::uuid,
        ${mark.client_op_id}, ${opts.scheduledDate}::date, 1, 'manual'::attendance_method_enum
      where not exists (
        select 1 from prior p where p.marked_at > ${opts.markedAt.toISOString()}::timestamptz
      )
      -- AT18: identical status (same award-worthiness) → do not bump revision.
      and not exists (
        select 1 from prior p where p.status = ${mark.status}::attendance_status_enum
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
      where attendance.marked_at <= excluded.marked_at
        and attendance.status is distinct from excluded.status
      returning revision, status
    )
    select
      (select status from prior) as old_status,
      (select marked_at from prior) as old_marked_at,
      (select revision from up) as new_revision,
      (select status from up) as new_status
  `);
  const cteRows =
    (cteResult as unknown as {
      rows?: Array<{
        old_status: string | null;
        old_marked_at: Date | string | null;
        new_revision: number | null;
        new_status: string | null;
      }>;
    }).rows ?? [];
  const row = cteRows[0];

  if (!row) {
    return {
      result: { student_id: mark.student_id, result: "duplicate", reason: "newer_marked_at_wins" },
      punyaRows: [],
      streakReverse: false,
    };
  }

  if (row.old_marked_at && new Date(row.old_marked_at).getTime() > opts.markedAt.getTime()) {
    return {
      result: { student_id: mark.student_id, result: "duplicate", reason: "newer_marked_at_wins" },
      punyaRows: [],
      streakReverse: false,
    };
  }

  const oldStatus = row.old_status ?? null;
  const oldAward = awardValueForStatus(oldStatus, opts.configuredPoints);
  const newAward = awardValueForStatus(mark.status, opts.configuredPoints);

  if (row.new_revision == null) {
    // Upsert skipped — newer marked_at or unchanged status.
    if (oldStatus === mark.status && oldAward === newAward) {
      return {
        result: { student_id: mark.student_id, result: "duplicate", reason: "unchanged" },
        punyaRows: [],
        streakReverse: false,
      };
    }
    return {
      result: { student_id: mark.student_id, result: "duplicate", reason: "newer_marked_at_wins" },
      punyaRows: [],
      streakReverse: false,
    };
  }

  const newRevision = Number(row.new_revision);
  const punyaRows: PendingPunyaRow[] = [];

  // AT18 — collect reverse-then-award for the batched flush (AT20 on RETURNING).
  if (oldAward > 0) {
    const prior = await findLatestUnreversedAward(tx, opts.sessionId, mark.student_id);
    if (prior && prior.points > 0) {
      punyaRows.push({
        student_id: mark.student_id,
        points: -Math.abs(prior.points),
        note: "attendance reversal",
        awarded_by: opts.userId,
        idempotency_key: reversalIdempotencyKey(opts.sessionId, mark.student_id, newRevision),
        reversal_of: prior.id,
        session_id: opts.sessionId,
        revision: newRevision,
      });
    }
  }
  if (newAward > 0) {
    punyaRows.push({
      student_id: mark.student_id,
      points: newAward,
      note: "attendance award",
      awarded_by: opts.userId,
      idempotency_key: awardIdempotencyKey(opts.sessionId, mark.student_id, newRevision),
      reversal_of: null,
      session_id: opts.sessionId,
      revision: newRevision,
    });
  }

  const wasAttended = oldStatus === "present" || oldStatus === "late";
  const nowAttended = mark.status === "present" || mark.status === "late";
  const streakReverse = wasAttended && !nowAttended;

  return {
    result: {
      student_id: mark.student_id,
      result: "applied",
      revision: newRevision,
      status: mark.status,
    },
    punyaRows,
    streakReverse,
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

/**
 * Mark attendance for one or many students. Pre-conditions (cancelled, edit
 * window, duplicate students, enrolment) run before / at the start of the
 * transaction. Per-item enrolment failures do not abort siblings.
 */
export async function markAttendance(input: MarkInput): Promise<MarkResponse> {
  assertNoDuplicateStudents(input.marks);

  const session = await loadSessionOrThrow(input.sessionId);

  // Scope, points, and enrolment are independent once we have the session row.
  const [scope, pointsPack, enrolledIds] = await Promise.all([
    input.actor ? resolveAdminScope(input.actor) : Promise.resolve(null),
    resolveAttendanceAwardPointsForBatch(session.batch_id),
    resolveEligibleStudentIds(
      input.marks.map((m) => m.student_id),
      session.batch_id,
    ),
  ]);

  if (input.actor && scope) {
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

  const { points: configuredPoints } = pointsPack;

  const ownSync = Boolean(input.submissionOpId) && input.recordSync !== false;

  const outcome = await db.transaction(async (tx) => {
    if (ownSync && input.submissionOpId) {
      const claim = await claimSyncOperation(tx, {
        userId: input.userId,
        submissionOpId: input.submissionOpId,
        requestPayload: {
          session_id: input.sessionId,
          marked_at: input.markedAt.toISOString(),
          marks: input.marks,
        },
      });
      if (claim.kind === "replay") return { fresh: false as const, response: claim.response };
      if (claim.kind === "busy") {
        throw new AttendanceMarkError(
          409,
          "ERR_SYNC_IN_PROGRESS",
          "This submission is already being processed. Retry shortly.",
        );
      }
    }

    const results: MarkItemResult[] = [];
    // PERF #10 step 2 — one session lock; UNIQUE (session_id, student_id) + FOR UPDATE
    // already serialize per-row. Per-student advisory locks only serialized the batch
    // against itself.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"attn:" + session.id}))`);

    const pendingPunya: PendingPunyaRow[] = [];
    const streakTargets: Array<{ studentId: string; newRevision: number }> = [];
    const appliedStudentIds: string[] = [];

    for (const mark of input.marks) {
      const outcome = await applyOneMark(tx, {
        sessionId: session.id,
        scheduledDate: session.scheduled_date,
        userId: input.userId,
        markedAt: input.markedAt,
        configuredPoints,
        enrolledIds,
        mark,
      });
      results.push(outcome.result);
      if (outcome.result.result === "applied") {
        appliedStudentIds.push(mark.student_id);
        pendingPunya.push(...outcome.punyaRows);
        if (outcome.streakReverse) {
          streakTargets.push({
            studentId: mark.student_id,
            newRevision: outcome.result.revision,
          });
        }
      }
    }

    // PERF #10 step 5 — AT20: balance moves only by RETURNING from this insert.
    await flushAttendancePunyaRows(tx, pendingPunya);

    for (const s of streakTargets) {
      await reverseStreakBonusForSession(tx, {
        studentId: s.studentId,
        sessionId: session.id,
        newRevision: s.newRevision,
      });
      if (__attendanceMarkTestHooks.throwAfterStreakReversal) {
        throw new Error("test-forced rollback after streak reversal");
      }
    }

    // PERF #10 step 1 — AT4 consume once for the whole applied set.
    if (appliedStudentIds.length > 0) {
      await tx
        .update(absence_notifications)
        .set({ resolved_at: new Date() })
        .where(
          and(
            inArray(absence_notifications.student_id, appliedStudentIds),
            isNull(absence_notifications.resolved_at),
            lte(absence_notifications.start_date, session.scheduled_date),
            gte(absence_notifications.end_date, session.scheduled_date),
          ),
        );
    }

    // Do NOT flip status to completed here — check-out / auto-checkout own that
    // transition so offline order checkin → mark → checkout stays valid.
    const built: MarkResponse = {
      session_id: session.id,
      items: results,
      applied: results.filter((i) => i.result === "applied").length,
      duplicate: results.filter((i) => i.result === "duplicate").length,
      rejected: results.filter((i) => i.result === "rejected").length,
    };

    if (built.applied > 0) {
      await writeAudit(
        {
          actorId: input.userId,
          actorRole: input.actor?.role ?? null,
          action: "update",
          entityKind: "attendance",
          entityId: session.id,
          summary: `Attendance marked (${built.applied} applied)`,
          metadata: {
            applied: built.applied,
            duplicate: built.duplicate,
            rejected: built.rejected,
            submission_op_id: input.submissionOpId ?? null,
          },
        },
        tx,
      );
    }

    if (ownSync && input.submissionOpId) {
      await completeSyncOperation(tx, {
        userId: input.userId,
        submissionOpId: input.submissionOpId,
        response: built,
      });
    }

    return { fresh: true as const, response: built };
  });

  // Enqueue AFTER commit (never inside the txn); skip on idempotent replay.
  // Never await — without Redis the handler runs inline and would hold the
  // HTTP worker + pool connection through streak recompute (PERF #14 load path).
  if (outcome.fresh) {
    void enqueueAttendancePostProcess(session.id).catch(() => {
      /* best-effort; BullMQ retries when Redis is up */
    });
  }

  return outcome.response;
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
