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
  // All three writes (ledger insert + atomic balance upsert + tier) commit
  // together, so a crash can't leave the ledger and the cached balance out of
  // sync. The upsert increments in-DB on a UNIQUE(student_id) row, so
  // concurrent awards can't lose updates or create duplicate balance rows.
  const newTotal = await db.transaction(async (tx) => {
    await tx.insert(punya_transactions).values({
      student_id: input.studentId,
      feature_key: input.featureKey,
      points: input.points,
      note: input.note ?? null,
      awarded_by: input.awardedBy ?? null,
    });
    const result = await tx.execute(
      sql`insert into punya_balances (student_id, total_points)
          values (${input.studentId}, ${input.points})
          on conflict (student_id) do update
            set total_points = punya_balances.total_points + ${input.points}
          returning total_points`,
    );
    const rows = (result as unknown as { rows?: Array<{ total_points: number }> }).rows ?? [];
    const total = Number(rows[0]?.total_points ?? input.points);
    await tx
      .update(punya_balances)
      .set({ tier: tierForPoints(total) })
      .where(eq(punya_balances.student_id, input.studentId));
    return total;
  });

  return {
    student_id: input.studentId,
    points_awarded: input.points,
    total_points: newTotal,
    tier: tierForPoints(newTotal),
  };
}
