/**
 * GET /v1/admin/attendance/alerts — Sanchalak centre monitor (AT27 / AT6 / AT32).
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool, db, sessions, attendance } from "@workspace/db";
import { eq } from "drizzle-orm";
import { loginAs, auth, type Session } from "./helpers";
import { todayIst } from "../src/services/session-materialise";

afterAll(async () => {
  await pool.end();
});

describe("GET /v1/admin/attendance/alerts", () => {
  let sanchalak: Session;
  let admin: Session;
  let centreId: string;

  beforeAll(async () => {
    sanchalak = await loginAs("sanchalak");
    admin = await loginAs("super_admin");
    await request(app).post("/v1/admin/sessions/materialise").set(auth(admin.token)).send({});

    const centres = await request(app)
      .get("/v1/admin/centres")
      .set(auth(sanchalak.token));
    expect(centres.status).toBe(200);
    const items = centres.body.data.items as Array<{ id: string }>;
    expect(items.length).toBeGreaterThan(0);
    centreId = items[0]!.id;
  });

  it("requires centre_id and returns the alert shape with meta counts", async () => {
    const missing = await request(app)
      .get("/v1/admin/attendance/alerts")
      .set(auth(sanchalak.token));
    expect(missing.status).toBe(422);

    const okRes = await request(app)
      .get("/v1/admin/attendance/alerts")
      .query({ centre_id: centreId })
      .set(auth(sanchalak.token));
    expect(okRes.status).toBe(200);
    expect(okRes.body.data).toHaveProperty("consecutive_absences");
    expect(okRes.body.data).toHaveProperty("unmarked_sessions");
    expect(okRes.body.data).toHaveProperty("gps_flagged_sessions");
    expect(okRes.body.data).toHaveProperty("not_checked_in_sessions");
    expect(typeof okRes.body.meta.alert_count).toBe("number");
  });

  it("consecutive_absences never include students from another centre", async () => {
    const res = await request(app)
      .get("/v1/admin/attendance/alerts")
      .query({ centre_id: centreId })
      .set(auth(sanchalak.token));
    expect(res.status).toBe(200);
    const rows = res.body.data.consecutive_absences as Array<{ student_id: string }>;
    for (const row of rows) {
      const stu = await pool.query<{ centre_id: string }>(
        `select centre_id from students where id = $1`,
        [row.student_id],
      );
      expect(stu.rows[0]?.centre_id).toBe(centreId);
    }
  });

  it("AT6 + AT32.3: unmarked has zero marks; null check-in is not gps_flagged", async () => {
    const today = todayIst();
    const pick = await pool.query<{
      id: string;
      check_in_at: string | null;
      gps_flagged: boolean;
      scheduled_end_time: string | null;
    }>(
      `select s.id, s.check_in_at, s.gps_flagged, s.scheduled_end_time::text
       from sessions s
       join batches b on b.id = s.batch_id
       where b.centre_id = $1 and s.scheduled_date = $2::date and s.status <> 'cancelled'
       limit 1`,
      [centreId, today],
    );
    if (!pick.rows[0]) return; // no session today — skip rather than invent conflicting dates
    const sessionId = pick.rows[0].id;
    const prev = pick.rows[0];

    await db.delete(attendance).where(eq(attendance.session_id, sessionId));
    await db
      .update(sessions)
      .set({
        scheduled_start_time: "06:00:00",
        scheduled_end_time: "07:00:00",
        check_in_at: null,
        gps_flagged: false,
        gps_unverified: true,
        status: "scheduled",
      })
      .where(eq(sessions.id, sessionId));

    try {
      const alerts = await request(app)
        .get("/v1/admin/attendance/alerts")
        .query({ centre_id: centreId, date: today })
        .set(auth(sanchalak.token));
      expect(alerts.status).toBe(200);

      const unmarked = alerts.body.data.unmarked_sessions as Array<{ id: string; label: string }>;
      expect(unmarked.some((s) => s.id === sessionId)).toBe(true);
      expect(unmarked.find((s) => s.id === sessionId)?.label).toBe("not_marked");

      const notChecked = alerts.body.data.not_checked_in_sessions as Array<{ id: string }>;
      const gpsFlagged = alerts.body.data.gps_flagged_sessions as Array<{ id: string }>;
      expect(notChecked.some((s) => s.id === sessionId)).toBe(true);
      expect(gpsFlagged.some((s) => s.id === sessionId)).toBe(false);

      const todayList = await request(app)
        .get("/v1/sessions/today")
        .query({ centre_id: centreId, date: today, session_id: sessionId })
        .set(auth(sanchalak.token));
      expect(todayList.status).toBe(200);
      const item = (
        todayList.body.data.items as Array<{
          id: string;
          present_count: number;
          total_count: number;
          check_in_at: string | null;
          gps_flagged: boolean;
          conducted_by_name: string | null;
        }>
      ).find((s) => s.id === sessionId);
      expect(item).toBeTruthy();
      expect(item!.present_count).toBe(0);
      expect(item!.total_count).toBe(0);
      expect(item!.check_in_at).toBeNull();
      expect(item!.gps_flagged).toBe(false);
      expect("conducted_by_name" in item!).toBe(true);

      // Flip to GPS-flagged with a real check-in — must leave not_checked_in.
      await db
        .update(sessions)
        .set({
          check_in_at: new Date(),
          gps_flagged: true,
          gps_unverified: false,
          status: "in_progress",
        })
        .where(eq(sessions.id, sessionId));

      const again = await request(app)
        .get("/v1/admin/attendance/alerts")
        .query({ centre_id: centreId, date: today })
        .set(auth(sanchalak.token));
      expect(again.status).toBe(200);
      expect(
        (again.body.data.gps_flagged_sessions as Array<{ id: string }>).some(
          (s) => s.id === sessionId,
        ),
      ).toBe(true);
      expect(
        (again.body.data.not_checked_in_sessions as Array<{ id: string }>).some(
          (s) => s.id === sessionId,
        ),
      ).toBe(false);
    } finally {
      await db
        .update(sessions)
        .set({
          check_in_at: prev.check_in_at ? new Date(prev.check_in_at) : null,
          gps_flagged: prev.gps_flagged,
          scheduled_end_time: prev.scheduled_end_time ?? "07:00:00",
        })
        .where(eq(sessions.id, sessionId));
    }
  });
});
