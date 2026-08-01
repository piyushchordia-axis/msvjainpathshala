import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, pool, students, punya_transactions, punya_balances } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { awardPunya, reversePunya } from "../src/lib/punya";

afterAll(async () => {
  await pool.end();
});

describe("punya idempotency (dedicated idempotency_key)", () => {
  let studentId: string;
  const featureKey = "niyam_submission";
  // Use a real-looking uuid for parseable source_entity_id
  const submissionId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const idempotencyKey = `submission:${submissionId}`;
  const reversalKey = `${idempotencyKey}:reversal`;

  beforeAll(async () => {
    const [row] = await db.select({ id: students.id }).from(students).limit(1);
    expect(row?.id).toBeTruthy();
    studentId = row!.id;

    // Clean any prior rows from this test key pair
    await db
      .delete(punya_transactions)
      .where(inArray(punya_transactions.idempotency_key, [idempotencyKey, reversalKey]));
  });

  it("awardPunya twice with the same key credits once", async () => {
    const [balBefore] = await db
      .select({ total_points: punya_balances.total_points })
      .from(punya_balances)
      .where(eq(punya_balances.student_id, studentId))
      .limit(1);
    const before = balBefore?.total_points ?? 0;

    const first = await awardPunya({
      studentId,
      featureKey,
      points: 7,
      note: "idempotency-test-award",
      idempotencyKey,
    });
    expect(first.awarded).toBe(true);
    expect(first.points_awarded).toBe(7);
    expect(first.total_points).toBe(before + 7);

    const second = await awardPunya({
      studentId,
      featureKey,
      points: 7,
      note: "idempotency-test-award-replay",
      idempotencyKey,
    });
    expect(second.awarded).toBe(false);
    expect(second.total_points).toBe(before + 7);

    const ledger = await db
      .select()
      .from(punya_transactions)
      .where(eq(punya_transactions.idempotency_key, idempotencyKey));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.feature_key).toBe("niyam_submission");
    expect(ledger[0]!.feature_key.includes("#")).toBe(false);
    expect(ledger[0]!.points).toBe(7);
    expect(ledger[0]!.source_entity_id).toBe(submissionId);
  });

  it("reversePunya twice with the same key debits once and sets reversal_of", async () => {
    const [credit] = await db
      .select()
      .from(punya_transactions)
      .where(eq(punya_transactions.idempotency_key, idempotencyKey))
      .limit(1);
    expect(credit).toBeTruthy();

    const [balBefore] = await db
      .select({ total_points: punya_balances.total_points })
      .from(punya_balances)
      .where(eq(punya_balances.student_id, studentId))
      .limit(1);
    const before = balBefore!.total_points;

    const first = await reversePunya({
      studentId,
      featureKey,
      points: 7,
      note: "idempotency-test-reverse",
      idempotencyKey: reversalKey,
    });
    expect(first.reversed).toBe(true);
    expect(first.points_reversed).toBe(7);
    expect(first.total_points).toBe(before - 7);

    const second = await reversePunya({
      studentId,
      featureKey,
      points: 7,
      note: "idempotency-test-reverse-replay",
      idempotencyKey: reversalKey,
    });
    expect(second.reversed).toBe(false);
    expect(second.total_points).toBe(before - 7);

    const debits = await db
      .select()
      .from(punya_transactions)
      .where(eq(punya_transactions.idempotency_key, reversalKey));
    expect(debits).toHaveLength(1);
    expect(debits[0]!.feature_key).toBe("niyam_submission");
    expect(debits[0]!.feature_key.includes("#")).toBe(false);
    expect(debits[0]!.points).toBe(-7);
    expect(debits[0]!.reversal_of).toBe(credit!.id);
    expect(debits[0]!.source_entity_id).toBe(submissionId);
  });
});
