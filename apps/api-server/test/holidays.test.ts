/**
 * Centre holiday DELETE / PATCH — AT10 undo + AT30 publish.
 *
 * - DELETE removes the holiday row and rematerialises centre batches so the
 *   cancelled empty sessions come back.
 * - Sessions that already had attendance were never deleted by AT10 and must
 *   not be duplicated (UNIQUE batch_id + scheduled_date + ON CONFLICT DO NOTHING).
 * - PATCH is_published only affects the public AT30 read; sessions stay put.
 */
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { pool, db, sessions, attendance, centre_holidays, batches } from "@workspace/db";
import { eq } from "drizzle-orm";
import app from "../src/app";
import { loginAs, auth } from "./helpers";
import { ulid } from "../src/lib/ulid";
import {
  addDays,
  applyHolidayToSessions,
  isoWeekday,
  todayIst,
} from "../src/services/session-materialise";

afterAll(async () => {
  const { workerPool } = await import("@workspace/db");
  await Promise.all([pool.end(), workerPool.end()]);
});

async function pickCentreWithFutureBatchDay(): Promise<{
  centreId: string;
  batchId: string;
  holidayDate: string;
}> {
  // Find an active batch and a date in the next 14 days that matches its DOW.
  const rows = await pool.query<{
    batch_id: string;
    centre_id: string;
    day_of_week: number[];
  }>(
    `select id as batch_id, centre_id, day_of_week
     from batches
     where status = 'active' and deleted_at is null
       and cardinality(day_of_week) > 0
     order by created_at asc
     limit 20`,
  );
  expect(rows.rows.length).toBeGreaterThan(0);

  const from = todayIst();
  for (const b of rows.rows) {
    const days = new Set(b.day_of_week ?? []);
    for (let i = 1; i <= 14; i++) {
      const d = addDays(from, i);
      if (days.has(isoWeekday(d))) {
        return { centreId: b.centre_id, batchId: b.batch_id, holidayDate: d };
      }
    }
  }
  throw new Error("No centre/batch with a matching weekday in the next 14 days");
}

async function ensureScheduledSession(batchId: string, date: string): Promise<string> {
  const [batch] = await db
    .select({
      start_time: batches.start_time,
      end_time: batches.end_time,
    })
    .from(batches)
    .where(eq(batches.id, batchId))
    .limit(1);
  expect(batch).toBeTruthy();

  const existing = await pool.query<{ id: string }>(
    `select id from sessions where batch_id = $1 and scheduled_date = $2::date limit 1`,
    [batchId, date],
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const [row] = await db
    .insert(sessions)
    .values({
      batch_id: batchId,
      scheduled_date: date,
      scheduled_start_time: batch!.start_time,
      scheduled_end_time: batch!.end_time,
      status: "scheduled",
    })
    .onConflictDoNothing()
    .returning({ id: sessions.id });
  if (row) return row.id;

  const again = await pool.query<{ id: string }>(
    `select id from sessions where batch_id = $1 and scheduled_date = $2::date limit 1`,
    [batchId, date],
  );
  expect(again.rows[0]).toBeTruthy();
  return again.rows[0]!.id;
}

describe("centre holidays — DELETE restore + PATCH publish (AT10 / AT30)", () => {
  it("DELETE restores sessions removed by applyHolidayToSessions", async () => {
    const admin = await loginAs("super_admin");
    const { centreId, batchId, holidayDate } = await pickCentreWithFutureBatchDay();

    const sessionId = await ensureScheduledSession(batchId, holidayDate);

    // Sanity: session exists before holiday.
    const before = await pool.query(`select id from sessions where id = $1`, [sessionId]);
    expect(before.rows.length).toBe(1);

    const created = await request(app)
      .post(`/v1/admin/centres/${centreId}/holidays`)
      .set(auth(admin.token))
      .send({ holiday_date: holidayDate, reason: "Test holiday restore", is_published: true });
    expect(created.status).toBe(200);
    const holidayId = created.body.data.id as string;

    // AT10 emptied the scheduled session.
    const gone = await pool.query(`select id from sessions where id = $1`, [sessionId]);
    expect(gone.rows.length).toBe(0);

    const del = await request(app)
      .delete(`/v1/admin/centres/${centreId}/holidays/${holidayId}`)
      .set(auth(admin.token));
    expect(del.status).toBe(200);
    expect(del.body.data.holiday_date).toBe(holidayDate);
    expect(del.body.data.sessions_restored).toBeGreaterThanOrEqual(1);

    const restored = await pool.query<{ id: string; status: string }>(
      `select id, status from sessions
       where batch_id = $1 and scheduled_date = $2::date`,
      [batchId, holidayDate],
    );
    expect(restored.rows.length).toBe(1);
    expect(restored.rows[0]!.status).toBe("scheduled");

    // Holiday row is gone.
    const still = await pool.query(`select id from centre_holidays where id = $1`, [holidayId]);
    expect(still.rows.length).toBe(0);
  });

  it("DELETE does not duplicate a session that already had attendance", async () => {
    const admin = await loginAs("super_admin");
    const { centreId, batchId, holidayDate } = await pickCentreWithFutureBatchDay();

    // Prefer a second matching weekday so we don't collide with the restore test.
    const [batch] = await db
      .select({ day_of_week: batches.day_of_week })
      .from(batches)
      .where(eq(batches.id, batchId))
      .limit(1);
    const days = new Set(batch?.day_of_week ?? []);
    let date = holidayDate;
    for (let i = 2; i <= 20; i++) {
      const d = addDays(todayIst(), i);
      if (days.has(isoWeekday(d)) && d !== holidayDate) {
        date = d;
        break;
      }
    }

    const sessionId = await ensureScheduledSession(batchId, date);

    // Attach an attendance row so AT10 must leave the session intact.
    const student = await pool.query<{ id: string }>(
      `select id from students
       where batch_id = $1 and status = 'active' and deleted_at is null
       limit 1`,
      [batchId],
    );
    expect(student.rows[0]).toBeTruthy();
    await db
      .insert(attendance)
      .values({
        session_id: sessionId,
        student_id: student.rows[0]!.id,
        status: "present",
        session_date: date,
        marked_at: new Date(),
        revision: 1,
        client_op_id: ulid(),
      })
      .onConflictDoNothing();

    // Direct AT10 apply (same as create path) — must NOT delete this session.
    await applyHolidayToSessions(centreId, date, date);
    const stillThere = await pool.query(`select id from sessions where id = $1`, [sessionId]);
    expect(stillThere.rows.length).toBe(1);

    // Insert holiday row without re-applying (session already protected).
    const [holiday] = await db
      .insert(centre_holidays)
      .values({
        centre_id: centreId,
        holiday_date: date,
        reason: "Attendance-bearing day",
        is_published: true,
      })
      .returning({ id: centre_holidays.id });

    const beforeCount = await pool.query<{ n: string }>(
      `select count(*)::text as n from sessions
       where batch_id = $1 and scheduled_date = $2::date`,
      [batchId, date],
    );
    expect(Number(beforeCount.rows[0]!.n)).toBe(1);

    const del = await request(app)
      .delete(`/v1/admin/centres/${centreId}/holidays/${holiday!.id}`)
      .set(auth(admin.token));
    expect(del.status).toBe(200);

    const afterRows = await pool.query<{ id: string }>(
      `select id from sessions
       where batch_id = $1 and scheduled_date = $2::date`,
      [batchId, date],
    );
    expect(afterRows.rows.length).toBe(1);
    expect(afterRows.rows[0]!.id).toBe(sessionId);

    // Cleanup attendance so other tests aren't polluted.
    await db.delete(attendance).where(eq(attendance.session_id, sessionId));
  });

  it("unpublish hides the holiday from public GET but leaves sessions alone", async () => {
    const admin = await loginAs("super_admin");
    const { centreId, batchId } = await pickCentreWithFutureBatchDay();

    const [batch] = await db
      .select({ day_of_week: batches.day_of_week })
      .from(batches)
      .where(eq(batches.id, batchId))
      .limit(1);
    const days = new Set(batch?.day_of_week ?? []);
    let date = addDays(todayIst(), 21);
    for (let i = 21; i <= 40; i++) {
      const d = addDays(todayIst(), i);
      if (days.has(isoWeekday(d))) {
        date = d;
        break;
      }
    }

    const sessionId = await ensureScheduledSession(batchId, date);
    const sessionCountBefore = await pool.query<{ n: string }>(
      `select count(*)::text as n from sessions where batch_id = $1 and scheduled_date = $2::date`,
      [batchId, date],
    );

    // Create unpublished directly so we don't delete sessions via AT10.
    const [holiday] = await db
      .insert(centre_holidays)
      .values({
        centre_id: centreId,
        holiday_date: date,
        reason: "Unpublished draft",
        is_published: false,
      })
      .returning({ id: centre_holidays.id });

    // Public feed must not show unpublished.
    const pubHidden = await request(app).get(`/v1/centres/${centreId}/holidays`);
    expect(pubHidden.status).toBe(200);
    const hiddenIds = (pubHidden.body.data.items as Array<{ id: string }>).map((h) => h.id);
    expect(hiddenIds).not.toContain(holiday!.id);

    // Publish → visible on public.
    const published = await request(app)
      .patch(`/v1/admin/centres/${centreId}/holidays/${holiday!.id}`)
      .set(auth(admin.token))
      .send({ is_published: true });
    expect(published.status).toBe(200);
    expect(published.body.data.is_published).toBe(true);

    const pubShown = await request(app).get(`/v1/centres/${centreId}/holidays`);
    expect(pubShown.status).toBe(200);
    expect(
      (pubShown.body.data.items as Array<{ id: string }>).map((h) => h.id),
    ).toContain(holiday!.id);

    // Unpublish again → gone from public; sessions unchanged.
    const unpublished = await request(app)
      .patch(`/v1/admin/centres/${centreId}/holidays/${holiday!.id}`)
      .set(auth(admin.token))
      .send({ is_published: false });
    expect(unpublished.status).toBe(200);
    expect(unpublished.body.data.is_published).toBe(false);

    const pubAgain = await request(app).get(`/v1/centres/${centreId}/holidays`);
    expect(
      (pubAgain.body.data.items as Array<{ id: string }>).map((h) => h.id),
    ).not.toContain(holiday!.id);

    const sessionCountAfter = await pool.query<{ n: string }>(
      `select count(*)::text as n from sessions where batch_id = $1 and scheduled_date = $2::date`,
      [batchId, date],
    );
    expect(sessionCountAfter.rows[0]!.n).toBe(sessionCountBefore.rows[0]!.n);

    const stillSession = await pool.query(`select id from sessions where id = $1`, [sessionId]);
    expect(stillSession.rows.length).toBe(1);

    // Cleanup holiday row.
    await db.delete(centre_holidays).where(eq(centre_holidays.id, holiday!.id));
  });

  it("forbids shikshak from DELETE / PATCH", async () => {
    const admin = await loginAs("super_admin");
    const centres = await request(app).get("/v1/admin/centres").set(auth(admin.token));
    const centreId = centres.body.data.items[0]?.id as string | undefined;
    expect(centreId).toBeTruthy();

    const [holiday] = await db
      .insert(centre_holidays)
      .values({
        centre_id: centreId!,
        holiday_date: addDays(todayIst(), 40),
        reason: "Shikshak gate",
        is_published: true,
      })
      .returning({ id: centre_holidays.id });

    const shikshak = await loginAs("shikshak");
    const del = await request(app)
      .delete(`/v1/admin/centres/${centreId}/holidays/${holiday!.id}`)
      .set(auth(shikshak.token));
    expect(del.status).toBe(403);

    const patch = await request(app)
      .patch(`/v1/admin/centres/${centreId}/holidays/${holiday!.id}`)
      .set(auth(shikshak.token))
      .send({ is_published: false });
    expect(patch.status).toBe(403);

    await db.delete(centre_holidays).where(eq(centre_holidays.id, holiday!.id));
  });
});
