/**
 * Competition Punya (H11) — AT18 reverse-then-award, keyed per registration.
 *
 * Publishing results was award-only, and rank edits were refused with 409 once
 * published. Together that made a mis-entered rank permanent: the wrong student
 * kept the winner bonus, the real winner could never be paid, and no surface
 * anywhere could reverse either. The only workaround was a manual award, which
 * left the ledger telling a false story about who won.
 *
 * Awards are now synchronized from the registrations' current ranks, so publish
 * and a later corrected rank run the SAME code and converge on the same state.
 */
import { db, competitions, competition_registrations } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { awardPunya, reversePunya } from "./punya";

export const COMPETITION_FEATURE_KEY = "competition";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Base key per registration; :g{n} suffix after a reversal (AT18). */
export function competitionAwardKey(
  competitionId: string,
  registrationId: string,
  generation = 0,
): string {
  const base = `competition-award:${competitionId}:${registrationId}`;
  return generation <= 0 ? base : `${base}:g${generation}`;
}

export interface CompetitionSyncResult {
  awarded: number;
  reversed: number;
  registrations: number;
}

type LiveAward = {
  registration_id: string;
  id: string;
  points: number;
  idempotency_key: string;
  generation: number;
};

/**
 * Unreversed competition awards for this competition, plus how many awards each
 * registration has ever held (the next generation number).
 */
async function liveAwardsByRegistration(
  tx: Tx,
  competitionId: string,
): Promise<Map<string, LiveAward>> {
  const prefix = `competition-award:${competitionId}:`;
  const result = await tx.execute(sql`
    select t.id, t.points, t.idempotency_key
    from punya_transactions t
    where t.feature_key = ${COMPETITION_FEATURE_KEY}
      and t.points > 0
      and t.idempotency_key like ${prefix + "%"}
      and not exists (select 1 from punya_transactions r where r.reversal_of = t.id)
  `);
  const rows =
    (result as unknown as {
      rows?: Array<{ id: string; points: number; idempotency_key: string }>;
    }).rows ?? [];

  // The registration id is parsed here rather than in SQL on purpose.
  // `substring(col from $1)` with a bound parameter resolves to the SQL
  // -standard REGEX form of substring, not the positional one — Postgres
  // infers text for an untyped parameter — so it silently returned NULL and
  // every live award went unmatched. It only works with a literal offset,
  // which is exactly what makes it pass when probed by hand in psql.
  const map = new Map<string, LiveAward>();
  for (const r of rows) {
    const rest = r.idempotency_key.slice(prefix.length);
    const registrationId = rest.split(':')[0] ?? '';
    if (!registrationId) continue;
    map.set(registrationId, {
      registration_id: registrationId,
      id: r.id,
      points: Number(r.points),
      idempotency_key: r.idempotency_key,
      generation: 0,
    });
  }
  return map;
}

/** Total awards ever written for a registration — the next generation number. */
async function generationFor(tx: Tx, competitionId: string, registrationId: string): Promise<number> {
  const prefix = competitionAwardKey(competitionId, registrationId);
  const result = await tx.execute(sql`
    select count(*)::int as n
    from punya_transactions t
    where t.feature_key = ${COMPETITION_FEATURE_KEY}
      and t.points > 0
      and (t.idempotency_key = ${prefix} or t.idempotency_key like ${prefix + ":g%"})
  `);
  return Number((result as unknown as { rows?: Array<{ n: number }> }).rows?.[0]?.n ?? 0);
}

/**
 * Bring the ledger in line with the competition's current ranks.
 *
 * Idempotent: a registration whose entitlement is unchanged is left alone, so
 * republishing or re-saving identical ranks writes nothing. Safe to compose
 * into the caller's transaction.
 */
export async function synchronizeCompetitionAwards(
  tx: Tx,
  comp: {
    id: string;
    name_en: string;
    winner_points: number;
    participant_points: number;
  },
  awardedBy: string | null,
): Promise<CompetitionSyncResult> {
  const regs = await tx
    .select({
      id: competition_registrations.id,
      student_id: competition_registrations.student_id,
      result_rank: competition_registrations.result_rank,
    })
    .from(competition_registrations)
    .where(eq(competition_registrations.competition_id, comp.id));

  const live = await liveAwardsByRegistration(tx, comp.id);

  let awarded = 0;
  let reversed = 0;

  for (const r of regs) {
    // By design: rank-1 earns winner_points; EVERY other registrant (ranked or
    // not) earns participant_points just for taking part. Participation points
    // are intentionally granted to all registrants — not a bug.
    const desired = r.result_rank === 1 ? comp.winner_points : comp.participant_points;
    const held = live.get(r.id);

    if (held && held.points === desired) continue; // already correct
    if (!held && desired <= 0) continue; // nothing due, nothing held

    if (held) {
      await reversePunya(
        {
          studentId: r.student_id,
          featureKey: COMPETITION_FEATURE_KEY,
          points: held.points,
          note: `${comp.name_en} — result corrected`,
          awardedBy,
          idempotencyKey: `${held.idempotency_key}:reversal`,
        },
        tx,
      );
      reversed += 1;
    }

    if (desired > 0) {
      const generation = await generationFor(tx, comp.id, r.id);
      const res = await awardPunya(
        {
          studentId: r.student_id,
          featureKey: COMPETITION_FEATURE_KEY,
          points: desired,
          note: `${comp.name_en}${r.result_rank === 1 ? " (winner)" : ""}`,
          awardedBy,
          idempotencyKey: competitionAwardKey(comp.id, r.id, generation),
          sourceEntityKind: COMPETITION_FEATURE_KEY,
          sourceEntityId: comp.id,
        },
        tx,
      );
      if (res.awarded) awarded += 1;
    }
  }

  return { awarded, reversed, registrations: regs.length };
}

/** Competition row shape the synchroniser needs. */
export async function loadCompetitionForAwards(
  tx: Tx,
  competitionId: string,
): Promise<
  { id: string; name_en: string; winner_points: number; participant_points: number } | undefined
> {
  const [row] = await tx
    .select({
      id: competitions.id,
      name_en: competitions.name_en,
      winner_points: competitions.winner_points,
      participant_points: competitions.participant_points,
    })
    .from(competitions)
    .where(eq(competitions.id, competitionId))
    .limit(1);
  return row;
}
