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
        -- X-2 (review 2026-08): AT7 materialises sessions in a rolling 60-day
        -- FORWARD window, and a future 'scheduled' session passed this filter
        -- with no upper bound — so "last 3 sessions" was the next three
        -- sessions that hadn't happened yet, whose attendance is always NULL.
        -- The cron reported {flagged: 0} every night for this reason alone.
        -- AT27 runs at 02:00 IST the FOLLOWING day, so "yesterday and
        -- earlier" is the correct frame.
        and s.scheduled_date < (now() at time zone 'Asia/Kolkata')::date
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
      -- X-3 (review 2026-08) — count(*) counts the left-joined row whether or
      -- not attendance exists, and bool_and SKIPS NULL inputs, so
      -- {absent, absent, unmarked} used to satisfy count(*)=3 AND
      -- bool_and(status='absent'). AT6/AT27: unmarked is never inferred
      -- absent, so only rows that are AFFIRMATIVELY 'absent' may count.
      having count(*) filter (where status = 'absent') = 3
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

  // X-19 (review 2026-08) — sanchalakUserIdsForCentre/cityAdminUserIdsForCentre
  // used to run PER STUDENT (the latter itself two round trips), so 200
  // flagged students at one centre meant ~600 redundant queries. Resolve
  // once per distinct centre instead. The old outer "chunk" loop did no
  // batching, concurrency or pause — byte-identical to a flat loop — so it
  // is removed rather than kept as decoration.
  const centreIds = [...new Set(rows.map((r) => r.centre_id))];
  const reviewersByCentre = new Map<string, string[]>();
  for (const centreId of centreIds) {
    const [sanchalaks, cityAdmins] = await Promise.all([
      sanchalakUserIdsForCentre(centreId),
      cityAdminUserIdsForCentre(centreId),
    ]);
    reviewersByCentre.set(centreId, [...new Set([...sanchalaks, ...cityAdmins])]);
  }

  let flagged = 0;
  for (const stu of rows) {
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
    for (const id of reviewersByCentre.get(stu.centre_id) ?? []) recipients.add(id);

    // X-20 (review 2026-08) — 'general' muted the catch-all bucket along with
    // this alert, and muting absence alerts specifically was impossible.
    // With no `data`, a Sanchalak couldn't tap through to the student either.
    await notifyUsers({
      userIds: [...recipients],
      kind: "attendance",
      title_en: "Consecutive absences",
      title_hi: "लगातार अनुपस्थिति",
      body_en: `${stu.full_name} missed the last 3 Pathshala sessions.`,
      body_hi: `${stu.full_name} पिछले 3 पाठशाला सत्रों से अनुपस्थित रहे।`,
      push: true,
      data: { kind: "attendance", student_id: stu.student_id, centre_id: stu.centre_id },
    });

    flagged += 1;
  }

  logger.info({ flagged, candidates: rows.length }, "attendance.consecutive_check complete");
  return { flagged };
}
