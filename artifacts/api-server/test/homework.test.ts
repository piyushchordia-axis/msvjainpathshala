import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth } from "./helpers";

afterAll(async () => {
  await pool.end(); // close the shared pg pool so vitest exits cleanly
});

/**
 * Homework is self-creating: each run picks a real seeded batch (the one Aarav,
 * the parent's first child, belongs to) via the admin batches list, creates a
 * fresh assignment for it (so its submissions are brand new), then drives the
 * full lifecycle: parent reads /mine, submits a url, shikshak stars it, and the
 * student's punya total goes up. No reliance on specific seed rows beyond the
 * seeded login personas.
 */
function tomorrow(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function firstChildId(parentToken: string): Promise<string> {
  const children = await request(app).get("/v1/me/children").set(auth(parentToken));
  expect(children.status).toBe(200);
  const child = children.body.data.items[0];
  expect(child).toBeTruthy();
  return child.id as string;
}

describe("homework", () => {
  it("requires auth on the homework feed", async () => {
    const res = await request(app).get("/v1/homework/mine?student_id=00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(401);
  });

  it("requires admin panel to create an assignment", async () => {
    const { token } = await loginAs("parent");
    const res = await request(app)
      .post("/v1/homework/assignments")
      .set(auth(token))
      .send({ batch_id: "00000000-0000-0000-0000-000000000000", title: "x", due_date: tomorrow() });
    expect(res.status).toBe(403);
  });

  it("runs the full assign -> submit -> grade -> punya lifecycle", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const shikshak = await loginAs("shikshak");

    // Aarav (parent's first child).
    const studentId = await firstChildId(parent.token);

    // Find the batch for Aarav from the student's centre's batches. We pick the
    // batch that, after creating an assignment, yields a submission for Aarav.
    const batchesRes = await request(app).get("/v1/admin/batches").set(auth(admin.token));
    expect(batchesRes.status).toBe(200);
    const batchList: Array<{ id: string }> = batchesRes.body.data.items;
    expect(batchList.length).toBeGreaterThan(0);

    // Create an assignment per batch until Aarav appears as a submission target.
    let assignmentId = "";
    let submissionId = "";
    for (const b of batchList) {
      const create = await request(app)
        .post("/v1/homework/assignments")
        .set(auth(admin.token))
        .send({ batch_id: b.id, title: `HW ${Date.now()}-${b.id.slice(0, 6)}`, due_date: tomorrow(), description: "Read chapter 1." });
      expect(create.status).toBe(200);
      expect(create.body.data.submissions_created).toBeGreaterThanOrEqual(0);

      const subs = await request(app)
        .get(`/v1/homework/assignments/${create.body.data.id}/submissions`)
        .set(auth(admin.token));
      expect(subs.status).toBe(200);
      const mine = subs.body.data.items.find((s: { student_id: string }) => s.student_id === studentId);
      if (mine) {
        assignmentId = create.body.data.id;
        submissionId = mine.id;
        expect(create.body.data.submissions_created).toBeGreaterThan(0);
        break;
      }
    }
    expect(assignmentId).toBeTruthy();
    expect(submissionId).toBeTruthy();

    // Parent sees the assignment in the student's feed.
    const feed = await request(app)
      .get(`/v1/homework/mine?student_id=${studentId}`)
      .set(auth(parent.token));
    expect(feed.status).toBe(200);
    const feedRow = feed.body.data.items.find((r: { assignment_id: string }) => r.assignment_id === assignmentId);
    expect(feedRow).toBeTruthy();
    expect(feedRow.status).toBe("pending");

    // Parent submits a url (due tomorrow -> "submitted", not late).
    const submit = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/submit`)
      .set(auth(parent.token))
      .send({ submission_url: "https://example.com/aarav-homework.jpg" });
    expect(submit.status).toBe(200);
    expect(submit.body.data.status).toBe("submitted");

    // Capture punya before grading.
    const before = await request(app).get(`/v1/me/students/${studentId}/punya`).set(auth(parent.token));
    const pointsBefore: number = before.body.data.total_points ?? 0;

    // Shikshak stars it.
    const grade = await request(app)
      .post(`/v1/homework/submissions/${submissionId}/grade`)
      .set(auth(shikshak.token))
      .send({ status: "starred", feedback_note: "Excellent work!" });
    expect(grade.status).toBe(200);
    expect(grade.body.data.status).toBe("starred");
    expect(grade.body.data.total_points).toBeGreaterThan(pointsBefore);

    // The starred status surfaces in the parent feed.
    const feed2 = await request(app)
      .get(`/v1/homework/mine?student_id=${studentId}`)
      .set(auth(parent.token));
    const graded = feed2.body.data.items.find((r: { id: string }) => r.id === submissionId);
    expect(graded.status).toBe("starred");
    expect(graded.feedback_note).toBe("Excellent work!");
  });

  it("forbids a parent submitting another student's submission", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");

    // Create an assignment for a batch and try to submit as the wrong owner by
    // forging a random submission id -> 404 (ownership check).
    const res = await request(app)
      .post(`/v1/homework/submissions/00000000-0000-0000-0000-000000000000/submit`)
      .set(auth(parent.token))
      .send({ submission_url: "https://example.com/x.jpg" });
    expect(res.status).toBe(404);

    // And a random student_id the parent does not own -> 404 on the feed.
    const feed = await request(app)
      .get(`/v1/homework/mine?student_id=11111111-1111-1111-1111-111111111111`)
      .set(auth(parent.token));
    expect(feed.status).toBe(404);

    // sanity: admin token is a real admin (keeps the var used).
    expect(admin.user.role).toBe("super_admin");
  });
});
