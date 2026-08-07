/**
 * Step 3 — course routes, certification, Punya (CU3–CU23 exit criteria).
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import app from "../src/app";
import { loginAs, auth } from "./helpers";

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
  expect(centres.status).toBe(200);
  const item = (centres.body.data.items as Array<{ city_id: string }>)[0];
  expect(item?.city_id).toBeTruthy();
  return item!.city_id;
}

async function cityAdminCity(superToken: string, cityAdminToken: string): Promise<string> {
  const cities = await request(app).get("/v1/admin/geography").set(auth(superToken));
  const list =
    cities.status === 200
      ? (cities.body.data.cities as Array<{ id: string }>)
      : [];
  for (const city of list) {
    const probe = await request(app)
      .post("/v1/admin/courses")
      .set(auth(superToken))
      .send({ name_en: `probe ${stamp()}`, kind: "standard", city_id: city.id });
    if (probe.status !== 200) continue;
    const visible = await request(app)
      .get("/v1/admin/courses")
      .set(auth(cityAdminToken));
    if (
      visible.status === 200 &&
      (visible.body.data.items as Array<{ id: string }>).some((c) => c.id === probe.body.data.id)
    ) {
      return city.id;
    }
  }
  // Fallback: city_admin's users.city_id
  const row = await pool.query<{ city_id: string }>(
    `select city_id from users where role = 'city_admin' and city_id is not null limit 1`,
  );
  expect(row.rows[0]?.city_id).toBeTruthy();
  return row.rows[0]!.city_id;
}

async function publishableCourse(
  adminToken: string,
  cityId: string,
  opts?: { sections?: number; punya?: number },
): Promise<{ courseId: string; sectionIds: string[] }> {
  const create = await request(app)
    .post("/v1/admin/courses")
    .set(auth(adminToken))
    .send({
      name_en: `Course ${stamp()}`,
      name_hi: "पाठ्यक्रम परीक्षण",
      kind: "standard",
      academic_year: "2025-26",
      city_id: cityId,
      punya_points: 20,
    });
  expect(create.status).toBe(200);
  const courseId = create.body.data.id as string;
  const sectionIds: string[] = [];
  const n = opts?.sections ?? 1;
  for (let i = 0; i < n; i++) {
    const sec = await request(app)
      .post(`/v1/courses/${courseId}/sections`)
      .set(auth(adminToken))
      .send({
        title_en: `Sec ${i}`,
        title_hi: `अनुभाग ${i}`,
        punya_points: opts?.punya ?? 50,
      });
    expect(sec.status).toBe(200);
    sectionIds.push(sec.body.data.id);
  }
  return { courseId, sectionIds };
}

async function ownedStudentForParent(): Promise<{
  studentId: string;
  batchId: string;
  centreId: string;
  parentUserId: string;
}> {
  const row = await pool.query<{
    id: string;
    batch_id: string;
    centre_id: string;
    parent_id: string;
  }>(
    `select id, batch_id, centre_id, parent_id
       from students
      where status = 'active' and deleted_at is null
        and parent_id is not null and batch_id is not null
      order by created_at
      limit 1`,
  );
  expect(row.rows[0]).toBeTruthy();
  return {
    studentId: row.rows[0]!.id,
    batchId: row.rows[0]!.batch_id,
    centreId: row.rows[0]!.centre_id,
    parentUserId: row.rows[0]!.parent_id,
  };
}

async function balanceOf(studentId: string): Promise<number> {
  const r = await pool.query<{ total_points: number }>(
    `select coalesce(total_points, 0)::int as total_points from punya_balances where student_id = $1`,
    [studentId],
  );
  return r.rows[0]?.total_points ?? 0;
}

async function txCount(studentId: string, featureKey: string): Promise<number> {
  const r = await pool.query<{ n: string }>(
    `select count(*)::text as n from punya_transactions
      where student_id = $1 and feature_key = $2 and points > 0`,
    [studentId, featureKey],
  );
  return Number(r.rows[0]!.n);
}

describe("courses step 3 — authoring & visibility", () => {
  it("city_admin blocked from MSV create (403)", async () => {
    const cityAdmin = await loginAs("city_admin");
    const superAdmin = await loginAs("super_admin");
    const cityId = await cityAdminCity(superAdmin.token, cityAdmin.token);

    const res = await request(app)
      .post("/v1/admin/courses")
      .set(auth(cityAdmin.token))
      .send({
        name_en: `MSV blocked ${stamp()}`,
        kind: "msv",
        city_id: cityId,
      });
    expect(res.status).toBe(403);

    // Legacy path too.
    const legacy = await request(app)
      .post("/v1/admin/curricula")
      .set(auth(cityAdmin.token))
      .send({ name: `MSV blocked legacy ${stamp()}`, kind: "msv", city_id: cityId });
    expect(legacy.status).toBe(403);
  });

  it("draft course invisible to parent", async () => {
    const superAdmin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const cityId = await mumbaiCityId(superAdmin.token);
    const { courseId } = await publishableCourse(superAdmin.token, cityId);

    // Still draft — parent catalogue must not include it.
    const list = await request(app).get("/v1/courses").set(auth(parent.token));
    expect(list.status).toBe(200);
    const ids = (list.body.data.items as Array<{ id: string }>).map((c) => c.id);
    expect(ids).not.toContain(courseId);

    const kid = await pool.query<{ id: string }>(
      `select s.id from students s
        join users u on u.id = s.parent_id
       where u.phone = '+919800000006' and s.status = 'active' and s.deleted_at is null
       limit 1`,
    );
    expect(kid.rows[0]?.id).toBeTruthy();
    const tree = await request(app)
      .get(`/v1/courses/${courseId}/tree`)
      .query({ student_id: kid.rows[0]!.id })
      .set(auth(parent.token));
    // Draft fails CU3 visibility — not found (do not leak existence).
    expect(tree.status).toBe(404);
  });

  it("publish rejected without name_hi / academic_year / punya_points", async () => {
    const superAdmin = await loginAs("super_admin");
    const cityId = await mumbaiCityId(superAdmin.token);

    const bare = await request(app)
      .post("/v1/admin/courses")
      .set(auth(superAdmin.token))
      .send({ name_en: `Bare ${stamp()}`, kind: "standard", city_id: cityId });
    expect(bare.status).toBe(200);
    const courseId = bare.body.data.id as string;

    const noSections = await request(app)
      .post(`/v1/admin/courses/${courseId}/publish`)
      .set(auth(superAdmin.token));
    expect(noSections.status).toBe(422);
    expect(noSections.body.error.code).toBe("ERR_COURSE_NOT_PUBLISHABLE");

    // Add section with punya_points=0 (default) — still not publishable.
    await pool.query(
      `update courses set name_hi = $2, academic_year = '2025-26' where id = $1`,
      [courseId, "हिंदी नाम"],
    );
    const sec = await request(app)
      .post(`/v1/courses/${courseId}/sections`)
      .set(auth(superAdmin.token))
      .send({ title_en: "S", title_hi: "स", punya_points: 0 });
    expect(sec.status).toBe(200);

    const still = await request(app)
      .post(`/v1/admin/courses/${courseId}/publish`)
      .set(auth(superAdmin.token));
    expect(still.status).toBe(422);
    expect(still.body.error.code).toBe("ERR_COURSE_NOT_PUBLISHABLE");
  });
});

describe("courses step 3 — progress scope & bulk", () => {
  it("parent write for another parent's child (403)", async () => {
    const superAdmin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const cityId = await mumbaiCityId(superAdmin.token);
    const { courseId, sectionIds } = await publishableCourse(superAdmin.token, cityId);
    await request(app)
      .post(`/v1/admin/courses/${courseId}/publish`)
      .set(auth(superAdmin.token))
      .expect(200);

    // Pick a student NOT owned by the seeded parent.
    const other = await pool.query<{ id: string }>(
      `select s.id from students s
        join users u on u.id = s.parent_id
       where s.status = 'active' and s.deleted_at is null
         and u.phone <> '+919800000006'
       limit 1`,
    );
    expect(other.rows[0]?.id).toBeTruthy();

    const res = await request(app)
      .post(`/v1/courses/nodes/${sectionIds[0]}/progress`)
      .set(auth(parent.token))
      .send({ student_id: other.rows[0]!.id, status: "in_progress" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ERR_COURSE_STUDENT_OUT_OF_SCOPE");
  });

  it("parent write to a certified row (409)", async () => {
    const superAdmin = await loginAs("super_admin");
    const shikshak = await loginAs("shikshak");
    const parent = await loginAs("parent");
    const cityId = await mumbaiCityId(superAdmin.token);
    const { courseId, sectionIds } = await publishableCourse(superAdmin.token, cityId);
    await request(app)
      .post(`/v1/admin/courses/${courseId}/publish`)
      .set(auth(superAdmin.token))
      .expect(200);

    // Resolve a student in shikshak's batch who is the seeded parent's child if possible.
    const kid = await pool.query<{ id: string; batch_id: string }>(
      `select s.id, s.batch_id from students s
        join users u on u.id = s.parent_id
       where u.phone = '+919800000006'
         and s.status = 'active' and s.deleted_at is null and s.batch_id is not null
       limit 1`,
    );
    expect(kid.rows[0]?.id).toBeTruthy();
    const studentId = kid.rows[0]!.id;

    // Ensure shikshak is assigned to that batch (seed usually is).
    await pool.query(
      `insert into shikshak_batch_assignments (user_id, batch_id, is_active)
       select u.id, $1, true from users u where u.phone = '+919800000005'
       on conflict do nothing`,
      [kid.rows[0]!.batch_id],
    );

    await request(app)
      .post(`/v1/courses/nodes/${sectionIds[0]}/progress`)
      .set(auth(parent.token))
      .send({ student_id: studentId, status: "completed" })
      .expect(200);

    const certify = await request(app)
      .post(`/v1/courses/nodes/${sectionIds[0]}/certify`)
      .set(auth(shikshak.token))
      .send({ student_id: studentId });
    expect(certify.status).toBe(200);

    const blocked = await request(app)
      .post(`/v1/courses/nodes/${sectionIds[0]}/progress`)
      .set(auth(parent.token))
      .send({ student_id: studentId, status: "in_progress" });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("ERR_COURSE_NODE_CERTIFIED");
  });

  it("shikshak bulk with an out-of-scope student_id (403, nothing applied)", async () => {
    const superAdmin = await loginAs("super_admin");
    const shikshak = await loginAs("shikshak");
    const cityId = await mumbaiCityId(superAdmin.token);
    const { courseId, sectionIds } = await publishableCourse(superAdmin.token, cityId);
    await request(app)
      .post(`/v1/admin/courses/${courseId}/publish`)
      .set(auth(superAdmin.token))
      .expect(200);

    const inScope = await pool.query<{ id: string }>(
      `select s.id from students s
        join shikshak_batch_assignments a on a.batch_id = s.batch_id and a.is_active = true
        join users u on u.id = a.user_id
       where u.phone = '+919800000005' and s.status = 'active' and s.deleted_at is null
       limit 1`,
    );
    const outOfScope = await pool.query<{ id: string }>(
      `select s.id from students s
       where s.status = 'active' and s.deleted_at is null
         and s.id <> $1
         and s.batch_id is not null
         and not exists (
           select 1 from shikshak_batch_assignments a
            join users u on u.id = a.user_id
           where a.batch_id = s.batch_id and a.is_active = true
             and u.phone = '+919800000005'
         )
       limit 1`,
      [inScope.rows[0]?.id ?? "00000000-0000-0000-0000-000000000000"],
    );
    expect(inScope.rows[0]?.id).toBeTruthy();
    expect(outOfScope.rows[0]?.id).toBeTruthy();

    const before = await pool.query<{ n: string }>(
      `select count(*)::text as n from student_course_progress
        where subsection_id is null and section_id = $1
          and student_id = any($2::uuid[])`,
      [sectionIds[0], [inScope.rows[0]!.id, outOfScope.rows[0]!.id]],
    );

    const res = await request(app)
      .post(`/v1/courses/nodes/${sectionIds[0]}/progress/bulk`)
      .set(auth(shikshak.token))
      .send({
        student_ids: [inScope.rows[0]!.id, outOfScope.rows[0]!.id],
        status: "in_progress",
      });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ERR_COURSE_STUDENT_OUT_OF_SCOPE");

    const after = await pool.query<{ n: string }>(
      `select count(*)::text as n from student_course_progress
        where subsection_id is null and section_id = $1
          and student_id = any($2::uuid[])`,
      [sectionIds[0], [inScope.rows[0]!.id, outOfScope.rows[0]!.id]],
    );
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  });

  it("bulk regression ignored", async () => {
    const superAdmin = await loginAs("super_admin");
    const shikshak = await loginAs("shikshak");
    const cityId = await mumbaiCityId(superAdmin.token);
    const { courseId, sectionIds } = await publishableCourse(superAdmin.token, cityId);
    await request(app)
      .post(`/v1/admin/courses/${courseId}/publish`)
      .set(auth(superAdmin.token))
      .expect(200);

    const kid = await pool.query<{ id: string; batch_id: string }>(
      `select s.id, s.batch_id from students s
        join shikshak_batch_assignments a on a.batch_id = s.batch_id and a.is_active = true
        join users u on u.id = a.user_id
       where u.phone = '+919800000005' and s.status = 'active' and s.deleted_at is null
       limit 1`,
    );
    expect(kid.rows[0]?.id).toBeTruthy();

    await request(app)
      .post(`/v1/courses/nodes/${sectionIds[0]}/progress`)
      .set(auth(shikshak.token))
      .send({ student_id: kid.rows[0]!.id, status: "completed" })
      .expect(200);

    const bulk = await request(app)
      .post(`/v1/courses/nodes/${sectionIds[0]}/progress/bulk`)
      .set(auth(shikshak.token))
      .send({ student_ids: [kid.rows[0]!.id], status: "in_progress" });
    expect(bulk.status).toBe(200);
    expect(bulk.body.data.applied).toBe(0);
    expect(bulk.body.data.skipped).toBe(1);

    const row = await pool.query<{ status: string }>(
      `select status from student_course_progress
        where student_id = $1 and section_id = $2 and subsection_id is null`,
      [kid.rows[0]!.id, sectionIds[0]],
    );
    expect(row.rows[0]?.status).toBe("completed");
  });

  it("certify on a non-completed node (409)", async () => {
    const superAdmin = await loginAs("super_admin");
    const shikshak = await loginAs("shikshak");
    const cityId = await mumbaiCityId(superAdmin.token);
    const { courseId, sectionIds } = await publishableCourse(superAdmin.token, cityId);
    await request(app)
      .post(`/v1/admin/courses/${courseId}/publish`)
      .set(auth(superAdmin.token))
      .expect(200);

    const kid = await pool.query<{ id: string }>(
      `select s.id from students s
        join shikshak_batch_assignments a on a.batch_id = s.batch_id and a.is_active = true
        join users u on u.id = a.user_id
       where u.phone = '+919800000005' and s.status = 'active' and s.deleted_at is null
       limit 1`,
    );
    const res = await request(app)
      .post(`/v1/courses/nodes/${sectionIds[0]}/certify`)
      .set(auth(shikshak.token))
      .send({ student_id: kid.rows[0]!.id });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ERR_COURSE_NODE_NOT_COMPLETE");
  });

  it("delete of a certified node (409)", async () => {
    const superAdmin = await loginAs("super_admin");
    const shikshak = await loginAs("shikshak");
    const cityId = await mumbaiCityId(superAdmin.token);
    const { courseId, sectionIds } = await publishableCourse(superAdmin.token, cityId);
    await request(app)
      .post(`/v1/admin/courses/${courseId}/publish`)
      .set(auth(superAdmin.token))
      .expect(200);

    const kid = await pool.query<{ id: string }>(
      `select s.id from students s
        join shikshak_batch_assignments a on a.batch_id = s.batch_id and a.is_active = true
        join users u on u.id = a.user_id
       where u.phone = '+919800000005' and s.status = 'active' and s.deleted_at is null
       limit 1`,
    );
    await request(app)
      .post(`/v1/courses/nodes/${sectionIds[0]}/progress`)
      .set(auth(shikshak.token))
      .send({ student_id: kid.rows[0]!.id, status: "completed" })
      .expect(200);
    await request(app)
      .post(`/v1/courses/nodes/${sectionIds[0]}/certify`)
      .set(auth(shikshak.token))
      .send({ student_id: kid.rows[0]!.id })
      .expect(200);

    const del = await request(app)
      .delete(`/v1/courses/sections/${sectionIds[0]}`)
      .set(auth(superAdmin.token));
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe("ERR_COURSE_NODE_HAS_CERTIFICATIONS");
  });
});

describe("courses step 3 — Punya awards", () => {
  it("certify → one transaction and balance delta; replay awards nothing", async () => {
    const superAdmin = await loginAs("super_admin");
    const shikshak = await loginAs("shikshak");
    const cityId = await mumbaiCityId(superAdmin.token);
    const { courseId, sectionIds } = await publishableCourse(superAdmin.token, cityId, {
      punya: 40,
    });
    await request(app)
      .post(`/v1/admin/courses/${courseId}/publish`)
      .set(auth(superAdmin.token))
      .expect(200);

    const kid = await pool.query<{ id: string }>(
      `select s.id from students s
        join shikshak_batch_assignments a on a.batch_id = s.batch_id and a.is_active = true
        join users u on u.id = a.user_id
       where u.phone = '+919800000005' and s.status = 'active' and s.deleted_at is null
       limit 1`,
    );
    const studentId = kid.rows[0]!.id;
    const beforeBal = await balanceOf(studentId);
    const beforeTx = await txCount(studentId, "course_section_certified");

    await request(app)
      .post(`/v1/courses/nodes/${sectionIds[0]}/progress`)
      .set(auth(shikshak.token))
      .send({ student_id: studentId, status: "completed" })
      .expect(200);

    const certify = await request(app)
      .post(`/v1/courses/nodes/${sectionIds[0]}/certify`)
      .set(auth(shikshak.token))
      .send({ student_id: studentId });
    expect(certify.status).toBe(200);
    const sectionAwarded = certify.body.data.section_points_awarded as number;
    const courseAwarded = certify.body.data.course_points_awarded as number;
    expect(sectionAwarded).toBeGreaterThan(0);
    // Single-section course also completes → course bonus may fire in the same call.
    const totalAwarded = sectionAwarded + courseAwarded;

    const midBal = await balanceOf(studentId);
    expect(midBal - beforeBal).toBe(totalAwarded);
    expect(await txCount(studentId, "course_section_certified")).toBe(beforeTx + 1);

    const replay = await request(app)
      .post(`/v1/courses/nodes/${sectionIds[0]}/certify`)
      .set(auth(shikshak.token))
      .send({ student_id: studentId });
    expect(replay.status).toBe(200);
    expect(replay.body.data.section_points_awarded).toBe(0);
    expect(replay.body.data.course_points_awarded).toBe(0);
    expect(await balanceOf(studentId)).toBe(midBal);
    expect(await txCount(studentId, "course_section_certified")).toBe(beforeTx + 1);
  });

  it("certify final section → section award AND course bonus with trigger section in key", async () => {
    const superAdmin = await loginAs("super_admin");
    const shikshak = await loginAs("shikshak");
    const cityId = await mumbaiCityId(superAdmin.token);
    const { courseId, sectionIds } = await publishableCourse(superAdmin.token, cityId, {
      sections: 2,
      punya: 30,
    });
    // Set a non-zero course bonus.
    await pool.query(`update courses set punya_points = 20 where id = $1`, [courseId]);
    await request(app)
      .post(`/v1/admin/courses/${courseId}/publish`)
      .set(auth(superAdmin.token))
      .expect(200);

    const kid = await pool.query<{ id: string }>(
      `select s.id from students s
        join shikshak_batch_assignments a on a.batch_id = s.batch_id and a.is_active = true
        join users u on u.id = a.user_id
       where u.phone = '+919800000005' and s.status = 'active' and s.deleted_at is null
       limit 1`,
    );
    const studentId = kid.rows[0]!.id;

    for (const sid of sectionIds) {
      await request(app)
        .post(`/v1/courses/nodes/${sid}/progress`)
        .set(auth(shikshak.token))
        .send({ student_id: studentId, status: "completed" })
        .expect(200);
    }

    await request(app)
      .post(`/v1/courses/nodes/${sectionIds[0]}/certify`)
      .set(auth(shikshak.token))
      .send({ student_id: studentId })
      .expect(200);

    const final = await request(app)
      .post(`/v1/courses/nodes/${sectionIds[1]}/certify`)
      .set(auth(shikshak.token))
      .send({ student_id: studentId });
    expect(final.status).toBe(200);
    expect(final.body.data.section_points_awarded).toBeGreaterThan(0);
    expect(final.body.data.course_points_awarded).toBeGreaterThan(0);
    const key = final.body.data.course_award_key as string;
    expect(key).toContain(sectionIds[1]!);
    expect(key.startsWith(`course_completed:${courseId}:${studentId}:${sectionIds[1]}:`)).toBe(
      true,
    );
  });

  it("super_admin correction reverses awards; re-certify lands a NEW award (AT17)", async () => {
    const superAdmin = await loginAs("super_admin");
    const shikshak = await loginAs("shikshak");
    const cityId = await mumbaiCityId(superAdmin.token);
    const { courseId, sectionIds } = await publishableCourse(superAdmin.token, cityId, {
      sections: 1,
      punya: 50,
    });
    await pool.query(`update courses set punya_points = 25 where id = $1`, [courseId]);
    await request(app)
      .post(`/v1/admin/courses/${courseId}/publish`)
      .set(auth(superAdmin.token))
      .expect(200);

    const kid = await pool.query<{ id: string }>(
      `select s.id from students s
        join shikshak_batch_assignments a on a.batch_id = s.batch_id and a.is_active = true
        join users u on u.id = a.user_id
       where u.phone = '+919800000005' and s.status = 'active' and s.deleted_at is null
       limit 1`,
    );
    const studentId = kid.rows[0]!.id;
    const sectionId = sectionIds[0]!;

    await request(app)
      .post(`/v1/courses/nodes/${sectionId}/progress`)
      .set(auth(shikshak.token))
      .send({ student_id: studentId, status: "completed" })
      .expect(200);

    const first = await request(app)
      .post(`/v1/courses/nodes/${sectionId}/certify`)
      .set(auth(shikshak.token))
      .send({ student_id: studentId });
    expect(first.status).toBe(200);
    expect(first.body.data.section_points_awarded).toBeGreaterThan(0);
    expect(first.body.data.course_points_awarded).toBeGreaterThan(0);

    const balAfterAward = await balanceOf(studentId);
    const sectionTxBefore = await txCount(studentId, "course_section_certified");
    const courseTxBefore = await txCount(studentId, "course_completed");

    const correction = await request(app)
      .post(`/v1/courses/nodes/${sectionId}/certify/correct`)
      .set(auth(superAdmin.token))
      .send({ student_id: studentId, status: "completed" });
    expect(correction.status).toBe(200);
    expect(correction.body.data.revision).toBeGreaterThanOrEqual(1);
    expect(correction.body.data.section_points_reversed).toBeGreaterThan(0);
    expect(correction.body.data.course_points_reversed).toBeGreaterThan(0);

    const balAfterReverse = await balanceOf(studentId);
    expect(balAfterReverse).toBeLessThan(balAfterAward);

    // Re-complete is already completed; re-certify must mint NEW awards (new revision in key).
    const again = await request(app)
      .post(`/v1/courses/nodes/${sectionId}/certify`)
      .set(auth(shikshak.token))
      .send({ student_id: studentId });
    expect(again.status).toBe(200);
    expect(again.body.data.section_points_awarded).toBeGreaterThan(0);
    expect(again.body.data.course_points_awarded).toBeGreaterThan(0);
    expect(await txCount(studentId, "course_section_certified")).toBe(sectionTxBefore + 1);
    expect(await txCount(studentId, "course_completed")).toBe(courseTxBefore + 1);
  });
});

describe("courses step 6 — admin panel exit criteria", () => {
  it("publish gate lists each missing precondition in turn", async () => {
    const superAdmin = await loginAs("super_admin");
    const cityId = await mumbaiCityId(superAdmin.token);

    const bare = await request(app)
      .post("/v1/admin/courses")
      .set(auth(superAdmin.token))
      .send({ name_en: `Gate ${stamp()}`, kind: "standard", city_id: cityId });
    expect(bare.status).toBe(200);
    const courseId = bare.body.data.id as string;

    const r1 = await request(app)
      .post(`/v1/admin/courses/${courseId}/publish`)
      .set(auth(superAdmin.token));
    expect(r1.status).toBe(422);
    expect(r1.body.error.code).toBe("ERR_COURSE_NOT_PUBLISHABLE");
    const reasons1 = r1.body.error.details?.reasons as string[];
    expect(reasons1).toEqual(
      expect.arrayContaining([
        "name_hi is required",
        "academic_year is required",
        "at least one section is required",
      ]),
    );
    expect(r1.body.error.message).toMatch(/Devanagari|Hindi/i);
    expect(r1.body.error.message).toMatch(/academic year/i);
    expect(r1.body.error.message).toMatch(/section/i);

    await request(app)
      .patch(`/v1/admin/courses/${courseId}`)
      .set(auth(superAdmin.token))
      .send({ name_hi: "द्वार परीक्षा", academic_year: "2025-26" })
      .expect(200);

    const r2 = await request(app)
      .post(`/v1/admin/courses/${courseId}/publish`)
      .set(auth(superAdmin.token));
    expect(r2.status).toBe(422);
    expect(r2.body.error.details?.reasons).toEqual(
      expect.arrayContaining(["at least one section is required"]),
    );
    expect(r2.body.error.details?.reasons).not.toEqual(
      expect.arrayContaining(["name_hi is required"]),
    );

    await request(app)
      .post(`/v1/courses/${courseId}/sections`)
      .set(auth(superAdmin.token))
      .send({ title_en: "S", title_hi: "स", punya_points: 0 })
      .expect(200);

    const r3 = await request(app)
      .post(`/v1/admin/courses/${courseId}/publish`)
      .set(auth(superAdmin.token));
    expect(r3.status).toBe(422);
    expect(r3.body.error.details?.reasons).toEqual(
      expect.arrayContaining(["every section must have punya_points set (> 0)"]),
    );
    expect(r3.body.error.message).toMatch(/Punya points/i);

    const tree = await request(app)
      .get(`/v1/admin/courses/${courseId}/tree`)
      .set(auth(superAdmin.token));
    const sectionId = tree.body.data.sections[0].id as string;
    await request(app)
      .patch(`/v1/courses/sections/${sectionId}`)
      .set(auth(superAdmin.token))
      .send({ punya_points: 40 })
      .expect(200);

    const okPublish = await request(app)
      .post(`/v1/admin/courses/${courseId}/publish`)
      .set(auth(superAdmin.token));
    expect(okPublish.status).toBe(200);
    expect(okPublish.body.data.status).toBe("active");
  });

  it("derive from template then edit template — derived course unchanged (CU7)", async () => {
    const superAdmin = await loginAs("super_admin");
    const cityId = await mumbaiCityId(superAdmin.token);

    const tpl = await request(app)
      .post("/v1/admin/course-templates")
      .set(auth(superAdmin.token))
      .send({ name_en: `Tpl ${stamp()}`, name_hi: "टेम्पलेट", kind: "standard" });
    expect(tpl.status).toBe(200);
    const templateId = tpl.body.data.id as string;

    const sec = await request(app)
      .post(`/v1/admin/course-templates/${templateId}/sections`)
      .set(auth(superAdmin.token))
      .send({ title_en: "Original section", title_hi: "मूल अनुभाग", punya_points: 30 });
    expect(sec.status).toBe(200);
    const tplSectionId = sec.body.data.id as string;

    await request(app)
      .post(`/v1/admin/course-template-sections/${tplSectionId}/subsections`)
      .set(auth(superAdmin.token))
      .send({ title_en: "Original sub", title_hi: "मूल उप" })
      .expect(200);

    const derived = await request(app)
      .post(`/v1/admin/course-templates/${templateId}/derive`)
      .set(auth(superAdmin.token))
      .send({ city_id: cityId, academic_year: "2025-26" });
    expect(derived.status).toBe(200);
    const courseId = derived.body.data.id as string;

    const before = await request(app)
      .get(`/v1/admin/courses/${courseId}/tree`)
      .set(auth(superAdmin.token));
    expect(before.status).toBe(200);
    expect(before.body.data.sections).toHaveLength(1);
    expect(before.body.data.sections[0].title_en).toBe("Original section");
    expect(before.body.data.sections[0].subsections).toHaveLength(1);
    expect(before.body.data.sections[0].subsections[0].title_en).toBe("Original sub");

    await request(app)
      .patch(`/v1/admin/course-template-sections/${tplSectionId}`)
      .set(auth(superAdmin.token))
      .send({ title_en: "Edited template section", title_hi: "संपादित", punya_points: 99 })
      .expect(200);
    await request(app)
      .post(`/v1/admin/course-template-sections/${tplSectionId}/subsections`)
      .set(auth(superAdmin.token))
      .send({ title_en: "New template sub", title_hi: "नया" })
      .expect(200);

    const after = await request(app)
      .get(`/v1/admin/courses/${courseId}/tree`)
      .set(auth(superAdmin.token));
    expect(after.body.data.sections).toHaveLength(1);
    expect(after.body.data.sections[0].title_en).toBe("Original section");
    expect(after.body.data.sections[0].punya_points).toBe(30);
    expect(after.body.data.sections[0].subsections).toHaveLength(1);
    expect(after.body.data.sections[0].subsections[0].title_en).toBe("Original sub");
  });

  it("archive-impact counts in-progress uncertified students (CU4)", async () => {
    const superAdmin = await loginAs("super_admin");
    const shikshak = await loginAs("shikshak");
    const cityId = await mumbaiCityId(superAdmin.token);
    const { courseId, sectionIds } = await publishableCourse(superAdmin.token, cityId);
    await request(app)
      .post(`/v1/admin/courses/${courseId}/publish`)
      .set(auth(superAdmin.token))
      .expect(200);

    const inScope = await pool.query<{ id: string }>(
      `select s.id from students s
        join shikshak_batch_assignments a on a.batch_id = s.batch_id and a.is_active = true
        join users u on u.id = a.user_id
       where u.phone = '+919800000005' and s.status = 'active' and s.deleted_at is null
       limit 1`,
    );
    expect(inScope.rows[0]?.id).toBeTruthy();
    const studentId = inScope.rows[0]!.id;
    await request(app)
      .post(`/v1/courses/nodes/${sectionIds[0]!}/progress`)
      .set(auth(shikshak.token))
      .send({ student_id: studentId, status: "in_progress" })
      .expect(200);

    const impact = await request(app)
      .get(`/v1/admin/courses/${courseId}/archive-impact`)
      .set(auth(superAdmin.token));
    expect(impact.status).toBe(200);
    expect(impact.body.data.in_progress_uncertified_students).toBeGreaterThanOrEqual(1);

    await request(app)
      .patch(`/v1/admin/courses/${courseId}`)
      .set(auth(superAdmin.token))
      .send({ status: "archived" })
      .expect(200);
  });

  it("CU16 divergence: declared completed + derived not_started is information", async () => {
    const superAdmin = await loginAs("super_admin");
    const shikshak = await loginAs("shikshak");
    const cityId = await mumbaiCityId(superAdmin.token);
    const { courseId, sectionIds } = await publishableCourse(superAdmin.token, cityId);
    const sectionId = sectionIds[0]!;

    await request(app)
      .post(`/v1/courses/sections/${sectionId}/subsections`)
      .set(auth(superAdmin.token))
      .send({ title_en: "Leaf A", title_hi: "पत्ती अ" })
      .expect(200);
    await request(app)
      .post(`/v1/courses/sections/${sectionId}/subsections`)
      .set(auth(superAdmin.token))
      .send({ title_en: "Leaf B", title_hi: "पत्ती ब" })
      .expect(200);

    await request(app)
      .post(`/v1/admin/courses/${courseId}/publish`)
      .set(auth(superAdmin.token))
      .expect(200);

    const inScope = await pool.query<{ id: string }>(
      `select s.id from students s
        join shikshak_batch_assignments a on a.batch_id = s.batch_id and a.is_active = true
        join users u on u.id = a.user_id
       where u.phone = '+919800000005' and s.status = 'active' and s.deleted_at is null
       limit 1`,
    );
    expect(inScope.rows[0]?.id).toBeTruthy();
    const studentId = inScope.rows[0]!.id;
    // Deliberate divergence: declare section completed without touching subsections.
    await request(app)
      .post(`/v1/courses/nodes/${sectionId}/progress`)
      .set(auth(shikshak.token))
      .send({ student_id: studentId, status: "completed" })
      .expect(200);

    const tree = await request(app)
      .get(`/v1/courses/${courseId}/tree`)
      .query({ student_id: studentId })
      .set(auth(shikshak.token));
    expect(tree.status).toBe(200);
    const sec = tree.body.data.sections[0];
    expect(sec.status).toBe("completed");
    expect(sec.derived_status).toBe("not_started");
    expect(sec.status_diverges).toBe(true);
    // Declaration is not blocked — row stays completed.
    expect(sec.certified_at).toBeNull();
  });
});
