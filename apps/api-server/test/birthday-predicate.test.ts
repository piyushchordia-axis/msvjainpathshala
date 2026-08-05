/**
 * PERF #6 — birthday predicate rewrite (to_char → EXTRACT) must return
 * the same active students as the previous to_char form.
 */
import { afterAll, describe, expect, it } from "vitest";
import { pool, students } from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@workspace/db";

afterAll(async () => {
  const { workerPool } = await import("@workspace/db");
  await Promise.all([pool.end(), workerPool.end()]);
});

describe("students birthday predicate (PERF #6)", () => {
  it("EXTRACT(MONTH/DAY) finds the same active students as to_char(dob, MM-DD)", async () => {
    // Seed/known: pick any active student with a dob and use that MM-DD.
    const [sample] = await db
      .select({ id: students.id, dob: students.dob })
      .from(students)
      .where(and(eq(students.status, "active"), isNull(students.deleted_at), sql`${students.dob} is not null`))
      .limit(1);

    expect(sample?.dob).toBeTruthy();
    const dob = String(sample!.dob); // YYYY-MM-DD
    const mmdd = dob.slice(5, 10); // MM-DD
    const month = Number(mmdd.slice(0, 2));
    const day = Number(mmdd.slice(3, 5));

    const viaToChar = await db
      .select({ id: students.id })
      .from(students)
      .where(
        and(
          eq(students.status, "active"),
          isNull(students.deleted_at),
          sql`to_char(${students.dob}, 'MM-DD') = ${mmdd}`,
        ),
      );

    const viaExtract = await db
      .select({ id: students.id })
      .from(students)
      .where(
        and(
          eq(students.status, "active"),
          isNull(students.deleted_at),
          sql`EXTRACT(MONTH FROM ${students.dob}) = ${month}`,
          sql`EXTRACT(DAY FROM ${students.dob}) = ${day}`,
        ),
      );

    const a = viaToChar.map((r) => r.id).sort();
    const b = viaExtract.map((r) => r.id).sort();
    expect(b).toEqual(a);
    expect(a).toContain(sample!.id);
  });
});
