/**
 * Per-award context denormalised onto the ledger (M1).
 *
 * SPEC §5.7 puts city_id / centre_id / batch_id and is_msv_track on
 * punya_transactions "for fast leaderboard queries". Resolving them at award
 * time rather than joining on read matters twice over:
 *
 *  - Every scoped leaderboard would otherwise join students → centres → cities
 *    on every read, for every row, forever.
 *  - More importantly it is a SNAPSHOT. A child who transfers centres in March
 *    keeps their January rows pointing at the centre they actually earned them
 *    at, so a per-centre leaderboard for January still means something. A live
 *    join would silently rewrite history every time somebody moved.
 *
 * Cached briefly: an attendance roster awards the same batch's students in one
 * pass, so this would otherwise fire one lookup per child.
 */
import { db, students, centres, msv_enrolments } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { createPointsCache } from "./punya-points-cache";

export interface PunyaAwardContext {
  city_id: string | null;
  centre_id: string | null;
  batch_id: string | null;
  is_msv_track: boolean;
}

const EMPTY: PunyaAwardContext = {
  city_id: null,
  centre_id: null,
  batch_id: null,
  is_msv_track: false,
};

/** ~1 minute. A transfer or MSV approval should show up on the next award. */
const cache = createPointsCache<PunyaAwardContext>("award-context", 60_000);

/** Clear the cache (tests, and after an MSV approval or a student transfer). */
export function clearPunyaContextCache(): void {
  cache.clear();
}

export async function resolvePunyaAwardContext(studentId: string): Promise<PunyaAwardContext> {
  const hit = await cache.get(studentId);
  if (hit) return hit;

  const [row] = await db
    .select({
      centre_id: students.centre_id,
      batch_id: students.batch_id,
      city_id: centres.city_id,
    })
    .from(students)
    .leftJoin(centres, eq(centres.id, students.centre_id))
    .where(eq(students.id, studentId))
    .limit(1);

  if (!row) return EMPTY;

  const [msv] = await db
    .select({ id: msv_enrolments.id })
    .from(msv_enrolments)
    .where(and(eq(msv_enrolments.student_id, studentId), eq(msv_enrolments.status, "approved")))
    .limit(1);

  const ctx: PunyaAwardContext = {
    city_id: row.city_id ?? null,
    centre_id: row.centre_id ?? null,
    batch_id: row.batch_id ?? null,
    is_msv_track: Boolean(msv),
  };
  await cache.set(studentId, ctx);
  return ctx;
}
