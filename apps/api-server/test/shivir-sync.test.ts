/**
 * The test whose absence let the sync authorization hole ship.
 *
 * POST /v1/sync/batch is `requireAuth` only, and applyShivirScan used to check
 * nothing but "does this session exist" and "is the QR signature valid". A
 * parent could therefore take their own child's signed QR from
 * GET /v1/id-cards/mine and record attendance into ANY shivir session in the
 * country — including a check_in on a present_only session, which the online
 * route rejects with a 422.
 *
 * Every case here goes through the OFFLINE transport on purpose. The online
 * route has had its own coverage since the module shipped; the gap was that
 * nothing ever exercised the second path to the same service.
 *
 * Self-creating and rerun-safe: the session, the volunteer assignment and the
 * ID card are all created per run, and the volunteer assignment is revoked in a
 * finally block so a re-run starts from the same place.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool, db, cities, shivir_attendance_scans, shivir_volunteers } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { loginAs, auth } from "./helpers";
import { ulid } from "../src/lib/ulid";

afterAll(async () => {
  await pool.end();
});

const SYNC = "/v1/sync/batch";

interface SyncResultRow {
  submission_op_id: string;
  status: "success" | "duplicate" | "conflict" | "failed";
  server_id?: string;
  error?: { code: string; message: string };
  data?: { scan_kind?: string; was_registered?: boolean; scanned_at?: string };
}

async function postOps(
  token: string,
  ops: Array<{ submission_op_id: string; payload: unknown }>,
): Promise<SyncResultRow[]> {
  const res = await request(app)
    .post(SYNC)
    .set(auth(token))
    .send({
      ops: ops.map((o) => ({
        submission_op_id: o.submission_op_id,
        op_type: "shivir_scan",
        payload: o.payload,
        client_timestamp: new Date().toISOString(),
      })),
    });
  expect(res.status).toBe(200);
  return res.body.data.results as SyncResultRow[];
}

function isoDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/**
 * A shivir owned by this test, plus one session inside its window.
 *
 * Deliberately NOT the seeded Mumbai shivir: the seed now assigns the seeded
 * shikshak as a volunteer there, so a test that assigns them again would 409 on
 * the live-assignment unique index. Owning the shivir also keeps these cases
 * independent of the other shivir test files running in parallel.
 */
async function seedSession(adminToken: string, mode: "present_only" | "in_out") {
  const [city] = await db
    .select({ id: cities.id })
    .from(cities)
    .where(eq(cities.name, "Mumbai"))
    .limit(1);
  expect(city).toBeTruthy();

  const shivir = await request(app)
    .post("/v1/admin/shivirs")
    .set(auth(adminToken))
    .send({
      name_en: `Vitest sync ${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
      city_id: city!.id,
      start_date: isoDate(1),
      end_date: isoDate(3),
      attendance_mode: mode,
    });
  expect(shivir.status).toBe(200);
  const shivirId = shivir.body.data.id as string;

  const created = await request(app)
    .post(`/v1/shivir-scanner/shivirs/${shivirId}/sessions`)
    .set(auth(adminToken))
    .send({
      title: `Sync test ${mode}`,
      session_date: isoDate(1),
      attendance_mode: mode,
    });
  expect(created.status).toBe(200);
  return { shivirId, sessionId: created.body.data.id as string };
}

/** The seeded parent's first child, with a freshly generated signed card. */
async function parentChildCard(adminToken: string, parentToken: string) {
  const mine = await request(app).get("/v1/me/children").set(auth(parentToken));
  expect(mine.status).toBe(200);
  const studentId = (mine.body.data.items as Array<{ id: string }>)[0]?.id;
  expect(studentId).toBeTruthy();

  const gen = await request(app)
    .post(`/v1/id-cards/generate/${studentId}`)
    .set(auth(adminToken))
    .send({});
  expect(gen.status).toBe(200);

  const card = await request(app)
    .get(`/v1/id-cards/mine?student_id=${studentId}`)
    .set(auth(parentToken));
  expect(card.status).toBe(200);
  return {
    studentId: studentId as string,
    qr_payload: card.body.data.qr_payload as string,
    qr_signature: card.body.data.qr_signature as string,
  };
}

describe("POST /v1/sync/batch — shivir_scan authorization", () => {
  it("refuses a parent replaying their own child's QR into a shivir session", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const { sessionId } = await seedSession(admin.token, "present_only");
    const { studentId, qr_payload, qr_signature } = await parentChildCard(admin.token, parent.token);

    const opId = ulid();
    const [result] = await postOps(parent.token, [
      { submission_op_id: opId, payload: { shivir_session_id: sessionId, qr_payload, qr_signature } },
    ]);

    expect(result!.status).toBe("failed");
    expect(result!.error?.code).toBe("ERR_NOT_FOUND");

    // The decisive assertion: nothing was written. A 4xx that still records the
    // row would leave the attendance count wrong while looking like a refusal.
    const rows = await db
      .select({ id: shivir_attendance_scans.id })
      .from(shivir_attendance_scans)
      .where(
        and(
          eq(shivir_attendance_scans.shivir_session_id, sessionId),
          eq(shivir_attendance_scans.student_id, studentId),
        ),
      );
    expect(rows).toHaveLength(0);
  });

  it("refuses a parent's check_in on a present_only session (mode check reaches the offline path too)", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const { sessionId } = await seedSession(admin.token, "present_only");
    const { qr_payload, qr_signature } = await parentChildCard(admin.token, parent.token);

    const [result] = await postOps(parent.token, [
      {
        submission_op_id: ulid(),
        payload: { shivir_session_id: sessionId, qr_payload, qr_signature, scan_kind: "check_in" },
      },
    ]);
    // Authorization runs first, so the caller learns nothing about the session.
    expect(result!.status).toBe("failed");
  });

  it("accepts an assigned volunteer, preserves the client's scanned_at, and replays as duplicate", async () => {
    const admin = await loginAs("super_admin");
    const shikshak = await loginAs("shikshak");
    const { shivirId, sessionId } = await seedSession(admin.token, "present_only");
    const studentId = await (async () => {
      const res = await request(app).get("/v1/admin/students?limit=1").set(auth(admin.token));
      return res.body.data.items[0].id as string;
    })();

    // A shikshak is deliberately NOT admitted by role (SPEC 6.14) — they scan
    // because they were assigned, which is what this covers.
    const assign = await request(app)
      .post(`/v1/admin/shivirs/${shivirId}/volunteers`)
      .set(auth(admin.token))
      .send({ user_id: shikshak.user.id, role_label: "Vitest gate" });
    expect(assign.status).toBe(200);

    try {
      await request(app)
        .post(`/v1/id-cards/generate/${studentId}`)
        .set(auth(admin.token))
        .send({});
      const card = await request(app)
        .get(`/v1/id-cards/${studentId}`)
        .set(auth(admin.token));
      expect(card.status).toBe(200);
      const { qr_payload, qr_signature } = card.body.data;

      // A scan taken an hour ago in a basement and drained now. The server used
      // to stamp new Date() and throw this away, so a scan at 23:55 synced after
      // midnight landed on the wrong day.
      const scannedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const opId = ulid();
      const payload = {
        shivir_session_id: sessionId,
        qr_payload,
        qr_signature,
        scanned_at: scannedAt,
        client_op_id: ulid(),
      };

      const [first] = await postOps(shikshak.token, [{ submission_op_id: opId, payload }]);
      expect(first!.status).toBe("success");
      expect(first!.data?.scan_kind).toBe("present");

      const [row] = await db
        .select({ scanned_at: shivir_attendance_scans.scanned_at, offline: shivir_attendance_scans.device_offline })
        .from(shivir_attendance_scans)
        .where(
          and(
            eq(shivir_attendance_scans.shivir_session_id, sessionId),
            eq(shivir_attendance_scans.student_id, studentId),
          ),
        )
        .limit(1);
      expect(row).toBeTruthy();
      expect(row!.scanned_at.toISOString()).toBe(scannedAt);
      expect(row!.offline).toBe(true);

      // Replaying the same submission_op_id returns the stored result and does
      // not write a second row.
      const [replay] = await postOps(shikshak.token, [{ submission_op_id: opId, payload }]);
      expect(replay!.status).toBe("success");

      const all = await db
        .select({ id: shivir_attendance_scans.id })
        .from(shivir_attendance_scans)
        .where(
          and(
            eq(shivir_attendance_scans.shivir_session_id, sessionId),
            eq(shivir_attendance_scans.student_id, studentId),
          ),
        );
      expect(all).toHaveLength(1);
    } finally {
      await db
        .update(shivir_volunteers)
        .set({ revoked_at: new Date() })
        .where(
          and(
            eq(shivir_volunteers.shivir_id, shivirId),
            eq(shivir_volunteers.user_id, shikshak.user.id),
            isNull(shivir_volunteers.revoked_at),
          ),
        );
    }
  });

  it("refuses a revoked volunteer", async () => {
    const admin = await loginAs("super_admin");
    const shikshak = await loginAs("shikshak");
    const { shivirId, sessionId } = await seedSession(admin.token, "present_only");
    const studentId = await (async () => {
      const res = await request(app).get("/v1/admin/students?limit=1").set(auth(admin.token));
      return res.body.data.items[0].id as string;
    })();

    await request(app)
      .post(`/v1/admin/shivirs/${shivirId}/volunteers`)
      .set(auth(admin.token))
      .send({ user_id: shikshak.user.id });
    const revoke = await request(app)
      .delete(`/v1/admin/shivirs/${shivirId}/volunteers/${shikshak.user.id}`)
      .set(auth(admin.token));
    expect(revoke.status).toBe(200);

    await request(app).post(`/v1/id-cards/generate/${studentId}`).set(auth(admin.token)).send({});
    const card = await request(app).get(`/v1/id-cards/${studentId}`).set(auth(admin.token));
    const { qr_payload, qr_signature } = card.body.data;

    const [result] = await postOps(shikshak.token, [
      { submission_op_id: ulid(), payload: { shivir_session_id: sessionId, qr_payload, qr_signature } },
    ]);
    expect(result!.status).toBe("failed");
    expect(result!.error?.code).toBe("ERR_NOT_FOUND");
  });

  it("reports a malformed payload as ERR_VALIDATION_FAILED, not ERR_INTERNAL", async () => {
    // A bare .parse() used to let the ZodError escape to the batch catch-all and
    // surface as ERR_INTERNAL, which the client treats as retryable — so a
    // permanently broken op retried forever instead of failing once, visibly.
    const { token } = await loginAs("shikshak");
    const [result] = await postOps(token, [
      { submission_op_id: ulid(), payload: { shivir_session_id: "not-a-uuid" } },
    ]);
    expect(result!.status).toBe("failed");
    expect(result!.error?.code).toBe("ERR_VALIDATION_FAILED");
  });
});
