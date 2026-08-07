import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/app";
import { db, pool, upload_objects } from "@workspace/db";
import { loginAs, auth, type Session } from "./helpers";

const REJECT_REASON =
  "Proof is unclear; please resubmit with a clearer photo.";

const PROOF_KEY = "niyam-proof/me-niyams-proof.jpg";
const PROOF = `http://localhost:8080/uploads/${PROOF_KEY}`;

function todayIst(): string {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

function daysAgoIst(n: number): string {
  const d = new Date(`${todayIst()}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

async function ensureOwnedProof(userId: string, key: string): Promise<void> {
  await db
    .insert(upload_objects)
    .values({ key, uploaded_by: userId, content_type: "image/jpeg" })
    .onConflictDoUpdate({
      target: upload_objects.key,
      set: { uploaded_by: userId, content_type: "image/jpeg" },
    });
}

afterAll(async () => {
  await pool.end();
});

describe("GET /v1/me/students/:id/niyams — proof + rejection_reason", () => {
  let admin: Session;
  let parent: Session;
  let shikshak: Session;
  let child0: string;
  let child1: string;

  beforeAll(async () => {
    admin = await loginAs("super_admin");
    parent = await loginAs("parent");
    shikshak = await loginAs("shikshak");
    const children = await request(app).get("/v1/me/children").set(auth(parent.token));
    expect(children.status).toBe(200);
    child0 = children.body.data.items[0].id;
    child1 = children.body.data.items[1].id;
    await ensureOwnedProof(parent.user.id, PROOF_KEY);
  });

  async function createNiyam(label: string): Promise<string> {
    const res = await request(app)
      .post("/v1/admin/niyams")
      .set(auth(admin.token))
      .send({
        title_en: `Me Niyam ${label}`,
        niyam_type: "daily",
        proof_type: "either",
        approval_mode: "review",
        proof_required: false,
        max_uploads: 3,
        points: 10,
        start_date: daysAgoIst(60),
      });
    expect([200, 201]).toContain(res.status);
    return res.body.data.id as string;
  }

  it("returns media[] with signed URLs for a submission that has proof", async () => {
    const niyamId = await createNiyam(`proof-${Date.now()}`);
    const submit = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({
        niyam_id: niyamId,
        student_id: child0,
        submission_date: todayIst(),
        media: [{ url: PROOF, kind: "photo" }],
        notes: "Parent can see this proof.",
      });
    expect(submit.status).toBe(200);
    const submissionId: string = submit.body.data.id;

    const res = await request(app)
      .get(`/v1/me/students/${child0}/niyams?limit=80`)
      .set(auth(parent.token));
    expect(res.status).toBe(200);
    const row = res.body.data.items.find((n: { id: string }) => n.id === submissionId);
    expect(row).toBeTruthy();
    expect(row.notes).toBe("Parent can see this proof.");
    expect(Array.isArray(row.media)).toBe(true);
    expect(row.media.length).toBeGreaterThan(0);
    expect(row.media[0].url).toMatch(/[?&]sig=/);
    expect(row.media[0].url).toMatch(/[?&]se=/);
    expect(row.proof_url).toMatch(/[?&]sig=/);
  });

  it("returns rejection_reason for a rejected submission", async () => {
    const niyamId = await createNiyam(`reject-${Date.now()}`);
    const submit = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parent.token))
      .send({
        niyam_id: niyamId,
        student_id: child0,
        submission_date: todayIst(),
        proof_url: PROOF,
      });
    expect(submit.status).toBe(200);
    const submissionId: string = submit.body.data.id;

    const reject = await request(app)
      .post(`/v1/niyam-submissions/${submissionId}/reject`)
      .set(auth(shikshak.token))
      .send({ reason: REJECT_REASON });
    expect(reject.status).toBe(200);

    const res = await request(app)
      .get(`/v1/me/students/${child0}/niyams?limit=80`)
      .set(auth(parent.token));
    expect(res.status).toBe(200);
    const row = res.body.data.items.find((n: { id: string }) => n.id === submissionId);
    expect(row).toBeTruthy();
    expect(row.status).toBe("rejected");
    expect(row.rejection_reason).toBe(REJECT_REASON);
  });

  it("does not let a parent read another parent's child's submissions", async () => {
    // Pick a student that is not one of this parent's children.
    const students = await request(app)
      .get("/v1/admin/students?limit=100")
      .set(auth(admin.token));
    expect(students.status).toBe(200);
    const foreign = (students.body.data.items as Array<{ id: string }>).find(
      (s) => s.id !== child0 && s.id !== child1,
    );
    expect(foreign, "seed should have a student outside this parent").toBeTruthy();

    const res = await request(app)
      .get(`/v1/me/students/${foreign!.id}/niyams`)
      .set(auth(parent.token));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ERR_NOT_FOUND");
  });
});
