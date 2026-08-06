/**
 * AT27 — consecutive absence check at 02:00 IST the following day.
 * Set-based: one CTE finds students whose last 3 eligible sessions are all
 * 'absent' (excused never counts). Fan-out notifications in chunks.
 *
 * `findConsecutiveAbsenceCandidates` is the shared query — the cron notifies;
 * GET /v1/admin/attendance/alerts reads the same set for the Sanchalak monitor.
 */
import {
  dbWorker as db,
  student_notes,
  consecutive_absence_alerts,
} from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  notifyUsers,
  sanchalakUserIdsForCentre,
  cityAdminUserIdsForCentre,
} from "../lib/notify";
import { logger } from "../lib/logger";

export type ConsecutiveAbsenceCandidate = {
  student_id: string;
  full_name: string;
  parent_id: string | null;
  centre_id: string;
  end_session_id: string;
  session_ids: string[];
};

/**
 * Students whose last 3 eligible sessions (non-cancelled, not on holiday) are
 * all status='absent'. Optional centre filter for the admin alerts feed.
 */
export async function findConsecutiveAbsenceCandidates(opts?: {
  centreId?: string | null;
}): Promise<ConsecutiveAbsenceCandidate[]> {
  const centreId = opts?.centreId ?? null;
  const result = await db.execute(sql`
    with active_students as (
      select id, full_name, parent_id, batch_id, centre_id
      from students
      where status = 'active'
        and deleted_at is null
        and batch_id is not null
        and centre_id is not null
        and (${centreId}::uuid is null or centre_id = ${centreId}::uuid)
    ),
    eligible_sessions as (
      select
        s.id,
        s.batch_id,
        s.scheduled_date,
        row_number() over (
          partition by s.batch_id
          order by s.scheduled_date desc, s.id desc
        ) as rn
      from sessions s
      inner join batches b on b.id = s.batch_id
      where s.status <> 'cancelled'
        and not exists (
          select 1
          from centre_holidays h
          where h.centre_id = b.centre_id
            and h.holiday_date = s.scheduled_date
        )
    ),
    last3 as (
      select id, batch_id, scheduled_date, rn
      from eligible_sessions
      where rn <= 3
    ),
    student_last3 as (
      select
        stu.id as student_id,
        stu.full_name,
        stu.parent_id,
        stu.centre_id,
        l.id as session_id,
        l.rn,
        a.status
      from active_students stu
      inner join last3 l on l.batch_id = stu.batch_id
      left join attendance a
        on a.session_id = l.id
       and a.student_id = stu.id
    ),
    flagged as (
      select
        student_id,
        full_name,
        parent_id,
        centre_id,
        (array_agg(session_id order by rn))[1] as end_session_id,
        array_agg(session_id order by rn) as session_ids
      from student_last3
      group by student_id, full_name, parent_id, centre_id
      having count(*) = 3
         and bool_and(status = 'absent')
    )
    select
      student_id::text,
      full_name,
      parent_id::text,
      centre_id::text,
      end_session_id::text,
      session_ids::text[]
    from flagged
  `);

  const rows =
    (result as unknown as { rows?: ConsecutiveAbsenceCandidate[] }).rows ??
    (Array.isArray(result) ? (result as ConsecutiveAbsenceCandidate[]) : []);
  return rows;
}

export async function runConsecutiveAbsenceCheck(): Promise<{ flagged: number }> {
  const rows = await findConsecutiveAbsenceCandidates();

  let flagged = 0;
  const NOTIFY_CHUNK = 40;

  for (let i = 0; i < rows.length; i += NOTIFY_CHUNK) {
    const chunk = rows.slice(i, i + NOTIFY_CHUNK);
    for (const stu of chunk) {
      const inserted = await db
        .insert(consecutive_absence_alerts)
        .values({
          student_id: stu.student_id,
          end_session_id: stu.end_session_id,
        })
        .onConflictDoNothing()
        .returning({ id: consecutive_absence_alerts.id });

      if (inserted.length === 0) continue;

      const sessionIds = Array.isArray(stu.session_ids) ? stu.session_ids : [];

      await db.insert(student_notes).values({
        student_id: stu.student_id,
        note_type: "alert",
        body_en: `${stu.full_name} has been absent for 3 consecutive sessions.`,
        body_hi: `${stu.full_name} लगातार 3 सत्रों से अनुपस्थित हैं।`,
        metadata: {
          kind: "consecutive_absence",
          session_ids: sessionIds,
          end_session_id: stu.end_session_id,
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
  }

  logger.info({ flagged, candidates: rows.length }, "attendance.consecutive_check complete");
  return { flagged };
}
