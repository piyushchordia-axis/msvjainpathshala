/**
 * Shared Punya award logic. Inserts a transaction, upserts the student's
 * balance, and recomputes their tier. Used by manual award, niyam approval,
 * exam pass rewards, competitions, etc. — keep all point grants going through
 * this so balances/tiers never drift.
 */
import { db, punya_transactions, punya_balances } from "@workspace/db";
import { tierForPoints } from "@workspace/db/enums";
import { eq } from "drizzle-orm";

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

  const [bal] = await db
    .select()
    .from(punya_balances)
    .where(eq(punya_balances.student_id, input.studentId))
    .limit(1);
  const newTotal = (bal?.total_points ?? 0) + input.points;
  const tier = tierForPoints(newTotal);
  if (bal) {
    await db
      .update(punya_balances)
      .set({ total_points: newTotal, tier })
      .where(eq(punya_balances.student_id, input.studentId));
  } else {
    await db.insert(punya_balances).values({ student_id: input.studentId, total_points: newTotal, tier });
  }

  return { student_id: input.studentId, points_awarded: input.points, total_points: newTotal, tier };
}
