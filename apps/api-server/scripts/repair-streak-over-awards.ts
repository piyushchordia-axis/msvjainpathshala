/**
 * One-off repair: attendance-streak bonuses awarded by the pre-H9 correction path.
 *
 * reverseStreakBonusForSession only ever reversed the CORRECTED session's own
 * bonus. Milestones land on the 4th, 8th, 12th… attended session, so a
 * correction at any other session reversed nothing, and the recompute that
 * followed then awarded a fresh milestone on the shifted chain. Sessions S1..S8
 * present award at S4 and S8 (+40); correcting S2 to absent left both in place
 * and added a third at S6, leaving 60 where 20 was due — and it repeated on
 * every subsequent correction.
 *
 * The fix stops new over-awards. This repairs the ones already in the ledger.
 *
 * Method: for each student holding streak awards, recompute the authoritative
 * milestone set from their FULL eligible history (not the STREAK_HISTORY_BOUND
 * window the live recompute uses — an old milestone must not be reversed just
 * because it has scrolled out of that window), then reverse every unreversed
 * award whose triggering session is not in that set.
 *
 * Deliberately one-directional: it removes provable over-awards and never adds
 * a missing one. Retroactively crediting Punya months later is a product
 * decision, not a repair, and Q5a's reasoning — a peak genuinely reached should
 * not be clawed back over an adult's later review — cuts the same way here.
 *
 * Reversals are written through the ledger with reversal_of set and the balance
 * moved only by what the insert RETURNed (AT20), so the run is idempotent: a
 * second pass finds nothing left unreversed.
 *
 * Dry run (default) prints what it would do and changes nothing:
 *   pnpm --filter @workspace/api-server exec tsx ./scripts/repair-streak-over-awards.ts
 * Apply:
 *   ... ./scripts/repair-streak-over-awards.ts --apply
 */
import { db, pool, sessions, attendance, students, centre_holidays } from "@workspace/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { creditBalance } from "../src/lib/punya";
import { STREAK_FEATURE_KEY } from "../src/lib/punya-streak";
import {
  computeAttendanceStreak,
  STREAK_HISTORY_BOUND,
  type StreakEligibleMark,
} from "../src/lib/attendance-streak-math";

const APPLY = process.argv.includes("--apply");

function kolkataDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
}

type LiveAward = { id: string; points: number; session_id: string; idempotency_key: string };

/** Unreversed positive streak awards for a student. */
async function liveAwards(studentId: string): Promise<LiveAward[]> {
  const result = await db.execute(sql`
    select t.id, t.points, t.source_entity_id as session_id, t.idempotency_key
    from punya_transactions t
    where t.student_id = ${studentId}::uuid
      and t.source_entity_kind = ${STREAK_FEATURE_KEY}
      and t.points > 0
      and t.idempotency_key is not null
      and t.source_entity_id is not null
      and not exists (select 1 from punya_transactions r where r.reversal_of = t.id)
  `);
  return ((result as unknown as { rows?: LiveAward[] }).rows ?? []).map((r) => ({
    ...r,
    points: Number(r.points),
  }));
}

/**
 * Milestone sessions the student's corrected history earns.
 *
 * Returns the union of two readings: the FULL history, and the last
 * STREAK_HISTORY_BOUND eligible sessions (what the live recompute sees).
 * They diverge only for an unbroken run longer than the bound, because the
 * windowed counter restarts at 0 mid-streak and lands milestones elsewhere.
 *
 * The union makes the repair CONSERVATIVE: an award justified under either
 * reading survives. A repair that reverses a legitimate bonus because the
 * window moved would be a worse bug than the one it is fixing — a child
 * losing points they genuinely earned, with no way to notice.
 */
async function correctMilestones(studentId: string): Promise<Set<string>> {
  const [stu] = await db
    .select({
      batch_id: students.batch_id,
      centre_id: students.centre_id,
      deactivated_at: students.deactivated_at,
    })
    .from(students)
    .where(eq(students.id, studentId))
    .limit(1);
  if (!stu?.batch_id) return new Set();

  const holidayRows = stu.centre_id
    ? await db
        .select({ holiday_date: centre_holidays.holiday_date })
        .from(centre_holidays)
        .where(eq(centre_holidays.centre_id, stu.centre_id))
    : [];
  const holidays = new Set(holidayRows.map((h) => h.holiday_date));

  // FULL history, chronological — no STREAK_HISTORY_BOUND here, deliberately.
  const marks = await db
    .select({
      session_id: attendance.session_id,
      status: attendance.status,
      scheduled_date: sessions.scheduled_date,
      session_status: sessions.status,
    })
    .from(attendance)
    .innerJoin(sessions, eq(sessions.id, attendance.session_id))
    .where(and(eq(attendance.student_id, studentId), eq(sessions.batch_id, stu.batch_id)))
    .orderBy(asc(sessions.scheduled_date), asc(sessions.id));

  const eligible: StreakEligibleMark[] = [];
  for (const m of marks) {
    if (m.session_status === "cancelled") continue;
    if (holidays.has(m.scheduled_date)) continue;
    if (stu.deactivated_at && m.scheduled_date >= kolkataDate(stu.deactivated_at)) continue;
    eligible.push({ session_id: m.session_id, status: m.status });
  }
  const full = computeAttendanceStreak(eligible).milestoneSessionIds;
  const windowed = computeAttendanceStreak(
    eligible.slice(Math.max(0, eligible.length - STREAK_HISTORY_BOUND)),
  ).milestoneSessionIds;
  return new Set([...full, ...windowed]);
}

async function main(): Promise<void> {
  const holders = await db.execute(sql`
    select distinct t.student_id
    from punya_transactions t
    where t.source_entity_kind = ${STREAK_FEATURE_KEY}
      and t.points > 0
      and not exists (select 1 from punya_transactions r where r.reversal_of = t.id)
  `);
  const studentIds = ((holders as unknown as { rows?: Array<{ student_id: string }> }).rows ?? []).map(
    (r) => r.student_id,
  );

  console.log(
    `${APPLY ? "APPLY" : "DRY RUN"} — ${studentIds.length} student(s) hold unreversed streak bonuses.`,
  );

  let studentsTouched = 0;
  let rowsReversed = 0;
  let pointsReversed = 0;

  for (const studentId of studentIds) {
    const [live, correct] = await Promise.all([
      liveAwards(studentId),
      correctMilestones(studentId),
    ]);
    const excess = live.filter((a) => !correct.has(a.session_id));
    if (excess.length === 0) continue;

    studentsTouched++;
    const total = excess.reduce((n, a) => n + a.points, 0);
    rowsReversed += excess.length;
    pointsReversed += total;
    console.log(
      `  student ${studentId}: ${live.length} live award(s), ${correct.size} earned ` +
        `→ reversing ${excess.length} (${total} pts)`,
    );

    if (!APPLY) continue;

    await db.transaction(async (tx) => {
      for (const a of excess) {
        const result = await tx.execute(sql`
          insert into punya_transactions (
            student_id, feature_key, points, note,
            idempotency_key, reversal_of, source_entity_kind, source_entity_id
          )
          select
            ${studentId}::uuid, ${STREAK_FEATURE_KEY}, ${-a.points},
            'attendance streak over-award repair (H9)',
            ${`${a.idempotency_key}:repair`}, ${a.id}::uuid,
            ${STREAK_FEATURE_KEY}, ${a.session_id}::uuid
          where not exists (
            select 1 from punya_transactions r where r.reversal_of = ${a.id}::uuid
          )
          on conflict (idempotency_key) where idempotency_key is not null
          do nothing
          returning points
        `);
        const rows = (result as unknown as { rows?: Array<{ points: number }> }).rows ?? [];
        // AT20 — balance moves ONLY by what the insert actually wrote.
        const delta = Number(rows[0]?.points ?? 0);
        if (delta !== 0) await creditBalance(tx, studentId, delta);
      }
    });
  }

  console.log(
    `\n${APPLY ? "Reversed" : "Would reverse"} ${rowsReversed} award(s) ` +
      `totalling ${pointsReversed} points across ${studentsTouched} student(s).`,
  );
  if (!APPLY && rowsReversed > 0) console.log("Re-run with --apply to write.");
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
