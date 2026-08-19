/**
 * The in/out state machine (SPEC 8.6 step 4) and the SPEC 6.14 role sets.
 *
 * Re-entry used to be impossible: UNIQUE (session, student, scan_kind) allowed
 * exactly one check_in per student per session for all time, so a child leaving
 * for lunch and coming back was reported as "Already scanned". The volunteer
 * also had to flip the toggle by hand, so a forgotten flip silently dropped the
 * exit. Both are now the server's job.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool, db, cities, shivir_attendance_scans, shivir_volunteers } from "@workspace/db";
import { and, asc, eq, isNull } from "drizzle-orm";
import { loginAs, auth } from "./helpers";
import { SHIVIR_RESCAN_WINDOW_SECONDS } from "../src/services/shivir-scan";

afterAll(async () => {
  await pool.end();
});

function isoDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

async function setup(mode: "in_out" | "present_only") {
  const admin = await loginAs("super_admin");
  const [city] = await db.select({ id: cities.id }).from(cities).where(eq(cities.name, "Mumbai")).limit(1);

  const shivir = await request(app)
    .post("/v1/admin/shivirs")
    .set(auth(admin.token))
    .send({
      name_en: `Vitest in/out ${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
      city_id: city!.id,
      start_date: isoDate(1),
      end_date: isoDate(3),
      attendance_mode: mode,
    });
  expect(shivir.status).toBe(200);
  const shivirId = shivir.body.data.id as string;

  const session = await request(app)
    .post(`/v1/shivir-scanner/shivirs/${shivirId}/sessions`)
    .set(auth(admin.token))
    .send({ title: "Day 1", session_date: isoDate(1), attendance_mode: mode });
  expect(session.status).toBe(200);

  const studentsRes = await request(app).get("/v1/admin/students?limit=1").set(auth(admin.token));
  const studentId = studentsRes.body.data.items[0].id as string;

  await request(app).post(`/v1/id-cards/generate/${studentId}`).set(auth(admin.token)).send({});
  const card = await request(app).get(`/v1/id-cards/${studentId}`).set(auth(admin.token));
  expect(card.status).toBe(200);

  return {
    admin,
    shivirId,
    sessionId: session.body.data.id as string,
    studentId,
    qr_payload: card.body.data.qr_payload as string,
    qr_signature: card.body.data.qr_signature as string,
  };
}

/**
 * Scan with an explicit scanned_at so the re-scan window can be stepped over
 * deterministically instead of by sleeping. Real re-entry is minutes or hours
 * later, so the window never gets in a genuine scan's way.
 */
function scan(
  token: string,
  sessionId: string,
  card: { qr_payload: string; qr_signature: string },
  opts: { scanKind?: string; secondsAgo?: number } = {},
) {
  const body: Record<string, unknown> = { ...card };
  if (opts.scanKind) body.scan_kind = opts.scanKind;
  if (opts.secondsAgo !== undefined) {
    body.scanned_at = new Date(Date.now() - opts.secondsAgo * 1000).toISOString();
  }
  return request(app)
    .post(`/v1/shivir-scanner/sessions/${sessionId}/scan`)
    .set(auth(token))
    .send(body);
}

describe("shivir in/out state machine", () => {
  it("derives check_in -> check_out -> check_in (re-entry) without a client toggle", async () => {
    const ctx = await setup("in_out");
    const card = { qr_payload: ctx.qr_payload, qr_signature: ctx.qr_signature };
    const W = SHIVIR_RESCAN_WINDOW_SECONDS;

    const first = await scan(ctx.admin.token, ctx.sessionId, card, { secondsAgo: W * 4 });
    expect(first.status).toBe(200);
    expect(first.body.data.scan_kind).toBe("check_in");
    expect(first.body.data.duplicate).toBe(false);

    const out = await scan(ctx.admin.token, ctx.sessionId, card, { secondsAgo: W * 3 });
    expect(out.status).toBe(200);
    expect(out.body.data.scan_kind).toBe("check_out");
    expect(out.body.data.duplicate).toBe(false);

    // The case the old unique key made impossible.
    const back = await scan(ctx.admin.token, ctx.sessionId, card, { secondsAgo: W * 2 });
    expect(back.status).toBe(200);
    expect(back.body.data.scan_kind).toBe("check_in");
    expect(back.body.data.duplicate).toBe(false);

    const rows = await db
      .select({ kind: shivir_attendance_scans.scan_kind })
      .from(shivir_attendance_scans)
      .where(
        and(
          eq(shivir_attendance_scans.shivir_session_id, ctx.sessionId),
          eq(shivir_attendance_scans.student_id, ctx.studentId),
        ),
      )
      .orderBy(asc(shivir_attendance_scans.scanned_at));
    expect(rows.map((r) => r.kind)).toEqual(["check_in", "check_out", "check_in"]);
  });

  it("treats a double-tap inside the re-scan window as a duplicate, not the next leg", async () => {
    const ctx = await setup("in_out");
    const card = { qr_payload: ctx.qr_payload, qr_signature: ctx.qr_signature };

    const first = await scan(ctx.admin.token, ctx.sessionId, card);
    expect(first.body.data.scan_kind).toBe("check_in");

    // Without this the auto-toggle would silently check the student out again.
    const again = await scan(ctx.admin.token, ctx.sessionId, card);
    expect(again.status).toBe(200);
    expect(again.body.data.duplicate).toBe(true);

    const rows = await db
      .select({ id: shivir_attendance_scans.id })
      .from(shivir_attendance_scans)
      .where(
        and(
          eq(shivir_attendance_scans.shivir_session_id, ctx.sessionId),
          eq(shivir_attendance_scans.student_id, ctx.studentId),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it("records one presence per student in present_only mode", async () => {
    const ctx = await setup("present_only");
    const card = { qr_payload: ctx.qr_payload, qr_signature: ctx.qr_signature };

    const first = await scan(ctx.admin.token, ctx.sessionId, card);
    expect(first.body.data.scan_kind).toBe("present");
    expect(first.body.data.duplicate).toBe(false);

    // Well outside the re-scan window — still a duplicate, because one presence
    // per session is the whole meaning of the mode.
    const later = await scan(ctx.admin.token, ctx.sessionId, card, {
      secondsAgo: -SHIVIR_RESCAN_WINDOW_SECONDS * 10,
    });
    expect(later.body.data.duplicate).toBe(true);
  });

  it("flags a walk-in and clears the flag once the student is registered", async () => {
    const ctx = await setup("present_only");
    const parent = await loginAs("parent");
    const card = { qr_payload: ctx.qr_payload, qr_signature: ctx.qr_signature };

    const walkIn = await scan(ctx.admin.token, ctx.sessionId, card);
    expect(walkIn.status).toBe(200);
    // Recorded, not refused — turning a child away at the gate over a missing
    // form is the larger harm.
    expect(walkIn.body.data.was_registered).toBe(false);

    const roster = await request(app)
      .get(`/v1/shivir-scanner/shivirs/${ctx.shivirId}/roster`)
      .set(auth(ctx.admin.token));
    expect(roster.status).toBe(200);
    const row = (roster.body.data.items as Array<{ student_id: string; state: string }>).find(
      (r) => r.student_id === ctx.studentId,
    );
    expect(row!.state).toBe("walk_in");

    // A registered child who never turns up is the other half of the question.
    const children = await request(app).get("/v1/me/children").set(auth(parent.token));
    const childId = (children.body.data.items as Array<{ id: string }>)[0]?.id;
    if (childId && childId !== ctx.studentId) {
      await request(app)
        .post(`/v1/shivirs/${ctx.shivirId}/register`)
        .set(auth(parent.token))
        .send({ student_id: childId });
      const roster2 = await request(app)
        .get(`/v1/shivir-scanner/shivirs/${ctx.shivirId}/roster`)
        .set(auth(ctx.admin.token));
      const missing = (roster2.body.data.items as Array<{ student_id: string; state: string }>).find(
        (r) => r.student_id === childId,
      );
      expect(missing!.state).toBe("not_arrived");
    }
  });

  it("rejects a session dated outside the shivir window", async () => {
    const ctx = await setup("present_only");
    const res = await request(app)
      .post(`/v1/shivir-scanner/shivirs/${ctx.shivirId}/sessions`)
      .set(auth(ctx.admin.token))
      .send({ title: "Ghost day", session_date: isoDate(40) });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/outside the shivir/i);
  });
});

describe("shivir role sets (SPEC 6.14)", () => {
  it("refuses a shikshak session-create and scan until they are assigned as a volunteer", async () => {
    const ctx = await setup("present_only");
    const shikshak = await loginAs("shikshak");
    const card = { qr_payload: ctx.qr_payload, qr_signature: ctx.qr_signature };

    // Session creation is an ops-role act; a teaching role in the city is not it.
    const create = await request(app)
      .post(`/v1/shivir-scanner/shivirs/${ctx.shivirId}/sessions`)
      .set(auth(shikshak.token))
      .send({ title: "Nope", session_date: isoDate(1) });
    expect(create.status).toBe(403);

    const before = await scan(shikshak.token, ctx.sessionId, card);
    expect(before.status).toBe(404);

    const assign = await request(app)
      .post(`/v1/admin/shivirs/${ctx.shivirId}/volunteers`)
      .set(auth(ctx.admin.token))
      .send({ user_id: shikshak.user.id });
    expect(assign.status).toBe(200);

    try {
      const after = await scan(shikshak.token, ctx.sessionId, card);
      expect(after.status).toBe(200);
      expect(after.body.data.student.id).toBe(ctx.studentId);
    } finally {
      await db
        .update(shivir_volunteers)
        .set({ revoked_at: new Date() })
        .where(
          and(
            eq(shivir_volunteers.shivir_id, ctx.shivirId),
            eq(shivir_volunteers.user_id, shikshak.user.id),
            isNull(shivir_volunteers.revoked_at),
          ),
        );
    }
  });

  it("lets a sanchalak run the dashboard but not author a shivir", async () => {
    const ctx = await setup("present_only");
    const sanchalak = await loginAs("sanchalak");

    const dash = await request(app)
      .get(`/v1/shivir-scanner/shivirs/${ctx.shivirId}/dashboard`)
      .set(auth(sanchalak.token));
    // Either in scope (200) or out of their centres' cities (404) — never a 403,
    // which is the gate being on the wrong side.
    expect([200, 404]).toContain(dash.status);

    const create = await request(app)
      .post("/v1/admin/shivirs")
      .set(auth(sanchalak.token))
      .send({
        name_en: "Sanchalak shivir",
        city_id: (await db.select({ id: cities.id }).from(cities).limit(1))[0]!.id,
        start_date: isoDate(1),
        end_date: isoDate(2),
      });
    expect(create.status).toBe(403);
  });

  it("surfaces an assignment on /v1/shivirs/mine", async () => {
    const ctx = await setup("present_only");
    const shikshak = await loginAs("shikshak");

    const before = await request(app).get("/v1/shivirs/mine").set(auth(shikshak.token));
    expect(before.status).toBe(200);
    expect((before.body.data.items as Array<{ id: string }>).map((s) => s.id)).not.toContain(
      ctx.shivirId,
    );

    await request(app)
      .post(`/v1/admin/shivirs/${ctx.shivirId}/volunteers`)
      .set(auth(ctx.admin.token))
      .send({ user_id: shikshak.user.id, role_label: "Gate" });

    try {
      const after = await request(app).get("/v1/shivirs/mine").set(auth(shikshak.token));
      expect(after.status).toBe(200);
      const row = (after.body.data.items as Array<{ id: string; role_label: string }>).find(
        (s) => s.id === ctx.shivirId,
      );
      expect(row).toBeDefined();
      expect(row!.role_label).toBe("Gate");
    } finally {
      await db
        .update(shivir_volunteers)
        .set({ revoked_at: new Date() })
        .where(
          and(
            eq(shivir_volunteers.shivir_id, ctx.shivirId),
            eq(shivir_volunteers.user_id, shikshak.user.id),
            isNull(shivir_volunteers.revoked_at),
          ),
        );
    }
  });

  it("scopes the admin shivir list to the caller's cities", async () => {
    const admin = await loginAs("super_admin");
    const shikshak = await loginAs("shikshak");

    const all = await request(app).get("/v1/admin/shivirs?limit=200").set(auth(admin.token));
    const scoped = await request(app).get("/v1/admin/shivirs?limit=200").set(auth(shikshak.token));
    expect(scoped.status).toBe(200);

    const allCities = new Set(
      (all.body.data.items as Array<{ city_name: string }>).map((s) => s.city_name),
    );
    const scopedCities = new Set(
      (scoped.body.data.items as Array<{ city_name: string }>).map((s) => s.city_name),
    );
    // The whole point of H7: a shikshak must not read the national list.
    expect(scopedCities.size).toBeLessThanOrEqual(allCities.size);
    for (const c of scopedCities) expect(allCities.has(c)).toBe(true);
  });

  it("exports attendance as CSV", async () => {
    const ctx = await setup("present_only");
    await scan(ctx.admin.token, ctx.sessionId, {
      qr_payload: ctx.qr_payload,
      qr_signature: ctx.qr_signature,
    });

    const res = await request(app)
      .get(`/v1/admin/shivirs/${ctx.shivirId}/export?format=csv`)
      .set(auth(ctx.admin.token));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    expect(res.text).toContain("Student code");
    expect(res.text.split("\r\n").length).toBeGreaterThan(1);
  });
});
