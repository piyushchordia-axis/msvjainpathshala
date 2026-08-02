/**
 * Attendance-streak Punya ledger ops (AT22).
 * Kept in lib/ so mark + post-process do not import each other.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { creditBalance } from "./punya";

export const STREAK_FEATURE_KEY = "attendance_streak";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Reverse an unreversed streak bonus for (student, session).
 * Must run on the caller's transaction — never the pool (self-deadlock with
 * reverseAttendanceAward's balance row lock).
 */
export async function reverseStreakBonusForSession(
  tx: Tx,
  opts: { studentId: string; sessionId: string; newRevision: number },
): Promise<{ reversed: boolean; amount: number }> {
  const { studentId, sessionId, newRevision } = opts;
  const awardKey = `attendance_streak:${studentId}:${sessionId}`;
  const revKey = `attendance_streak:${studentId}:${sessionId}:rev:${newRevision}`;

  const result = await tx.execute(sql`
    with prior as (
      select t.id, t.points
      from punya_transactions t
      where t.student_id = ${studentId}::uuid
        and t.source_entity_kind = 'attendance_streak'
        and t.source_entity_id = ${sessionId}::uuid
        and t.points > 0
        and t.idempotency_key = ${awardKey}
        and not exists (select 1 from punya_transactions r where r.reversal_of = t.id)
      limit 1
    ),
    ins as (
      insert into punya_transactions (
        student_id, feature_key, points, note,
        idempotency_key, reversal_of, source_entity_kind, source_entity_id,
        source_revision
      )
      select
        ${studentId}::uuid, ${STREAK_FEATURE_KEY}, -prior.points,
        'attendance streak reversal',
        ${revKey}, prior.id, 'attendance_streak', ${sessionId}::uuid,
        ${newRevision}
      from prior
      on conflict (idempotency_key) where idempotency_key is not null
      do nothing
      returning points
    )
    select coalesce((select points from ins), 0) as points
  `);
  const rows = (result as unknown as { rows?: Array<{ points: number }> }).rows ?? [];
  // AT20 — balance moves ONLY by the amount the insert RETURNed.
  const delta = Number(rows[0]?.points ?? 0);
  if (delta !== 0) {
    await creditBalance(tx, studentId, delta);
  }
  return { reversed: delta !== 0, amount: delta };
}
