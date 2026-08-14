/**
 * Team module acceptance criteria (public + admin).
 *
 * Relies on seed geography (Mumbai / Pune) and team_categories. beforeAll runs
 * backfillTeamMembersFromUsers so staff personas have published cards.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth } from "./helpers";
import { backfillTeamMembersFromUsers, syncTeamMemberForUser } from "../src/lib/team-members-sync";
import { SHIKSHAK_CENTRES_PAGE_SIZE } from "../src/lib/team-public";

const PRIVACY_LEAK = /\b(phone|email|gender|dob)\b/i;

let MUMBAI_CITY: string;
let MUMBAI_STATE: string;
let MUMBAI_SLUG: string;
let PUNE_CITY: string;
let PUNE_STATE: string;
let GHATKOPAR: string;
let KOTHRUD: string;
let CORE_CAT: string;
let SANCHALAK_CAT: string;
let SHIKSHAK_CAT: string;
let CITY_ADMIN_ID: string;
let SANCHALAK_ID: string;
let SHIKSHAK_ID: string;
let SUPER_ADMIN_ID: string;

const createdCentreIds: string[] = [];
const createdBatchIds: string[] = [];
const createdUserIds: string[] = [];
const createdMemberIds: string[] = [];
const createdAssignmentIds: string[] = [];

beforeAll(async () => {
  const city = async (name: string) =>
    (await pool.query(`select id, state_id, slug from cities where name = $1`, [name])).rows[0];
  const centre = async (name: string) =>
    (await pool.query(`select id from centres where name = $1`, [name])).rows[0].id as string;
  const userByPhone = async (phone: string) =>
    (await pool.query(`select id from users where phone = $1`, [phone])).rows[0].id as string;
  const cat = async (key: string) =>
    (await pool.query(`select id from team_categories where key = $1`, [key])).rows[0].id as string;

  const mumbai = await city("Mumbai");
  const pune = await city("Pune");
  MUMBAI_CITY = mumbai.id;
  MUMBAI_STATE = mumbai.state_id;
  MUMBAI_SLUG = mumbai.slug;
  PUNE_CITY = pune.id;
  PUNE_STATE = pune.state_id;
  GHATKOPAR = await centre("Ghatkopar Jain Pathshala");
  KOTHRUD = await centre("Kothrud Jain Pathshala");
  CORE_CAT = await cat("core_team");
  SANCHALAK_CAT = await cat("sanchalak");
  SHIKSHAK_CAT = await cat("shikshak");
  CITY_ADMIN_ID = await userByPhone("+919800000003");
  SANCHALAK_ID = await userByPhone("+919800000004");
  SHIKSHAK_ID = await userByPhone("+919800000005");
  SUPER_ADMIN_ID = await userByPhone("+919800000001");

  await backfillTeamMembersFromUsers();
});

afterAll(async () => {
  if (!SHIKSHAK_ID) return;
  try {
    if (createdAssignmentIds.length) {
      await pool.query(`delete from shikshak_batch_assignments where id = any($1::uuid[])`, [
        createdAssignmentIds,
      ]);
    }
    if (createdMemberIds.length) {
      await pool.query(`delete from team_members where id = any($1::uuid[])`, [createdMemberIds]);
    }
    if (createdUserIds.length) {
      await pool.query(`delete from team_members where user_id = any($1::uuid[])`, [createdUserIds]);
      await pool.query(`delete from shikshak_batch_assignments where user_id = any($1::uuid[])`, [
        createdUserIds,
      ]);
      await pool.query(`delete from shikshak_centre_assignments where user_id = any($1::uuid[])`, [
        createdUserIds,
      ]);
      await pool.query(`delete from users where id = any($1::uuid[])`, [createdUserIds]);
    }
    if (createdBatchIds.length) {
      await pool.query(`delete from batches where id = any($1::uuid[])`, [createdBatchIds]);
    }
    if (createdCentreIds.length) {
      await pool.query(`delete from team_members where centre_id = any($1::uuid[])`, [
        createdCentreIds,
      ]);
      await pool.query(`delete from centres where id = any($1::uuid[])`, [createdCentreIds]);
    }
    await pool.query(`update users set is_active = true where id = any($1::uuid[])`, [
      [SHIKSHAK_ID, SANCHALAK_ID],
    ]);
    await syncTeamMemberForUser(SHIKSHAK_ID);
    await syncTeamMemberForUser(SANCHALAK_ID);
    await pool.query(
      `delete from sanchalak_centre_assignments
       where user_id = $1 and centre_id = $2`,
      [SANCHALAK_ID, KOTHRUD],
    );
  } catch {
    /* best-effort teardown */
  }
});

function assertNoPrivacyLeak(body: unknown) {
  const raw = JSON.stringify(body);
  expect(raw).not.toMatch(PRIVACY_LEAK);
}

describe("Team public API", () => {
  it("GET /v1/team → 200, only cities with published members", async () => {
    // Ensure Mumbai has at least one published member (backfill).
    const pub = await pool.query(
      `select count(*)::int as n from team_members
       where city_id = $1 and is_published = true and deleted_at is null`,
      [MUMBAI_CITY],
    );
    expect(pub.rows[0].n).toBeGreaterThan(0);

    // City with no published members must not appear — use a throwaway city slug.
    const emptyCityId = randomUUID();
    await pool.query(
      `insert into cities (id, state_id, name, code, slug)
       values ($1, $2, 'Empty Team City', 'ETC', 'empty-team-city')`,
      [emptyCityId, MUMBAI_STATE],
    );

    try {
      const res = await request(app).get("/v1/team");
      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      const cities = res.body.data.cities as Array<{ slug: string; member_count: number }>;
      expect(cities.every((c) => c.member_count > 0)).toBe(true);
      expect(cities.some((c) => c.slug === "empty-team-city")).toBe(false);
      expect(cities.some((c) => c.slug === MUMBAI_SLUG)).toBe(true);
      assertNoPrivacyLeak(res.body);
    } finally {
      await pool.query(`delete from cities where id = $1`, [emptyCityId]);
    }
  });

  it("GET /v1/team/cities/{slug} → 200, three categories in order", async () => {
    const res = await request(app).get(`/v1/team/cities/${MUMBAI_SLUG}`);
    expect(res.status).toBe(200);
    const cats = res.body.data.categories as Array<{ key: string; order: number }>;
    expect(cats.length).toBeGreaterThanOrEqual(3);
    const keys = cats.map((c) => c.key);
    expect(keys.slice(0, 3)).toEqual(["core_team", "sanchalak", "shikshak"]);
    for (let i = 1; i < cats.length; i++) {
      expect(cats[i]!.order).toBeGreaterThanOrEqual(cats[i - 1]!.order);
    }
    assertNoPrivacyLeak(res.body);
  });

  it("GET /v1/team/cities/{unknown-slug} → 404", async () => {
    const res = await request(app).get("/v1/team/cities/no-such-city-zzz");
    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe("ERR_NOT_FOUND");
  });

  it("public Team payloads never expose phone, email, gender, or dob", async () => {
    const national = await request(app).get("/v1/team");
    const city = await request(app).get(`/v1/team/cities/${MUMBAI_SLUG}`);
    const centre = await request(app).get(`/v1/team/centres/${GHATKOPAR}`);
    assertNoPrivacyLeak(national.body);
    assertNoPrivacyLeak(city.body);
    if (centre.status === 200) assertNoPrivacyLeak(centre.body);
  });

  it("published city/state admin Core Team cards have no designation or bio", async () => {
    const memberRow = await pool.query(
      `select id from team_members where user_id = $1 and deleted_at is null`,
      [CITY_ADMIN_ID],
    );
    const cardId = memberRow.rows[0]?.id as string | undefined;
    expect(cardId).toBeTruthy();

    await pool.query(
      `update team_members
       set designation_en = 'City admin', designation_hi = 'शहर एडमिन',
           bio_en = 'Should not appear', bio_hi = 'दिखना नहीं चाहिए'
       where id = $1`,
      [cardId],
    );

    const trusteeId = randomUUID();
    createdMemberIds.push(trusteeId);
    await pool.query(
      `insert into team_members (
         id, category_id, user_id, scope_level, state_id, city_id,
         display_name_en, designation_en, designation_hi, is_published, published_at
       ) values ($1, $2, null, 'city', $3, $4, 'Asha Trustee', 'Trustee', 'ट्रस्टी', true, now())`,
      [trusteeId, CORE_CAT, MUMBAI_STATE, MUMBAI_CITY],
    );

    const res = await request(app).get(`/v1/team/cities/${MUMBAI_SLUG}`);
    expect(res.status).toBe(200);
    assertNoPrivacyLeak(res.body);

    const core = (res.body.data.categories as Array<{
      key: string;
      members: Array<{
        id: string;
        designation_en: string | null;
        designation_hi: string | null;
        bio_en: string | null;
        bio_hi: string | null;
        photo_url: string | null;
      }>;
    }>).find((c) => c.key === "core_team");
    expect(core).toBeTruthy();

    const adminCard = core!.members.find((m) => m.id === cardId);
    expect(adminCard).toBeTruthy();
    expect(adminCard!.designation_en).toBeNull();
    expect(adminCard!.designation_hi).toBeNull();
    expect(adminCard!.bio_en).toBeNull();
    expect(adminCard!.bio_hi).toBeNull();

    const trustee = core!.members.find((m) => m.id === trusteeId);
    expect(trustee).toBeTruthy();
    expect(trustee!.designation_en).toBe("Trustee");
    expect(trustee!.designation_hi).toBe("ट्रस्टी");

    const photoUrls = core!.members.map((m) => m.photo_url).filter((u): u is string => !!u);
    expect(photoUrls.length).toBe(core!.members.length);
    expect(new Set(photoUrls).size).toBe(photoUrls.length);
    for (const url of photoUrls) {
      expect(url).toMatch(/^\/v1\/team\/portraits\//);
      expect(url).not.toMatch(/picsum/i);
    }
  });

  it("signs user-uploaded photos so /uploads can serve them", async () => {
    const previous = await pool.query(`select photo_url from users where id = $1`, [SANCHALAK_ID]);
    const prevUrl = (previous.rows[0]?.photo_url as string | null) ?? null;
    const fakeUpload = `http://127.0.0.1:8080/uploads/user-photos/${randomUUID()}.jpg`;
    await pool.query(`update users set photo_url = $1 where id = $2`, [fakeUpload, SANCHALAK_ID]);
    await syncTeamMemberForUser(SANCHALAK_ID);
    try {
      const res = await request(app).get(`/v1/team/cities/${MUMBAI_SLUG}`);
      expect(res.status).toBe(200);
      const sanchalak = (res.body.data.categories as Array<{
        key: string;
        members: Array<{ id: string; photo_url: string | null }>;
        centres?: Array<{ members: Array<{ photo_url: string | null }> }>;
      }>).find((c) => c.key === "sanchalak");
      const cards = [
        ...(sanchalak?.members ?? []),
        ...(sanchalak?.centres ?? []).flatMap((c) => c.members),
      ];
      const card = cards.find((m) => m.photo_url?.includes("user-photos/"));
      expect(card).toBeTruthy();
      expect(card!.photo_url).toContain(fakeUpload.split("?")[0]);
      expect(card!.photo_url).toMatch(/[?&]sig=/);
      expect(card!.photo_url).toMatch(/[?&]se=/);
    } finally {
      await pool.query(`update users set photo_url = $1 where id = $2`, [prevUrl, SANCHALAK_ID]);
    }
  });

  it("deactivate a shikshak → city page omits that card", async () => {
    await syncTeamMemberForUser(SHIKSHAK_ID);
    const before = await request(app).get(`/v1/team/cities/${MUMBAI_SLUG}`);
    expect(before.status).toBe(200);
    const shikshakCat = (before.body.data.categories as Array<{
      key: string;
      centres: Array<{ members: Array<{ id: string }> }>;
      members: Array<{ id: string }>;
    }>).find((c) => c.key === "shikshak");
    const memberRow = await pool.query(
      `select id from team_members where user_id = $1 and deleted_at is null`,
      [SHIKSHAK_ID],
    );
    const cardId = memberRow.rows[0]?.id as string | undefined;
    expect(cardId).toBeTruthy();

    const presentBefore =
      shikshakCat?.centres.some((c) => c.members.some((m) => m.id === cardId)) ||
      shikshakCat?.members.some((m) => m.id === cardId);
    expect(presentBefore).toBe(true);

    await pool.query(`update users set is_active = false where id = $1`, [SHIKSHAK_ID]);
    await syncTeamMemberForUser(SHIKSHAK_ID);

    const after = await request(app).get(`/v1/team/cities/${MUMBAI_SLUG}`);
    expect(after.status).toBe(200);
    const raw = JSON.stringify(after.body.data);
    expect(raw).not.toContain(cardId);

    await pool.query(`update users set is_active = true where id = $1`, [SHIKSHAK_ID]);
    await syncTeamMemberForUser(SHIKSHAK_ID);
  });

  it("assign a sanchalak to a second centre → still one team_members row", async () => {
    const admin = await loginAs("super_admin");
    const before = await pool.query(
      `select count(*)::int as n from team_members where user_id = $1 and deleted_at is null`,
      [SANCHALAK_ID],
    );
    expect(before.rows[0].n).toBe(1);

    const assign = await request(app)
      .post(`/v1/admin/centres/${KOTHRUD}/sanchalaks`)
      .set(auth(admin.token))
      .send({ user_id: SANCHALAK_ID });
    // 200/201 if newly assigned; 409 if already tagged is also acceptable for count check.
    expect([200, 201, 409]).toContain(assign.status);

    await syncTeamMemberForUser(SANCHALAK_ID);

    const after = await pool.query(
      `select count(*)::int as n from team_members where user_id = $1 and deleted_at is null`,
      [SANCHALAK_ID],
    );
    expect(after.rows[0].n).toBe(1);
  });

  it("shikshak cursor pages never return duplicate centres", async () => {
    // Need > PAGE_SIZE centres with published shikshaks in Mumbai.
    const extra = SHIKSHAK_CENTRES_PAGE_SIZE + 2;
    for (let i = 0; i < extra; i++) {
      const centreId = randomUUID();
      const batchId = randomUUID();
      const userId = randomUUID();
      const memberId = randomUUID();
      const phone = `+91991${String(1000000 + i).slice(0, 7)}`;

      await pool.query(
        `insert into centres (id, state_id, city_id, name, status, "order")
         values ($1, $2, $3, $4, 'active', $5)`,
        [centreId, MUMBAI_STATE, MUMBAI_CITY, `Team Cursor Centre ${i}`, 100 + i],
      );
      createdCentreIds.push(centreId);

      await pool.query(
        `insert into batches (id, centre_id, name, age_groups, day_of_week, start_time, end_time, capacity, status)
         values ($1, $2, $3, '{bal}', '{0}', '10:00', '11:00', 20, 'active')`,
        [batchId, centreId, `Team Cursor Batch ${i}`],
      );
      createdBatchIds.push(batchId);

      await pool.query(
        `insert into users (id, phone, role, full_name, preferred_language, is_active, state_id, city_id, gender)
         values ($1, $2, 'shikshak', $3, 'en', true, $4, $5, 'male')`,
        [userId, phone, `Cursor Guruji ${i}`, MUMBAI_STATE, MUMBAI_CITY],
      );
      createdUserIds.push(userId);

      await pool.query(
        `insert into shikshak_centre_assignments (user_id, centre_id, is_active)
         values ($1, $2, true)
         on conflict do nothing`,
        [userId, centreId],
      );
      const asg = await pool.query(
        `insert into shikshak_batch_assignments (user_id, batch_id, is_active)
         values ($1, $2, true) returning id`,
        [userId, batchId],
      );
      createdAssignmentIds.push(asg.rows[0].id);

      await pool.query(
        `insert into team_members (
           id, category_id, user_id, scope_level, state_id, city_id, centre_id,
           display_name_en, is_published, published_at
         ) values ($1, $2, $3, 'centre', $4, $5, $6, $7, true, now())`,
        [memberId, SHIKSHAK_CAT, userId, MUMBAI_STATE, MUMBAI_CITY, centreId, `Cursor Guruji ${i}`],
      );
      createdMemberIds.push(memberId);
    }

    const first = await request(app).get(`/v1/team/cities/${MUMBAI_SLUG}/shikshaks`);
    expect(first.status).toBe(200);
    const page1 = first.body.data.centres as Array<{ id: string }>;
    const cursor = first.body.meta?.next_cursor as string | null;
    expect(cursor).toBeTruthy();

    const second = await request(app).get(
      `/v1/team/cities/${MUMBAI_SLUG}/shikshaks?cursor=${encodeURIComponent(cursor!)}`,
    );
    expect(second.status).toBe(200);
    const page2 = second.body.data.centres as Array<{ id: string }>;
    expect(page2.length).toBeGreaterThan(0);

    const ids = [...page1, ...page2].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);

    // Same cursor again — identical page, still no overlap with page1.
    const secondAgain = await request(app).get(
      `/v1/team/cities/${MUMBAI_SLUG}/shikshaks?cursor=${encodeURIComponent(cursor!)}`,
    );
    expect(secondAgain.status).toBe(200);
    const page2b = secondAgain.body.data.centres as Array<{ id: string }>;
    expect(page2b.map((c) => c.id)).toEqual(page2.map((c) => c.id));
    const ids2 = [...page1, ...page2b].map((c) => c.id);
    expect(new Set(ids2).size).toBe(ids2.length);
  });
});

describe("Team admin API", () => {
  it("POST /v1/admin/team/members as city_admin for another city → 403 ERR_TEAM_PUBLISH_FORBIDDEN", async () => {
    const cityAdmin = await loginAs("city_admin");
    const res = await request(app)
      .post("/v1/admin/team/members")
      .set(auth(cityAdmin.token))
      .send({
        category_id: CORE_CAT,
        user_id: null,
        scope_level: "city",
        state_id: PUNE_STATE,
        city_id: PUNE_CITY,
        display_name_en: "Out of scope trustee",
        designation_en: "Trustee",
      });
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe("ERR_TEAM_PUBLISH_FORBIDDEN");
  });

  it("POST publish on a super_admin-linked row with no designation → 400 ERR_TEAM_DESIGNATION_REQUIRED", async () => {
    const admin = await loginAs("super_admin");
    const memberId = randomUUID();
    createdMemberIds.push(memberId);

    await pool.query(
      `insert into team_members (
         id, category_id, user_id, scope_level, state_id, city_id, centre_id,
         display_name_en, designation_en, designation_hi, is_published
       ) values ($1, $2, $3, 'national', null, null, null, 'Super Admin Card', null, null, false)`,
      [memberId, CORE_CAT, SUPER_ADMIN_ID],
    );

    const res = await request(app)
      .post(`/v1/admin/team/members/${memberId}/publish`)
      .set(auth(admin.token))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("ERR_TEAM_DESIGNATION_REQUIRED");
  });

  it("POST a second member row for an existing user_id → 409 ERR_TEAM_MEMBER_DUPLICATE", async () => {
    const admin = await loginAs("super_admin");
    // city_admin already has a backfilled card.
    const existing = await pool.query(
      `select id from team_members where user_id = $1 and deleted_at is null`,
      [CITY_ADMIN_ID],
    );
    expect(existing.rows.length).toBe(1);

    const res = await request(app)
      .post("/v1/admin/team/members")
      .set(auth(admin.token))
      .send({
        category_id: CORE_CAT,
        user_id: CITY_ADMIN_ID,
        scope_level: "city",
        state_id: MUMBAI_STATE,
        city_id: MUMBAI_CITY,
        designation_en: "City Admin",
      });
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe("ERR_TEAM_MEMBER_DUPLICATE");
  });
});

describe("Team city page crawlability (SPA contract)", () => {
  it("city payload supports cumulative ?page=N and exposes next_cursor for page links", async () => {
    const page1 = await request(app).get(`/v1/team/cities/${MUMBAI_SLUG}?page=1`);
    expect(page1.status).toBe(200);
    expect(page1.body.meta?.page).toBe(1);
    expect(page1.body.meta?.page_size).toBe(SHIKSHAK_CENTRES_PAGE_SIZE);

    if ((page1.body.meta?.total_pages ?? 1) > 1) {
      expect(page1.body.meta?.next_cursor).toBeTruthy();
      const page2 = await request(app).get(`/v1/team/cities/${MUMBAI_SLUG}?page=2`);
      expect(page2.status).toBe(200);
      expect(page2.body.meta?.page).toBe(2);
      const c1 = (page1.body.data.categories as Array<{ key: string; centres: unknown[] }>).find(
        (c) => c.key === "shikshak",
      );
      const c2 = (page2.body.data.categories as Array<{ key: string; centres: unknown[] }>).find(
        (c) => c.key === "shikshak",
      );
      // Cumulative: page 2 includes at least as many centres as page 1.
      expect((c2?.centres.length ?? 0)).toBeGreaterThanOrEqual(c1?.centres.length ?? 0);
    }
  });
});
