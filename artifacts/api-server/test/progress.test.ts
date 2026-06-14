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
 * non-reset DB. It picks an in-scope student (super_admin sees all), reads the
 * curriculum items via the progress endpoint, sets one to 'mastered', generates
 * a report, releases it, and verifies the report is readable. A unique
 * period_label per run keeps the audit/snapshot clean.
 */
function firstAdminStudent(token: string) {
  return request(app)
    .get("/v1/admin/students?limit=200")
    .set(auth(token))
    .then((res) => {
      expect(res.status).toBe(200);
      const student = res.body.data.items[0];
      expect(student).toBeTruthy();
      return student.id as string;
    });
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
    const studentId = await firstAdminStudent(admin.token);

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
});
