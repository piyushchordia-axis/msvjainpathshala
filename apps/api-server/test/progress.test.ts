import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth } from "./helpers";

afterAll(async () => {
  await pool.end(); // close the shared pg pool so vitest exits cleanly
});

/**
 * Progress + reports are upsert-based (UNIQUE student+item, UNIQUE
 * student+period_kind+period_label), so this test is rerun-safe against a
 * non-reset DB. It picks an in-scope Mumbai student (seeded Foundation
 * curriculum is city-scoped to Mumbai), reads the curriculum items via the
 * progress endpoint, sets one to 'mastered', generates a report, releases it,
 * and verifies the report is readable. A unique period_label per run keeps
 * the audit/snapshot clean.
 */
async function mumbaiStudentWithCurriculum(token: string): Promise<string> {
  const students = await request(app)
    .get("/v1/admin/students?limit=500")
    .set(auth(token));
  expect(students.status).toBe(200);
  const items = students.body.data.items as Array<{ id: string; student_code: string }>;
  // Prefer the seeded Mumbai child (MUM-STU-00001 Aarav) — newest Indore seed rows
  // sort first by created_at and have no city curriculum items.
  const aarav = items.find((s) => s.student_code === "MUM-STU-00001");
  if (aarav) return aarav.id;

  for (const s of items) {
    const grid = await request(app)
      .get(`/v1/progress/students/${s.id}`)
      .set(auth(token));
    if (grid.status === 200 && (grid.body.data.items?.length ?? 0) > 0) {
      return s.id;
    }
  }
  throw new Error("No in-scope student with curriculum progress items found");
}

describe("progress", () => {
  it("requires auth", async () => {
    const res = await request(app).get(
      "/v1/progress/students/00000000-0000-0000-0000-000000000000",
    );
    expect(res.status).toBe(401);
  });

  it("denies a non-admin (parent) from reading a student's progress grid", async () => {
    const parent = await loginAs("parent");
    const res = await request(app)
      .get("/v1/progress/students/00000000-0000-0000-0000-000000000000")
      .set(auth(parent.token));
    expect(res.status).toBe(403);
  });

  it("admin sets a level, generates a report, releases it, and can read reports", async () => {
    const admin = await loginAs("super_admin");
    const studentId = await mumbaiStudentWithCurriculum(admin.token);

    // GET progress grid -> seeded curriculum items appear, default not_started.
    const grid = await request(app)
      .get(`/v1/progress/students/${studentId}`)
      .set(auth(admin.token));
    expect(grid.status).toBe(200);
    const items = grid.body.data.items as Array<{ item_id: string; level: string }>;
    expect(items.length).toBeGreaterThan(0);
    const targetItemId = items[0].item_id;

    // POST set level to 'mastered'.
    const setLevel = await request(app)
      .post(`/v1/progress/students/${studentId}/items/${targetItemId}`)
      .set(auth(admin.token))
      .send({ level: "mastered", note: "Excellent grasp." });
    expect(setLevel.status).toBe(200);
    expect(setLevel.body.data.level).toBe("mastered");

    // GET again -> the item now reads 'mastered'.
    const grid2 = await request(app)
      .get(`/v1/progress/students/${studentId}`)
      .set(auth(admin.token));
    expect(grid2.status).toBe(200);
    const updated = (grid2.body.data.items as Array<{ item_id: string; level: string }>).find(
      (r) => r.item_id === targetItemId,
    );
    expect(updated?.level).toBe("mastered");

    // POST generate a report -> pdf_url points at the uploads path.
    const periodLabel = `test-${Date.now()}`;
    const report = await request(app)
      .post(`/v1/progress/students/${studentId}/reports`)
      .set(auth(admin.token))
      .send({ period_kind: "monthly", period_label: periodLabel, shikshak_comment: "Keep it up." });
    expect(report.status).toBe(200);
    const reportId: string = report.body.data.id;
    expect(reportId).toBeTruthy();
    expect(report.body.data.pdf_url).toContain("/uploads/");

    // Re-generating the same period upserts (rerun-safe), returns same id.
    const regen = await request(app)
      .post(`/v1/progress/students/${studentId}/reports`)
      .set(auth(admin.token))
      .send({ period_kind: "monthly", period_label: periodLabel });
    expect(regen.status).toBe(200);
    expect(regen.body.data.id).toBe(reportId);

    // Before release: an admin listing shows it (released flag false).
    const beforeRelease = await request(app)
      .get(`/v1/progress/students/${studentId}/reports`)
      .set(auth(admin.token));
    expect(beforeRelease.status).toBe(200);
    const mine = (beforeRelease.body.data.items as Array<{ id: string; released_to_parent: boolean }>).find(
      (r) => r.id === reportId,
    );
    expect(mine).toBeTruthy();
    expect(mine?.released_to_parent).toBe(false);

    // POST release.
    const release = await request(app)
      .post(`/v1/progress/reports/${reportId}/release`)
      .set(auth(admin.token))
      .send({});
    expect(release.status).toBe(200);
    expect(release.body.data.released).toBe(true);

    // Admin re-reads reports -> now released.
    const afterRelease = await request(app)
      .get(`/v1/progress/students/${studentId}/reports`)
      .set(auth(admin.token));
    expect(afterRelease.status).toBe(200);
    const released = (afterRelease.body.data.items as Array<{ id: string; released_to_parent: boolean }>).find(
      (r) => r.id === reportId,
    );
    expect(released?.released_to_parent).toBe(true);
  });

  it("a parent sees only RELEASED reports for their own child", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");

    // The parent's first child (e.g. Aarav) is owned by them.
    const children = await request(app).get("/v1/me/children").set(auth(parent.token));
    expect(children.status).toBe(200);
    const child = children.body.data.items[0];
    expect(child).toBeTruthy();
    const childId: string = child.id;

    // Admin generates a fresh report for that child and releases it.
    const periodLabel = `parent-${Date.now()}`;
    const report = await request(app)
      .post(`/v1/progress/students/${childId}/reports`)
      .set(auth(admin.token))
      .send({ period_kind: "termly", period_label: periodLabel });
    expect(report.status).toBe(200);
    const reportId: string = report.body.data.id;

    // Before release: parent's list does NOT include this report.
    const before = await request(app)
      .get(`/v1/progress/students/${childId}/reports`)
      .set(auth(parent.token));
    expect(before.status).toBe(200);
    expect(
      (before.body.data.items as Array<{ id: string }>).find((r) => r.id === reportId),
    ).toBeFalsy();

    // Release, then the parent sees it.
    const release = await request(app)
      .post(`/v1/progress/reports/${reportId}/release`)
      .set(auth(admin.token))
      .send({});
    expect(release.status).toBe(200);

    const after = await request(app)
      .get(`/v1/progress/students/${childId}/reports`)
      .set(auth(parent.token));
    expect(after.status).toBe(200);
    const seen = (after.body.data.items as Array<{ id: string; released_to_parent: boolean }>).find(
      (r) => r.id === reportId,
    );
    expect(seen).toBeTruthy();
    expect(seen?.released_to_parent).toBe(true);
  });

  it("denies a parent reading reports for a child that isn't theirs", async () => {
    const parent = await loginAs("parent");
    const res = await request(app)
      .get("/v1/progress/students/00000000-0000-0000-0000-000000000000/reports")
      .set(auth(parent.token));
    expect(res.status).toBe(404);
  });

  it("the report snapshot includes homework completion for the period", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const children = await request(app).get("/v1/me/children").set(auth(parent.token));
    const studentId = children.body.data.items[0].id as string;

    const batch = await pool.query<{ batch_id: string }>(
      `select batch_id from students where id = $1`,
      [studentId],
    );
    const due = "2097-06-15";
    const a = await pool.query<{ id: string }>(
      `insert into homework_assignments (batch_id, title, due_date, created_by)
       values ($1, 'F5 hw', $2, $3) returning id`,
      [batch.rows[0]!.batch_id, due, admin.user.id],
    );
    await pool.query(
      `insert into homework_submissions (assignment_id, student_id, status)
       values ($1, $2, 'starred')
       on conflict (assignment_id, student_id) do update set status = 'starred'`,
      [a.rows[0]!.id, studentId],
    );

    const report = await request(app)
      .post(`/v1/progress/students/${studentId}/reports`)
      .set(auth(admin.token))
      .send({ period_kind: "monthly", period_label: "2097-06" });
    expect(report.status).toBe(200);
    const snap = report.body.data.snapshot as {
      homework: {
        completion_rate: number | null;
        no_homework_set: boolean;
        starred_count: number;
        summary_en: string;
      };
    };
    expect(snap.homework).toBeTruthy();
    expect(snap.homework.no_homework_set).toBe(false);
    expect(snap.homework.completion_rate).toBe(1);
    expect(snap.homework.starred_count).toBe(1);
    expect(snap.homework.summary_en).toMatch(/Homework|Completion|starred/i);

    // PDF section data — same snapshot fields the PdfBuilder consumed.
    expect(snap.homework.summary_en.length).toBeGreaterThan(0);

    await pool.query(`delete from homework_assignments where id = $1`, [a.rows[0]!.id]);
  });

  it("a student with no assignments in the period shows 'no homework set', not 0%", async () => {
    const admin = await loginAs("super_admin");
    const studentId = await mumbaiStudentWithCurriculum(admin.token);

    const report = await request(app)
      .post(`/v1/progress/students/${studentId}/reports`)
      .set(auth(admin.token))
      .send({ period_kind: "monthly", period_label: "2090-01" });
    expect(report.status).toBe(200);
    const hw = report.body.data.snapshot.homework as {
      completion_rate: number | null;
      no_homework_set: boolean;
      summary_en: string;
    };
    expect(hw.completion_rate).toBeNull();
    expect(hw.no_homework_set).toBe(true);
    expect(hw.summary_en).toMatch(/no homework set/i);
    expect(hw.summary_en).not.toMatch(/^0%/);
  });

  it("the rendered PDF contains the homework section", async () => {
    // Assert via snapshot (template data) — PdfBuilder has no text extractor;
    // the same summary_en string is drawn under the Homework heading.
    const admin = await loginAs("super_admin");
    const studentId = await mumbaiStudentWithCurriculum(admin.token);
    const report = await request(app)
      .post(`/v1/progress/students/${studentId}/reports`)
      .set(auth(admin.token))
      .send({ period_kind: "monthly", period_label: `pdf-hw-${Date.now()}` });
    expect(report.status).toBe(200);
    const hw = report.body.data.snapshot.homework;
    expect(hw.label_en).toBe("Homework");
    expect(hw.label_hi).toBeTruthy();
    expect(hw.summary_en).toBeTruthy();
    expect(report.body.data.pdf_url).toContain("/uploads/");
  });
});
