/**
 * Shikshak student-detail APIs — contact, punya, attendance access, homework history.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth } from "./helpers";

afterAll(async () => {
  await pool.end();
});

async function firstChildId(parentToken: string): Promise<string> {
  const children = await request(app).get("/v1/me/children").set(auth(parentToken));
  expect(children.status).toBe(200);
  const child = children.body.data.items[0];
  expect(child).toBeTruthy();
  return child.id as string;
}

async function tomorrow(): Promise<string> {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

describe("shikshak student detail APIs", () => {
  it("shikshak can read contact detail for a student in an assigned batch", async () => {
    const shikshak = await loginAs("shikshak");
    const list = await request(app).get("/v1/admin/students").set(auth(shikshak.token));
    expect(list.status).toBe(200);
    const student = list.body.data.items[0];
    expect(student).toBeTruthy();

    const res = await request(app)
      .get(`/v1/admin/students/${student.id}`)
      .set(auth(shikshak.token));
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(student.id);
    expect(res.body.data.full_name).toBeTruthy();
    expect(res.body.data.student_code).toBeTruthy();
    // Parent contact may be null for some fixtures, but shape must be present.
    expect("parent" in res.body.data).toBe(true);
    expect("student_phone" in res.body.data).toBe(true);
  });

  it("parent cannot read admin student detail", async () => {
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);
    const res = await request(app)
      .get(`/v1/admin/students/${studentId}`)
      .set(auth(parent.token));
    expect(res.status).toBe(403);
  });

  it("shikshak cannot read contact detail for a student outside assigned batches", async () => {
    const admin = await loginAs("super_admin");
    const shikshak = await loginAs("shikshak");

    const batches = await request(app).get("/v1/admin/batches").set(auth(admin.token));
    expect(batches.status).toBe(200);
    const outsider = (batches.body.data.items as Array<{ id: string; name: string }>).find(
      (b) => b.name === "Tarun Batch - Unassigned Scope Fixture",
    );
    expect(outsider).toBeTruthy();

    // Prefer an existing student in that batch; otherwise plant one.
    let studentId: string | null = null;
    const existing = await pool.query<{ id: string }>(
      `select id from students where batch_id = $1 and deleted_at is null limit 1`,
      [outsider!.id],
    );
    if (existing.rows[0]) {
      studentId = existing.rows[0].id;
    } else {
      const centre = await pool.query<{ centre_id: string }>(
        `select centre_id from batches where id = $1`,
        [outsider!.id],
      );
      const planted = await pool.query<{ id: string }>(
        `insert into students (full_name, student_code, age_group, batch_id, centre_id, status)
         values ('Scope Out Student', $1, 'tarun', $2, $3, 'active')
         returning id`,
        [`OUT-${Date.now().toString(36).slice(-6)}`, outsider!.id, centre.rows[0]!.centre_id],
      );
      studentId = planted.rows[0]!.id;
    }

    const res = await request(app)
      .get(`/v1/admin/students/${studentId}`)
      .set(auth(shikshak.token));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ERR_NOT_FOUND");
  });

  it("shikshak can read punya for an in-scope student", async () => {
    const shikshak = await loginAs("shikshak");
    const list = await request(app).get("/v1/admin/students").set(auth(shikshak.token));
    const student = list.body.data.items[0];
    expect(student).toBeTruthy();

    const res = await request(app)
      .get(`/v1/admin/students/${student.id}/punya`)
      .set(auth(shikshak.token));
    expect(res.status).toBe(200);
    expect(typeof res.body.data.total_points).toBe("number");
    expect(res.body.data.tier).toBeTruthy();
    expect(Array.isArray(res.body.data.transactions)).toBe(true);
  });

  it("shikshak can read attendance history for an in-scope student", async () => {
    const shikshak = await loginAs("shikshak");
    const list = await request(app).get("/v1/admin/students").set(auth(shikshak.token));
    const student = list.body.data.items[0];
    expect(student).toBeTruthy();

    const res = await request(app)
      .get(`/v1/students/${student.id}/attendance`)
      .set(auth(shikshak.token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.items)).toBe(true);
  });

  it("parent can still read their child's attendance (owner path unchanged)", async () => {
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);
    const res = await request(app)
      .get(`/v1/students/${studentId}/attendance`)
      .set(auth(parent.token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.items)).toBe(true);
  });

  it("shikshak can list homework submissions for an in-scope student", async () => {
    const admin = await loginAs("super_admin");
    const shikshak = await loginAs("shikshak");
    const list = await request(app).get("/v1/admin/students").set(auth(shikshak.token));
    const student = list.body.data.items[0];
    expect(student).toBeTruthy();

    const batchId = student.batch_id as string;
    expect(batchId).toBeTruthy();
    const create = await request(app)
      .post("/v1/homework/assignments")
      .set(auth(admin.token))
      .send({
        batch_id: batchId,
        title: `Detail HW ${Date.now()}`,
        due_date: await tomorrow(),
      });
    expect(create.status).toBe(200);
    const assignmentId = create.body.data.id as string;

    try {
      const res = await request(app)
        .get(`/v1/homework/students/${student.id}/submissions`)
        .set(auth(shikshak.token));
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.items)).toBe(true);
      const hit = res.body.data.items.find(
        (r: { assignment_id: string }) => r.assignment_id === assignmentId,
      );
      expect(hit).toBeTruthy();
      expect(hit.title).toContain("Detail HW");
    } finally {
      await pool.query(`delete from homework_assignments where id = $1`, [assignmentId]);
    }
  });

  it("shikshak cannot list homework for a student outside assigned batches", async () => {
    const admin = await loginAs("super_admin");
    const shikshak = await loginAs("shikshak");
    const batches = await request(app).get("/v1/admin/batches").set(auth(admin.token));
    const outsider = (batches.body.data.items as Array<{ id: string; name: string }>).find(
      (b) => b.name === "Tarun Batch - Unassigned Scope Fixture",
    );
    expect(outsider).toBeTruthy();

    const existing = await pool.query<{ id: string }>(
      `select id from students where batch_id = $1 and deleted_at is null limit 1`,
      [outsider!.id],
    );
    let studentId = existing.rows[0]?.id;
    if (!studentId) {
      const centre = await pool.query<{ centre_id: string }>(
        `select centre_id from batches where id = $1`,
        [outsider!.id],
      );
      const planted = await pool.query<{ id: string }>(
        `insert into students (full_name, student_code, age_group, batch_id, centre_id, status)
         values ('HW Scope Out', $1, 'tarun', $2, $3, 'active')
         returning id`,
        [`HWO-${Date.now().toString(36).slice(-6)}`, outsider!.id, centre.rows[0]!.centre_id],
      );
      studentId = planted.rows[0]!.id;
    }

    const res = await request(app)
      .get(`/v1/homework/students/${studentId}/submissions`)
      .set(auth(shikshak.token));
    expect(res.status).toBe(404);
  });
});
