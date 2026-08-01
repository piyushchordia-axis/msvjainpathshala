/**
 * Generate digital ID cards for every active student.
 * Used after seed so parent/student ID Card screens have rows to show.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx ./scripts/generate-id-cards-for-seed.ts
 * (DATABASE_URL + JP_AUTH_SECRET should match the API.)
 */
import { db, pool, students, centres } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { upsertIdCardArt } from "../src/lib/idcard-render";

async function main(): Promise<void> {
  const rows = await db
    .select({
      id: students.id,
      full_name: students.full_name,
      student_code: students.student_code,
      msv_status: students.msv_status,
      photo_url: students.photo_url,
      centre_name: centres.name,
    })
    .from(students)
    .leftJoin(centres, eq(centres.id, students.centre_id))
    .where(and(isNull(students.deleted_at), eq(students.status, "active")));

  let generated = 0;
  for (const student of rows) {
    await upsertIdCardArt({
      studentId: student.id,
      fullName: student.full_name ?? student.student_code,
      studentCode: student.student_code,
      centreName: student.centre_name ?? "—",
      msvBadge: student.msv_status === "approved",
      photoUrl: student.photo_url,
      rotateQr: true,
    });
    generated += 1;
  }

  console.log(`Generated/refreshed ${generated} ID card(s).`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
