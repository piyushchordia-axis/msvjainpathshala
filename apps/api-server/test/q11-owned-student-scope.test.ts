/**
 * Q11 — a deactivated student must disappear from every child-scoped surface.
 *
 * Nine routes had hand-rolled ownership predicates that disagreed about this:
 * some filtered `deleted_at` only, several filtered neither `deleted_at` nor
 * `status`. The visible symptom was an inactive child still appearing in
 * GET /v1/me/children — becoming the ChildSwitcher default and then 404-ing
 * every downstream screen, because those screens DID filter correctly.
 *
 * All nine now route through ownedStudentsCondition(). This test pins the
 * agreement: deactivate a child, and it is gone from the parent's list surfaces
 * and unreachable by id.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import app from "../src/app";
import { loginAs, auth } from "./helpers";

afterAll(async () => {
  await pool.end();
});

let parentToken: string;
let adminToken: string;
let studentId: string;

/** Restore the seeded student so the suite is re-runnable and order-independent. */
async function setStatus(action: "reactivate" | "deactivate") {
  const res = await request(app)
    .post(`/v1/admin/students/${studentId}/status`)
    .set(auth(adminToken))
    .send({ action, reason: "Q11 scope regression test" });
  expect([200, 204]).toContain(res.status);
}

beforeAll(async () => {
  parentToken = (await loginAs("parent")).token;
  adminToken = (await loginAs("super_admin")).token;

  const kids = await request(app).get("/v1/me/children").set(auth(parentToken));
  expect(kids.status).toBe(200);
  const items = kids.body.data.items as Array<{ id: string }>;
  expect(items.length).toBeGreaterThan(0);
  studentId = items[0]!.id;
});

describe("Q11 — deactivated students are excluded from child-scoped routes", () => {
  it("hides the child from /v1/me/children once deactivated, and restores it", async () => {
    await setStatus("deactivate");
    try {
      const after = await request(app).get("/v1/me/children").set(auth(parentToken));
      expect(after.status).toBe(200);
      const ids = (after.body.data.items as Array<{ id: string }>).map((s) => s.id);
      expect(ids).not.toContain(studentId);
    } finally {
      await setStatus("reactivate");
    }

    // Restored — the parent gets their child back (deactivation is reversible, Q11).
    const restored = await request(app).get("/v1/me/children").set(auth(parentToken));
    const restoredIds = (restored.body.data.items as Array<{ id: string }>).map((s) => s.id);
    expect(restoredIds).toContain(studentId);
  });

  it("makes the child unreachable by id across the consolidated routes", async () => {
    await setStatus("deactivate");
    try {
      // Each of these resolves the student through a predicate that previously
      // diverged. None may return the row for an inactive child.
      const probes = [
        `/v1/me/students/${studentId}/punya`,
        `/v1/me/students/${studentId}/niyams`,
        `/v1/id-cards/mine?student_id=${studentId}`,
        `/v1/quizzes/events/available?student_id=${studentId}`,
      ];

      for (const path of probes) {
        const res = await request(app).get(path).set(auth(parentToken));
        expect(
          res.status,
          `${path} should not serve an inactive student (got ${res.status})`,
        ).not.toBe(200);
      }

      // MSV "mine" is a list surface — the child must simply be absent from it.
      const msv = await request(app).get("/v1/msv/mine").set(auth(parentToken));
      if (msv.status === 200) {
        const body = JSON.stringify(msv.body.data);
        expect(body).not.toContain(studentId);
      }
    } finally {
      await setStatus("reactivate");
    }
  });
});
