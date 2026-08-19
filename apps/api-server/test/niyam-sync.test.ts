/**
 * POST /v1/sync/batch — `niyam_submission` op.
 *
 * Why this file exists: the sync handler used to be a second implementation of
 * submit (services/niyam-submit-sync.ts). It inserted the row, marked it
 * auto_approved, and awarded NOTHING — no Punya, no points_awarded, no streak,
 * no badge, no gallery — and its only authorization test was a role allowlist
 * with no scope comparison, so any shikshak/sanchalak/city_admin/state_admin in
 * the country could mint a submission for any student. Once useSubmitNiyam
 * moved onto jp.queue.niyam_submissions, EVERY real submission took that path,
 * so children were told their niyam was approved and received zero Punya.
 *
 * Both entry points now call services/niyam-submit.ts. These cases pin that:
 * the ledger moves, the scope holds, and a replay does not double-award.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import {
  pool,
  db,
  niyam_submissions,
  niyam_submission_media,
  niyam_streaks,
  gallery_items,
  punya_transactions,
  upload_objects,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { loginAs, auth, type Session } from "./helpers";
import { ulid } from "../src/lib/ulid";

afterAll(async () => {
  await pool.end();
});

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

const PROOF_KEY = "niyam-proof/sync-test-proof.jpg";
const PROOF = `http://localhost:8080/uploads/${PROOF_KEY}`;
const FOREIGN_PROOF_KEY = "niyam-proof/sync-test-foreign.jpg";
const FOREIGN_PROOF = `http://localhost:8080/uploads/${FOREIGN_PROOF_KEY}`;

let admin: Session;
let parent: Session;
let shikshak: Session;
let child0: string;

async function ensureOwnedProof(userId: string, key: string): Promise<void> {
  await db
    .insert(upload_objects)
    .values({ key, uploaded_by: userId, content_type: "image/jpeg" })
    .onConflictDoUpdate({
      target: upload_objects.key,
      set: { uploaded_by: userId, content_type: "image/jpeg" },
    });
}

async function createNiyam(label: string, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await request(app)
    .post("/v1/admin/niyams")
    .set(auth(admin.token))
    .send({
      title_en: `Sync Niyam ${label}`,
      niyam_type: "daily",
      proof_type: "either",
      approval_mode: "auto",
      proof_required: false,
      max_uploads: 3,
      points: 10,
      start_date: daysAgoIst(60),
      ...extra,
    });
  expect([200, 201]).toContain(res.status);
  return res.body.data.id as string;
}

/** Post one niyam op and return its per-op result. */
async function postOp(
  token: string,
  payload: Record<string, unknown>,
  submissionOpId = ulid(),
): Promise<{
  submission_op_id: string;
  status: string;
  server_id?: string;
  error?: { code: string; message: string };
}> {
  const res = await request(app)
    .post("/v1/sync/batch")
    .set(auth(token))
    .send({
      ops: [
        {
          submission_op_id: submissionOpId,
          op_type: "niyam_submission",
          payload,
          client_timestamp: new Date().toISOString(),
        },
      ],
    });
  expect(res.status).toBe(200);
  return res.body.data.results[0];
}

beforeAll(async () => {
  admin = await loginAs("super_admin");
  parent = await loginAs("parent");
  shikshak = await loginAs("shikshak");
  const children = await request(app).get("/v1/me/children").set(auth(parent.token));
  expect(children.status).toBe(200);
  child0 = children.body.data.items[0].id;
  await ensureOwnedProof(parent.user.id, PROOF_KEY);
  await ensureOwnedProof(shikshak.user.id, FOREIGN_PROOF_KEY);
});

describe("POST /v1/sync/batch — niyam_submission", () => {
  it("awards Punya, points_awarded, streak and gallery on an auto-mode op", async () => {
    const niyamId = await createNiyam(`award-${Date.now()}`);

    const result = await postOp(parent.token, {
      niyam_id: niyamId,
      student_id: child0,
      media: [{ url: PROOF, kind: "photo" }],
      notes: "offline submit",
    });

    expect(result.status).toBe("success");
    expect(result.server_id).toBeTruthy();

    const [row] = await db
      .select()
      .from(niyam_submissions)
      .where(eq(niyam_submissions.id, result.server_id!))
      .limit(1);
    expect(row).toBeTruthy();
    expect(row!.status).toBe("auto_approved");

    // The regression itself: auto_approved with 0 points and no ledger row.
    expect(row!.points_awarded).toBe(10);
    expect(row!.punya_transaction_id).toBeTruthy();
    expect(row!.approved_at).toBeTruthy();

    const txns = await db
      .select()
      .from(punya_transactions)
      .where(eq(punya_transactions.idempotency_key, `submission:${row!.id}`));
    expect(txns).toHaveLength(1);
    expect(txns[0]!.points).toBe(10);
    expect(txns[0]!.feature_key).toBe("niyam_submission");

    const [streak] = await db
      .select()
      .from(niyam_streaks)
      .where(
        and(eq(niyam_streaks.student_id, child0), eq(niyam_streaks.niyam_id, niyamId)),
      )
      .limit(1);
    expect(streak).toBeTruthy();
    expect(streak!.current_streak).toBeGreaterThan(0);

    const media = await db
      .select()
      .from(niyam_submission_media)
      .where(eq(niyam_submission_media.submission_id, row!.id));
    expect(media).toHaveLength(1);
    expect(media[0]!.kind).toBe("photo");

    // Photo proof on an approved submission publishes a gallery row (Q6 decides
    // visibility at read time, so the row exists regardless of opt-in).
    const gallery = await db
      .select()
      .from(gallery_items)
      .where(eq(gallery_items.submission_id, row!.id));
    expect(gallery).toHaveLength(1);
  });

  it("refuses a staff actor submitting for a student they do not own", async () => {
    const niyamId = await createNiyam(`scope-${Date.now()}`);

    // A shikshak has no ownership of this child. The online endpoint is
    // parent/self only, so the offline path must be too — the old allowlist
    // admitted every staff role for every student in the country.
    const result = await postOp(shikshak.token, {
      niyam_id: niyamId,
      student_id: child0,
      notes: "should not land",
    });

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("ERR_NOT_FOUND");

    const rows = await db
      .select()
      .from(niyam_submissions)
      .where(
        and(
          eq(niyam_submissions.niyam_id, niyamId),
          eq(niyam_submissions.student_id, child0),
        ),
      );
    expect(rows).toHaveLength(0);
  });

  it("returns conflict + ERR_NIYAM_PERIOD_DUPLICATE on a second op for the same period", async () => {
    const niyamId = await createNiyam(`dup-${Date.now()}`);

    const first = await postOp(parent.token, { niyam_id: niyamId, student_id: child0 });
    expect(first.status).toBe("success");

    // Distinct submission_op_id — this is a genuine duplicate, not a replay.
    const second = await postOp(parent.token, { niyam_id: niyamId, student_id: child0 });
    expect(second.status).toBe("conflict");
    expect(second.error?.code).toBe("ERR_NIYAM_PERIOD_DUPLICATE");
  });

  it("rejects a proof URL owned by another user", async () => {
    const niyamId = await createNiyam(`foreign-${Date.now()}`);

    const result = await postOp(parent.token, {
      niyam_id: niyamId,
      student_id: child0,
      media: [{ url: FOREIGN_PROOF, kind: "photo" }],
    });

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("ERR_VALIDATION_FAILED");
  });

  it("awards nothing and stays pending for a review-mode niyam", async () => {
    const niyamId = await createNiyam(`review-${Date.now()}`, { approval_mode: "review" });

    const result = await postOp(parent.token, { niyam_id: niyamId, student_id: child0 });
    expect(result.status).toBe("success");

    const [row] = await db
      .select()
      .from(niyam_submissions)
      .where(eq(niyam_submissions.id, result.server_id!))
      .limit(1);
    expect(row!.status).toBe("pending");
    expect(row!.points_awarded).toBe(0);
    expect(row!.punya_transaction_id).toBeNull();

    const txns = await db
      .select()
      .from(punya_transactions)
      .where(eq(punya_transactions.idempotency_key, `submission:${row!.id}`));
    expect(txns).toHaveLength(0);
  });

  it("replays the same submission_op_id without awarding twice", async () => {
    const niyamId = await createNiyam(`replay-${Date.now()}`);
    const opId = ulid();

    const first = await postOp(parent.token, { niyam_id: niyamId, student_id: child0 }, opId);
    expect(first.status).toBe("success");

    const replay = await postOp(parent.token, { niyam_id: niyamId, student_id: child0 }, opId);
    expect(replay.status).toBe("success");
    expect(replay.server_id).toBe(first.server_id);

    const txns = await db
      .select()
      .from(punya_transactions)
      .where(eq(punya_transactions.idempotency_key, `submission:${first.server_id}`));
    expect(txns).toHaveLength(1);
  });

  it("honours submission_date so an op queued yesterday is not stamped today", async () => {
    const niyamId = await createNiyam(`backdate-${Date.now()}`);
    const yesterday = daysAgoIst(1);

    const result = await postOp(parent.token, {
      niyam_id: niyamId,
      student_id: child0,
      submission_date: yesterday,
    });
    expect(result.status).toBe("success");

    const [row] = await db
      .select()
      .from(niyam_submissions)
      .where(eq(niyam_submissions.id, result.server_id!))
      .limit(1);
    expect(row!.submission_date).toBe(yesterday);
    expect(row!.period_key).toBe(yesterday);
  });
});
