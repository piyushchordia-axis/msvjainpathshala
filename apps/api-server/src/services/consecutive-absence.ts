/**
 * AT27 — consecutive absence check at 02:00 IST the following day.
 * Last 3 scheduled, not-cancelled, not-holiday sessions; trigger only if all 3
 * are 'absent' (excused never counts). Already-flagged guard prevents nightly re-alert.
 */
import {
  dbWorker as db,
  students,
  sessions,
  attendance,
  batches,
  centre_holidays,
  student_notes,
  consecutive_absence_alerts,
} from "@workspace/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  notifyUsers,
  sanchalakUserIdsForCentre,
  cityAdminUserIdsForCentre,
} from "../lib/notify";
import { logger } from "../lib/logger";

export async function runConsecutiveAbsenceCheck(): Promise<{ flagged: number }> {
  const active = await db
    .select({
      id: students.id,
      full_name: students.full_name,
      parent_id: students.parent_id,
      batch_id: students.batch_id,
      centre_id: students.centre_id,
    })
    .from(students)
    .where(and(eq(students.status, "active"), isNull(students.deleted_at)));

  let flagged = 0;

  for (const stu of active) {
    if (!stu.batch_id || !stu.centre_id) continue;

    const holidayRows = await db
      .select({ holiday_date: centre_holidays.holiday_date })
      .from(centre_holidays)
      .where(eq(centre_holidays.centre_id, stu.centre_id));
    const holidays = new Set(holidayRows.map((h) => h.holiday_date));

    // Last 3 scheduled eligible sessions for the batch (chronological candidates).
    const sessionRows = await db
      .select({
        id: sessions.id,
        scheduled_date: sessions.scheduled_date,
        status: sessions.status,
      })
      .from(sessions)
      .where(and(eq(sessions.batch_id, stu.batch_id), sql`${sessions.status} <> 'cancelled'`))
      .orderBy(desc(sessions.scheduled_date), desc(sessions.id))
      .limit(30);

    const eligible = sessionRows
      .filter((s) => !holidays.has(s.scheduled_date))
      .slice(0, 3);

    if (eligible.length < 3) continue;

    const marks = await db
      .select({
        session_id: attendance.session_id,
        status: attendance.status,
      })
      .from(attendance)
      .where(
        and(
          eq(attendance.student_id, stu.id),
          sql`${attendance.session_id} in (${sql.join(
            eligible.map((e) => sql`${e.id}::uuid`),
            sql`, `,
          )})`,
        ),
      );

    const bySession = new Map(marks.map((m) => [m.session_id, m.status]));
    // All 3 must be explicitly 'absent' — missing mark or excused → no alert.
    if (!eligible.every((e) => bySession.get(e.id) === "absent")) continue;

    const endSessionId = eligible[0]!.id; // most recent of the three

    const inserted = await db
      .insert(consecutive_absence_alerts)
      .values({
        student_id: stu.id,
        end_session_id: endSessionId,
      })
      .onConflictDoNothing()
      .returning({ id: consecutive_absence_alerts.id });

    if (inserted.length === 0) continue; // already-flagged guard

    await db.insert(student_notes).values({
      student_id: stu.id,
      note_type: "alert",
      body_en: `${stu.full_name} has been absent for 3 consecutive sessions.`,
      body_hi: `${stu.full_name} लगातार 3 सत्रों से अनुपस्थित हैं।`,
      metadata: {
        kind: "consecutive_absence",
        session_ids: eligible.map((e) => e.id),
        end_session_id: endSessionId,
      },
    });

    const recipients = new Set<string>();
    if (stu.parent_id) recipients.add(stu.parent_id);
    for (const id of await sanchalakUserIdsForCentre(stu.centre_id)) recipients.add(id);
    for (const id of await cityAdminUserIdsForCentre(stu.centre_id)) recipients.add(id);

    await notifyUsers({
      userIds: [...recipients],
      kind: "general",
      title_en: "Consecutive absences",
      title_hi: "लगातार अनुपस्थिति",
      body_en: `${stu.full_name} missed the last 3 Pathshala sessions.`,
      body_hi: `${stu.full_name} पिछले 3 पाठशाला सत्रों से अनुपस्थित रहे।`,
      push: true,
    });

    flagged += 1;
  }

  logger.info({ flagged }, "attendance.consecutive_check complete");
  return { flagged };
}
