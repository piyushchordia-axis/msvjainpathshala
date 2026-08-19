/**
 * Attendance-streak Punya ledger ops (AT22).
 * Kept in lib/ so mark + post-process do not import each other.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { awardPunya, creditBalance } from "./punya";

export const STREAK_FEATURE_KEY = "attendance_streak";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = Tx | typeof db;

/**
 * Canonical award key for the bonus a milestone session triggered.
 *
 * Generation-suffixed after a reversal, the way examCompletionKey is (AT18).
 * Without the suffix a reversed milestone could never be re-awarded: the base
 * key is already in the ledger, so awardPunya's ON CONFLICT DO NOTHING silently
 * skipped the re-award and the student was left permanently short.
 */
export function streakAwardKey(studentId: string, sessionId: string, generation = 0): string {
  const base = `${STREAK_FEATURE_KEY}:${studentId}:${sessionId}`;
  return generation <= 0 ? base : `${base}:g${generation}`;
}

/**
 * Reverse every unreversed streak bonus at or after the corrected session.
 *
 * H9 — this used to reverse only the corrected session's OWN bonus, which
 * usually held none. Sessions S1..S8 all present award milestones at S4 and S8
 * (+40). Correcting S2 to absent reversed "S2's bonus" — nothing — and then the
 * recompute counted 6 attended from S3, hit a milestone at S6, and awarded a
 * NEW +20. The student held 60 where 20 was due, and it repeated on every
 * correction: a bare re-award with no matching reversal, which is exactly what
 * AT18 forbids.
 *
 * A correction invalidates the whole chain from that date forward, so the whole
 * chain from that date forward is what must be reversed. The recompute then
 * re-awards whatever the corrected history actually earns.
 *
 * Must run on the caller's transaction — never the pool (self-deadlock with
 * reverseAttendanceAward's balance row lock).
 */
export async function reverseStreakBonusesFrom(
  tx: Tx,
  opts: { studentId: string; sessionId: string; newRevision: number },
): Promise<{ reversed: boolean; amount: number }> {
  const { studentId, sessionId, newRevision } = opts;

  const result = await tx.execute(sql`
    with corrected as (
      select scheduled_date from sessions where id = ${sessionId}::uuid
    ),
    prior as (
      select t.id, t.points, t.idempotency_key, t.source_entity_id
      from punya_transactions t
      join sessions s on s.id = t.source_entity_id
      cross join corrected c
      where t.student_id = ${studentId}::uuid
        and t.source_entity_kind = ${STREAK_FEATURE_KEY}
        and t.points > 0
        and t.idempotency_key is not null
        -- The whole chain from the corrected date forward, not just this session.
        and s.scheduled_date >= c.scheduled_date
        and not exists (
          select 1 from punya_transactions r where r.reversal_of = t.id
        )
    ),
    ins as (
      insert into punya_transactions (
        student_id, feature_key, points, note,
        idempotency_key, reversal_of, source_entity_kind, source_entity_id,
        source_revision
      )
      select
        ${studentId}::uuid, ${STREAK_FEATURE_KEY}, -p.points,
        'attendance streak reversal',
        p.idempotency_key || ':reversal', p.id,
        ${STREAK_FEATURE_KEY}, p.source_entity_id,
        ${newRevision}
      from prior p
      on conflict (idempotency_key) where idempotency_key is not null
      do nothing
      returning points
    )
    select coalesce(sum(points), 0)::int as points from ins
  `);
  const rows = (result as unknown as { rows?: Array<{ points: number }> }).rows ?? [];
  // AT20 — balance moves ONLY by the amount the insert RETURNed.
  const delta = Number(rows[0]?.points ?? 0);
  if (delta !== 0) {
    await creditBalance(tx, studentId, delta);
  }
  return { reversed: delta !== 0, amount: Math.abs(delta) };
}

/**
 * Back-compat alias. The name said "ForSession" while the behaviour is
 * "from this session forward" — kept so existing call sites read unchanged,
 * but the semantics are now the corrected ones above.
 */
export const reverseStreakBonusForSession = reverseStreakBonusesFrom;

/**
 * Award the milestone bonus for one triggering session, exactly once per
 * generation.
 *
 * Skips silently when an unreversed award already exists (the ordinary
 * idempotent replay). When the previous award was reversed, awards at the next
 * generation so the ledger carries reverse-then-award pairs rather than a bare
 * second credit.
 */
export async function awardStreakBonus(
  exec: Exec,
  opts: { studentId: string; sessionId: string; points: number },
): Promise<{ awarded: boolean; points: number }> {
  const { studentId, sessionId, points } = opts;
  if (points <= 0) return { awarded: false, points: 0 };

  const result = await exec.execute(sql`
    select
      count(*) filter (where t.points > 0)::int as awards,
      count(*) filter (
        where t.points > 0
          and not exists (select 1 from punya_transactions r where r.reversal_of = t.id)
      )::int as live
    from punya_transactions t
    where t.student_id = ${studentId}::uuid
      and t.source_entity_kind = ${STREAK_FEATURE_KEY}
      and t.source_entity_id = ${sessionId}::uuid
  `);
  const rows =
    (result as unknown as { rows?: Array<{ awards: number; live: number }> }).rows ?? [];
  const awards = Number(rows[0]?.awards ?? 0);
  const live = Number(rows[0]?.live ?? 0);

  // Already holds an unreversed bonus for this milestone — nothing to do.
  if (live > 0) return { awarded: false, points: 0 };

  const res = await awardPunya(
    {
      studentId,
      featureKey: STREAK_FEATURE_KEY,
      points,
      note: "Attendance streak bonus (every 4 attended)",
      idempotencyKey: streakAwardKey(studentId, sessionId, awards),
      sourceEntityKind: STREAK_FEATURE_KEY,
      sourceEntityId: sessionId,
    },
    exec === db ? undefined : (exec as Tx),
  );
  return { awarded: res.awarded, points: res.awarded ? points : 0 };
}
