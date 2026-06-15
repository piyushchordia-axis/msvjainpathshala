/**
 * Shared Punya award logic. Inserts a transaction, upserts the student's
 * balance, and recomputes their tier. Used by manual award, niyam approval,
 * exam pass rewards, competitions, etc. — keep all point grants going through
 * this so balances/tiers never drift.
 */
import { db, punya_transactions, punya_balances } from "@workspace/db";
import { tierForPoints } from "@workspace/db/enums";
import { eq, sql } from "drizzle-orm";

export interface AwardPunyaInput {
  studentId: string;
  featureKey: string;
  points: number;
  note?: string | null;
  awardedBy?: string | null;
}

export interface AwardPunyaResult {
  student_id: string;
  points_awarded: number;
  total_points: number;
  tier: string;
}

export async function awardPunya(input: AwardPunyaInput): Promise<AwardPunyaResult> {
  await db.insert(punya_transactions).values({
    student_id: input.studentId,
    feature_key: input.featureKey,
    points: input.points,
    note: input.note ?? null,
    awarded_by: input.awardedBy ?? null,
  });

  // Atomic upsert with an in-DB increment: concurrent awards can no longer lose
  // updates or insert duplicate balance rows (student_id is UNIQUE). The new
  // total is returned so we can recompute the tier from a correct value.
  const result = await db.execute(
    sql`insert into punya_balances (student_id, total_points)
        values (${input.studentId}, ${input.points})
        on conflict (student_id) do update
          set total_points = punya_balances.total_points + ${input.points}
        returning total_points`,
  );
  const rows = (result as unknown as { rows?: Array<{ total_points: number }> }).rows ?? [];
  const newTotal = Number(rows[0]?.total_points ?? input.points);
  const tier = tierForPoints(newTotal);
  await db
    .update(punya_balances)
    .set({ tier })
    .where(eq(punya_balances.student_id, input.studentId));

  return { student_id: input.studentId, points_awarded: input.points, total_points: newTotal, tier };
}
