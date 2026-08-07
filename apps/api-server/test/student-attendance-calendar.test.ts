/**
 * Parent/student month attendance: items filtered by month=, absences GET, children.centre_id.
 */
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/app";
import { db, pool, sessions, attendance, absence_notifications } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { loginAs, auth } from "./helpers";

afterAll(async () => {
  await pool.end();
});

describe("student attendance calendar API", () => {
  it("GET /v1/me/children includes centre_id", async () => {
    const parent = await loginAs("parent");
    const res = await request(app).get("/v1/me/children").set(auth(parent.token));
    expect(res.status).toBe(200);
    const items = res.body.data.items as Array<{ id: string; centre_id: string | null }>;
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toHaveProperty("centre_id");
  });

  it("GET attendance?month= filters items; rate stays AT5 SQL", async () => {
    const parent = await loginAs("parent");
    const children = await request(app).get("/v1/me/children").set(auth(parent.token));
    const child = (children.body.data.items as Array<{ id: string }>)[0];
    if (!child) return;

    const stuRow = await pool.query<{ id: string; batch_id: string | null }>(
      `select id, batch_id from students where id = $1 and deleted_at is null`,
      [child.id],
    );
    const batchId = stuRow.rows[0]?.batch_id;
    if (!batchId) return;

    const inMonth = "2024-03-10";
    const outMonth = "2024-04-10";
    const plantedSessionIds: string[] = [];

    for (const day of [inMonth, outMonth]) {
      const [row] = await db
        .insert(sessions)
        .values({
          batch_id: batchId,
          scheduled_date: day,
          scheduled_start_time: "10:00:00",
          scheduled_end_time: "11:00:00",
          status: "completed",
          topic: `cal-test-${day}`,
        })
        .onConflictDoUpdate({
          target: [sessions.batch_id, sessions.scheduled_date],
          set: { topic: `cal-test-${day}`, status: "completed" },
        })
        .returning({ id: sessions.id });
      plantedSessionIds.push(row!.id);
      await db.delete(attendance).where(eq(attendance.session_id, row!.id));
      await db.insert(attendance).values({
        session_id: row!.id,
        student_id: child.id,
        status: "present",
        session_date: day,
        marked_method: "manual",
        revision: 1,
      });
    }

    try {
      const monthRes = await request(app)
        .get(`/v1/students/${child.id}/attendance`)
        .query({ month: "2024-03", limit: 120 })
        .set(auth(parent.token));
      expect(monthRes.status).toBe(200);
      const items = monthRes.body.data.items as Array<{ session_date: string }>;
      expect(items.every((i) => i.session_date.startsWith("2024-03"))).toBe(true);
      expect(items.some((i) => i.session_date === inMonth)).toBe(true);
      expect(items.some((i) => i.session_date === outMonth)).toBe(false);
      expect(monthRes.body.data).toHaveProperty("attendance_percent");
      const pct = monthRes.body.data.attendance_percent as number | null;
      expect(pct === null || typeof pct === "number").toBe(true);
    } finally {
      for (const sid of plantedSessionIds) {
        await db.delete(attendance).where(eq(attendance.session_id, sid));
      }
    }
  });

  it("GET /v1/students/:id/absences lists leave; month overlap; foreign parent denied", async () => {
    const parent = await loginAs("parent");
    const children = await request(app).get("/v1/me/children").set(auth(parent.token));
    const child = (children.body.data.items as Array<{ id: string }>)[0];
    if (!child) return;

    const start = "2024-06-18";
    const end = "2024-06-20";
    await db
      .delete(absence_notifications)
      .where(
        and(
          eq(absence_notifications.student_id, child.id),
          eq(absence_notifications.start_date, start),
          eq(absence_notifications.end_date, end),
        ),
      );

    const created = await request(app)
      .post(`/v1/students/${child.id}/absences`)
      .set(auth(parent.token))
      .send({ start_date: start, end_date: end, reason: "Calendar test leave" });
    expect(created.status).toBe(200);
    const absenceId = created.body.data.id as string;

    try {
      const list = await request(app)
        .get(`/v1/students/${child.id}/absences`)
        .query({ month: "2024-06" })
        .set(auth(parent.token));
      expect(list.status).toBe(200);
      const items = list.body.data.items as Array<{ id: string; start_date: string }>;
      expect(items.some((i) => i.id === absenceId)).toBe(true);

      const miss = await request(app)
        .get(`/v1/students/${child.id}/absences`)
        .query({ month: "2024-07" })
        .set(auth(parent.token));
      expect(miss.status).toBe(200);
      const missItems = miss.body.data.items as Array<{ id: string }>;
      expect(missItems.some((i) => i.id === absenceId)).toBe(false);

      const foreignStudent = await pool.query<{ id: string }>(
        `select id from students
         where deleted_at is null and parent_id is distinct from $1 and user_id is distinct from $1
         limit 1`,
        [parent.user.id],
      );
      const otherId = foreignStudent.rows[0]?.id;
      if (otherId) {
        const denied = await request(app)
          .get(`/v1/students/${otherId}/absences`)
          .set(auth(parent.token));
        expect([403, 404]).toContain(denied.status);
      }

      const missing = await request(app)
        .get(`/v1/students/00000000-0000-4000-8000-000000000099/absences`)
        .set(auth(parent.token));
      expect(missing.status).toBe(404);
    } finally {
      await db.delete(absence_notifications).where(eq(absence_notifications.id, absenceId));
    }
  });
});
