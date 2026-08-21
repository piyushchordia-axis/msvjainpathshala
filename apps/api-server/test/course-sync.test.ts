/**
 * Step 5 — offline course_progress / course_certification via POST /v1/sync/batch (CU31).
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import app from "../src/app";
import { loginAs, auth } from "./helpers";
import { ulid } from "../src/lib/ulid";

afterAll(async () => {
  await pool.end();
});

const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function mumbaiCityId(superToken: string): Promise<string> {
  const geo = await request(app).get("/v1/admin/geography").set(auth(superToken));
  if (geo.status === 200 && Array.isArray(geo.body.data?.cities)) {
    const mumbai = (geo.body.data.cities as Array<{ id: string; name: string }>).find((c) =>
      /mumbai/i.test(c.name),
    );
    if (mumbai) return mumbai.id;
    return geo.body.data.cities[0].id;
  }
  const centres = await request(app).get("/v1/admin/centres").set(auth(superToken));
  return (centres.body.data.items as Array<{ city_id: string }>)[0]!.city_id;
}

async function publishableCourse(
  adminToken: string,
  cityId: string,
): Promise<{ courseId: string; sectionId: string }> {
  const create = await request(app)
    .post("/v1/admin/courses")
    .set(auth(adminToken))
    .send({
      name_en: `Sync course ${stamp()}`,
      name_hi: "सिंक पाठ्यक्रम",
      kind: "standard",
      academic_year: "2025-26",
      city_id: cityId,
      punya_points: 20,
    });
  expect(create.status).toBe(200);
  const courseId = create.body.data.id as string;
  const sec = await request(app)
    .post(`/v1/courses/${courseId}/sections`)
    .set(auth(adminToken))
    .send({ title_en: "Sec A", title_hi: "अनुभाग क", punya_points: 40 });
  expect(sec.status).toBe(200);
  await request(app)
    .post(`/v1/admin/courses/${courseId}/publish`)
    .set(auth(adminToken))
    .expect(200);
  return { courseId, sectionId: sec.body.data.id };
}

async function shikshakStudent(): Promise<string> {
  const kid = await pool.query<{ id: string }>(
    `select s.id from students s
       join shikshak_batch_assignments a on a.batch_id = s.batch_id and a.is_active = true
       join users u on u.id = a.user_id
      where u.phone = '+919800000005' and s.status = 'active' and s.deleted_at is null
      limit 1`,
  );
  expect(kid.rows[0]?.id).toBeTruthy();
  return kid.rows[0]!.id;
}

async function balanceOf(studentId: string): Promise<number> {
  const r = await pool.query<{ total_points: number }>(
    `select coalesce(total_points, 0)::int as total_points from punya_balances where student_id = $1`,
    [studentId],
  );
  return r.rows[0]?.total_points ?? 0;
}

async function punyaTxCount(studentId: string): Promise<number> {
  const r = await pool.query<{ n: string }>(
    `select count(*)::text as n from punya_transactions where student_id = $1 and points > 0`,
    [studentId],
  );
  return Number(r.rows[0]!.n);
}

describe("course sync step 5", () => {
  it("1 — a plain course_progress op applies via sync: row created, status and client_marked_at stored (CU9/CU31 baseline)", async () => {
    const superAdmin = await loginAs("super_admin");
    const shikshak = await loginAs("shikshak");
    const cityId = await mumbaiCityId(superAdmin.token);
    const { sectionId } = await publishableCourse(superAdmin.token, cityId);
    const studentId = await shikshakStudent();

    const markedAt = new Date();
    const clientOpId = ulid();
    const opId = ulid();
    const res = await request(app)
      .post("/v1/sync/batch")
      .set(auth(shikshak.token))
      .send({
        ops: [
          {
            submission_op_id: opId,
            op_type: "course_progress",
            payload: {
              node_kind: "section",
              node_id: sectionId,
              marks: [{ student_id: studentId, status: "in_progress", client_op_id: clientOpId }],
              marked_at: markedAt.toISOString(),
            },
            client_timestamp: markedAt.toISOString(),
          },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.results[0].status).toBe("success");
    expect(res.body.data.results[0].error).toBeUndefined();
    expect(res.body.data.results[0].server_id).toBeTruthy();

    const row = await pool.query<{
      status: string;
      client_marked_at: Date | null;
      client_op_id: string | null;
      certified_at: Date | null;
    }>(
      `select status, client_marked_at, client_op_id, certified_at from student_course_progress
        where student_id = $1 and section_id = $2 and subsection_id is null`,
      [studentId, sectionId],
    );
    expect(row.rows[0]?.status).toBe("in_progress");
    expect(row.rows[0]?.client_marked_at).toBeTruthy();
    expect(row.rows[0]?.client_op_id).toBe(clientOpId);
    expect(row.rows[0]?.certified_at).toBeNull();

    // sync_operations replay record (CLAUDE.md offline §5) — required, not
    // a read-only lookup table.
    const syncRow = await pool.query<{ status: string; op_kind: string }>(
      `select status, op_kind from sync_operations where submission_op_id = $1`,
      [opId],
    );
    expect(syncRow.rows[0]?.status).toBe("success");
    expect(syncRow.rows[0]?.op_kind).toBe("course_progress");
  });

  it("2 — certify with no prior completion soft-transitions to completed+certified", async () => {
    const superAdmin = await loginAs("super_admin");
    const shikshak = await loginAs("shikshak");
    const cityId = await mumbaiCityId(superAdmin.token);
    const { sectionId } = await publishableCourse(superAdmin.token, cityId);
    const studentId = await shikshakStudent();

    const opId = ulid();
    const res = await request(app)
      .post("/v1/sync/batch")
      .set(auth(shikshak.token))
      .send({
        ops: [
          {
            submission_op_id: opId,
            op_type: "course_certification",
            payload: {
              node_kind: "section",
              node_id: sectionId,
              student_id: studentId,
              client_op_id: ulid(),
              certified_at: new Date().toISOString(),
            },
            client_timestamp: new Date().toISOString(),
          },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.results[0].status).toBe("success");
    expect(res.body.data.results[0].error).toBeUndefined();

    const row = await pool.query<{ status: string; certified_at: Date | null }>(
      `select status, certified_at from student_course_progress
        where student_id = $1 and section_id = $2 and subsection_id is null`,
      [studentId, sectionId],
    );
    expect(row.rows[0]?.status).toBe("completed");
    expect(row.rows[0]?.certified_at).toBeTruthy();
  });

  it("3 — certification before progress still ends completed+certified", async () => {
    const superAdmin = await loginAs("super_admin");
    const shikshak = await loginAs("shikshak");
    const cityId = await mumbaiCityId(superAdmin.token);
    const { sectionId } = await publishableCourse(superAdmin.token, cityId);
    const studentId = await shikshakStudent();

    const certOp = ulid();
    const progOp = ulid();
    // Out of order in one batch: certification listed first; soft-transition handles it.
    const res = await request(app)
      .post("/v1/sync/batch")
      .set(auth(shikshak.token))
      .send({
        ops: [
          {
            submission_op_id: certOp,
            op_type: "course_certification",
            payload: {
              node_kind: "section",
              node_id: sectionId,
              student_id: studentId,
              client_op_id: ulid(),
              certified_at: new Date().toISOString(),
            },
            client_timestamp: new Date().toISOString(),
          },
          {
            submission_op_id: progOp,
            op_type: "course_progress",
            payload: {
              node_kind: "section",
              node_id: sectionId,
              marks: [
                {
                  student_id: studentId,
                  status: "completed",
                  client_op_id: ulid(),
                },
              ],
              marked_at: new Date().toISOString(),
            },
            client_timestamp: new Date().toISOString(),
          },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.results[0].status).toBe("success");
    // Progress after certify hits certified freeze → conflict or skipped; final state from certify.
    const row = await pool.query<{ status: string; certified_at: Date | null }>(
      `select status, certified_at from student_course_progress
        where student_id = $1 and section_id = $2 and subsection_id is null`,
      [studentId, sectionId],
    );
    expect(row.rows[0]?.status).toBe("completed");
    expect(row.rows[0]?.certified_at).toBeTruthy();
  });

  it("4 — batch replay returns stored payloads; no second Punya; balance unchanged", async () => {
    const superAdmin = await loginAs("super_admin");
    const shikshak = await loginAs("shikshak");
    const cityId = await mumbaiCityId(superAdmin.token);
    const { sectionId } = await publishableCourse(superAdmin.token, cityId);
    const studentId = await shikshakStudent();

    const beforeBal = await balanceOf(studentId);
    const beforeTx = await punyaTxCount(studentId);
    const opId = ulid();
    const body = {
      ops: [
        {
          submission_op_id: opId,
          op_type: "course_certification" as const,
          payload: {
            node_kind: "section",
            node_id: sectionId,
            student_id: studentId,
            client_op_id: ulid(),
            certified_at: new Date().toISOString(),
          },
          client_timestamp: new Date().toISOString(),
        },
      ],
    };

    const first = await request(app)
      .post("/v1/sync/batch")
      .set(auth(shikshak.token))
      .send(body);
    expect(first.status).toBe(200);
    expect(first.body.data.results[0].status).toBe("success");
    const midBal = await balanceOf(studentId);
    const midTx = await punyaTxCount(studentId);
    expect(midBal).toBeGreaterThanOrEqual(beforeBal);
    expect(midTx).toBeGreaterThanOrEqual(beforeTx);

    const second = await request(app)
      .post("/v1/sync/batch")
      .set(auth(shikshak.token))
      .send(body);
    expect(second.status).toBe(200);
    expect(second.body.data.results[0].status).toBe("success");
    expect(second.body.data.results[0].server_id).toBe(first.body.data.results[0].server_id);

    expect(await balanceOf(studentId)).toBe(midBal);
    expect(await punyaTxCount(studentId)).toBe(midTx);

    const syncRows = await pool.query<{ n: string }>(
      `select count(*)::text as n from sync_operations where submission_op_id = $1`,
      [opId],
    );
    expect(syncRows.rows[0]!.n).toBe("1");
  });

  it("5 — stale progress marked_at → duplicate; already-certified → duplicate", async () => {
    const superAdmin = await loginAs("super_admin");
    const shikshak = await loginAs("shikshak");
    const cityId = await mumbaiCityId(superAdmin.token);
    const { sectionId } = await publishableCourse(superAdmin.token, cityId);
    const studentId = await shikshakStudent();

    const newer = new Date("2026-08-07T12:00:00.000Z");
    const older = new Date("2026-08-07T10:00:00.000Z");

    const firstProg = await request(app)
      .post("/v1/sync/batch")
      .set(auth(shikshak.token))
      .send({
        ops: [
          {
            submission_op_id: ulid(),
            op_type: "course_progress",
            payload: {
              node_kind: "section",
              node_id: sectionId,
              marks: [
                {
                  student_id: studentId,
                  status: "completed",
                  client_op_id: ulid(),
                },
              ],
              marked_at: newer.toISOString(),
            },
            client_timestamp: newer.toISOString(),
          },
        ],
      });
    expect(firstProg.body.data.results[0].status).toBe("success");

    const stale = await request(app)
      .post("/v1/sync/batch")
      .set(auth(shikshak.token))
      .send({
        ops: [
          {
            submission_op_id: ulid(),
            op_type: "course_progress",
            payload: {
              node_kind: "section",
              node_id: sectionId,
              marks: [
                {
                  student_id: studentId,
                  status: "in_progress",
                  client_op_id: ulid(),
                },
              ],
              marked_at: older.toISOString(),
            },
            client_timestamp: older.toISOString(),
          },
        ],
      });
    expect(stale.body.data.results[0].status).toBe("duplicate");

    const status = await pool.query<{ status: string }>(
      `select status from student_course_progress
        where student_id = $1 and section_id = $2 and subsection_id is null`,
      [studentId, sectionId],
    );
    expect(status.rows[0]?.status).toBe("completed");

    const cert1 = await request(app)
      .post("/v1/sync/batch")
      .set(auth(shikshak.token))
      .send({
        ops: [
          {
            submission_op_id: ulid(),
            op_type: "course_certification",
            payload: {
              node_kind: "section",
              node_id: sectionId,
              student_id: studentId,
              client_op_id: ulid(),
              certified_at: new Date().toISOString(),
            },
            client_timestamp: new Date().toISOString(),
          },
        ],
      });
    expect(cert1.body.data.results[0].status).toBe("success");

    const cert2 = await request(app)
      .post("/v1/sync/batch")
      .set(auth(shikshak.token))
      .send({
        ops: [
          {
            submission_op_id: ulid(),
            op_type: "course_certification",
            payload: {
              node_kind: "section",
              node_id: sectionId,
              student_id: studentId,
              client_op_id: ulid(),
              certified_at: new Date().toISOString(),
            },
            client_timestamp: new Date().toISOString(),
          },
        ],
      });
    expect(cert2.body.data.results[0].status).toBe("duplicate");
  });

  it("6 — C3: an online write omitting client_marked_at doesn't erase the stored clock, so a later older offline replay stays a no-op", async () => {
    const superAdmin = await loginAs("super_admin");
    const shikshak = await loginAs("shikshak");
    const cityId = await mumbaiCityId(superAdmin.token);
    const { sectionId } = await publishableCourse(superAdmin.token, cityId);
    const studentId = await shikshakStudent();

    const t1 = new Date("2026-08-21T10:00:00.000Z");
    const olderThanT1 = new Date("2026-08-21T08:00:00.000Z");

    // 1) Offline: in_progress at 10:00 — establishes a real client_marked_at.
    const offlineFirst = await request(app)
      .post("/v1/sync/batch")
      .set(auth(shikshak.token))
      .send({
        ops: [
          {
            submission_op_id: ulid(),
            op_type: "course_progress",
            payload: {
              node_kind: "section",
              node_id: sectionId,
              marks: [{ student_id: studentId, status: "in_progress", client_op_id: ulid() }],
              marked_at: t1.toISOString(),
            },
            client_timestamp: t1.toISOString(),
          },
        ],
      });
    expect(offlineFirst.body.data.results[0].status).toBe("success");

    // 2) Online: completed, with NO client_marked_at in the body — CU31/C3
    //    requires the stored clock to survive this, not be nulled out by a
    //    write that simply doesn't carry one.
    const online = await request(app)
      .post(`/v1/courses/nodes/${sectionId}/progress`)
      .set(auth(shikshak.token))
      .send({ student_id: studentId, status: "completed" });
    expect(online.status).toBe(200);

    const midRow = await pool.query<{ status: string; client_marked_at: Date | null }>(
      `select status, client_marked_at from student_course_progress
        where student_id = $1 and section_id = $2 and subsection_id is null`,
      [studentId, sectionId],
    );
    expect(midRow.rows[0]?.status).toBe("completed");
    // C3 — the online write must not have nulled the clock the offline write set.
    expect(midRow.rows[0]?.client_marked_at).toBeTruthy();

    // 3) Offline replay, OLDER than the clock still on the row — must be a no-op.
    const staleReplay = await request(app)
      .post("/v1/sync/batch")
      .set(auth(shikshak.token))
      .send({
        ops: [
          {
            submission_op_id: ulid(),
            op_type: "course_progress",
            payload: {
              node_kind: "section",
              node_id: sectionId,
              marks: [{ student_id: studentId, status: "in_progress", client_op_id: ulid() }],
              marked_at: olderThanT1.toISOString(),
            },
            client_timestamp: olderThanT1.toISOString(),
          },
        ],
      });
    expect(staleReplay.body.data.results[0].status).toBe("duplicate");

    const finalRow = await pool.query<{ status: string }>(
      `select status from student_course_progress
        where student_id = $1 and section_id = $2 and subsection_id is null`,
      [studentId, sectionId],
    );
    expect(finalRow.rows[0]?.status).toBe("completed");
  });
});
