import { describe, it, expect, afterAll, beforeAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth } from "./helpers";

/**
 * Notices integration coverage. Everything is self-creating and additive: each
 * test mints its own notice(s) via the admin authoring endpoint and asserts on
 * those specific rows (matched by id/title), so reruns never collide and we
 * never assert on global counts.
 *
 * Geography of the seeded personas (from the seed): the parent (+...006), the
 * student Aarav (+...007), sanchalak, shikshak and city_admin all live in
 * Mumbai (Maharashtra). Ahmedabad is a different city in a different state and
 * is therefore used as the "targeted elsewhere" scope that must be excluded
 * from the member feed.
 *
 * Endpoint shapes asserted (see src/routes/v1/notices.ts):
 *  - POST   /v1/notices/admin          -> 201 { data: { id } }
 *  - PATCH  /v1/notices/admin/:id       -> 200 { data: { id } }
 *  - DELETE /v1/notices/admin/:id       -> 200 { data: { id, deleted } }
 *  - GET    /v1/notices/feed            -> 200 { data: { items, unread_count } }
 *  - POST   /v1/notices/:id/read        -> 200 { data: { id, read } }
 *  - GET    /v1/notices/public          -> 200 { data: { items } } (no auth)
 */

afterAll(async () => {
  await pool.end(); // close the shared pg pool so vitest exits cleanly
});

// Resolved at runtime by name — seed UUIDs are DB-generated and change per reseed.
let AHMEDABAD_CITY: string; // a different city in a different state ("targeted elsewhere")
const tag = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

beforeAll(async () => {
  const { rows } = await pool.query(`select id from cities where name = $1`, ["Ahmedabad"]);
  AHMEDABAD_CITY = rows[0].id;
});

/**
 * Resolve the parent's scope (their first child's centre_id + batch_id) for
 * targeting tests. /v1/me/children only exposes centre_name/batch_name, so we
 * cross-reference the admin centres/batches lists to recover the ids.
 */
async function parentScope(
  parentToken: string,
  adminToken: string,
): Promise<{ studentId: string; centreId: string; batchId: string }> {
  const kids = await request(app).get("/v1/me/children").set(auth(parentToken));
  expect(kids.status).toBe(200);
  const child = kids.body.data.items[0];
  expect(child).toBeTruthy();

  const centresRes = await request(app).get("/v1/admin/centres?limit=300").set(auth(adminToken));
  expect(centresRes.status).toBe(200);
  const centre = centresRes.body.data.items.find((c: { name: string }) => c.name === child.centre_name);
  expect(centre, `centre named ${child.centre_name}`).toBeTruthy();

  const batchesRes = await request(app).get("/v1/admin/batches?limit=300").set(auth(adminToken));
  expect(batchesRes.status).toBe(200);
  // Batch names repeat across cities — pin to the child's centre.
  const batch = batchesRes.body.data.items.find(
    (b: { name: string; centre_id: string }) =>
      b.name === child.batch_name && b.centre_id === centre.id,
  );
  expect(batch, `batch named ${child.batch_name} at ${child.centre_name}`).toBeTruthy();

  return { studentId: child.id, centreId: centre.id, batchId: batch.id };
}

/** Create a notice as super_admin and return its id. */
async function createNotice(adminToken: string, body: Record<string, unknown>): Promise<string> {
  // title_hi is required (DB-7 / CA-6, review 2026-08) — default it for
  // every caller that doesn't care about Hindi copy specifically.
  const res = await request(app)
    .post("/v1/notices/admin")
    .set(auth(adminToken))
    .send({ title_hi: "शीर्षक", ...body });
  expect(res.status).toBe(201);
  expect(res.body.data.id).toBeTruthy();
  return res.body.data.id as string;
}

async function feed(token: string): Promise<{ items: Array<Record<string, any>>; unread: number }> {
  const res = await request(app).get("/v1/notices/feed?limit=200").set(auth(token));
  expect(res.status).toBe(200);
  return { items: res.body.data.items, unread: res.body.data.unread_count };
}

describe("notices", () => {
  /* ─────────────────────────── auth gating ─────────────────────────── */

  it("requires auth on the scoped feed and on mark-read", async () => {
    const f = await request(app).get("/v1/notices/feed");
    expect(f.status).toBe(401);

    const r = await request(app).post("/v1/notices/00000000-0000-0000-0000-000000000000/read");
    expect(r.status).toBe(401);
  });

  it("forbids non-admin roles from creating, and unauthenticated callers too", async () => {
    const body = { title_en: "Nope", audience: "national" };

    // Unauthenticated -> 401.
    const anon = await request(app).post("/v1/notices/admin").send(body);
    expect(anon.status).toBe(401);

    // Member roles (parent, student) lack admin-panel access -> 403.
    for (const role of ["parent", "student"] as const) {
      const { token } = await loginAs(role);
      const res = await request(app).post("/v1/notices/admin").set(auth(token)).send(body);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("ERR_FORBIDDEN");
    }
  });

  /* ───────────────────── admin create / edit / delete ───────────────────── */

  it("lets an admin create, edit and delete a centre-targeted notice", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const scope = await parentScope(parent.token, admin.token);

    // Create targeting the child's centre.
    const id = await createNotice(admin.token, {
      title_en: `Centre notice ${tag()}`,
      audience: "centre",
      centre_id: scope.centreId,
      content_en: "Original body.",
    });

    // It shows in the admin authoring list with the right targeting.
    const adminList = await request(app).get("/v1/notices/admin?limit=300").set(auth(admin.token));
    expect(adminList.status).toBe(200);
    const listed = adminList.body.data.items.find((n: { id: string }) => n.id === id);
    expect(listed).toBeTruthy();
    expect(listed.audience).toBe("centre");
    expect(listed.centre_id).toBe(scope.centreId);

    // Edit: change title + content (PATCH canonical route).
    const newTitle = `Centre notice EDITED ${tag()}`;
    const edit = await request(app)
      .patch(`/v1/notices/admin/${id}`)
      .set(auth(admin.token))
      .send({
        title_en: newTitle,
        title_hi: "शीर्षक",
        audience: "centre",
        centre_id: scope.centreId,
        content_en: "Edited body.",
      });
    expect(edit.status).toBe(200);
    expect(edit.body.data.id).toBe(id);

    const afterEdit = await request(app).get("/v1/notices/admin?limit=300").set(auth(admin.token));
    const edited = afterEdit.body.data.items.find((n: { id: string }) => n.id === id);
    expect(edited.title_en).toBe(newTitle);
    expect(edited.content_en).toBe("Edited body.");

    // Delete.
    const del = await request(app).delete(`/v1/notices/admin/${id}`).set(auth(admin.token));
    expect(del.status).toBe(200);
    expect(del.body.data.deleted).toBe(true);

    // Gone from the authoring list.
    const afterDel = await request(app).get("/v1/notices/admin?limit=300").set(auth(admin.token));
    expect(afterDel.body.data.items.find((n: { id: string }) => n.id === id)).toBeUndefined();

    // Editing a deleted notice now 404s.
    const editGone = await request(app)
      .patch(`/v1/notices/admin/${id}`)
      .set(auth(admin.token))
      .send({ title_en: "x", audience: "centre", centre_id: scope.centreId });
    expect(editGone.status).toBe(404);
  });

  it("forbids a city_admin from targeting national / a foreign city, and from editing out-of-scope notices", async () => {
    const cityAdmin = await loginAs("city_admin"); // Mumbai

    // National is super_admin only.
    const national = await request(app)
      .post("/v1/notices/admin")
      .set(auth(cityAdmin.token))
      .send({ title_en: `CA national ${tag()}`, title_hi: "शीर्षक", audience: "national" });
    expect(national.status).toBe(403);
    expect(national.body.error.code).toBe("ERR_FORBIDDEN");

    // A city the admin does not administer (Ahmedabad) is forbidden.
    const foreignCity = await request(app)
      .post("/v1/notices/admin")
      .set(auth(cityAdmin.token))
      .send({ title_en: `CA foreign city ${tag()}`, title_hi: "शीर्षक", audience: "city", city_id: AHMEDABAD_CITY });
    expect(foreignCity.status).toBe(403);
    // T-11 (review 2026-08) — a bare status assertion can't distinguish
    // "wrong city" from "requireAdminPanel rejected for an unrelated
    // reason"; pin the actual error code, matching the sibling assertion
    // two lines up.
    expect(foreignCity.body.error.code).toBe("ERR_FORBIDDEN");

    // A super_admin national notice cannot be edited or deleted by the city_admin.
    const admin = await loginAs("super_admin");
    const nationalId = await createNotice(admin.token, { title_en: `National ${tag()}`, audience: "national" });

    const edit = await request(app)
      .patch(`/v1/notices/admin/${nationalId}`)
      .set(auth(cityAdmin.token))
      .send({ title_en: "hijack", audience: "national" });
    expect(edit.status).toBe(404); // out-of-scope rows are indistinguishable from missing

    const del = await request(app).delete(`/v1/notices/admin/${nationalId}`).set(auth(cityAdmin.token));
    expect(del.status).toBe(404);

    // cleanup
    await request(app).delete(`/v1/notices/admin/${nationalId}`).set(auth(admin.token));
  });

  // T-5 (review 2026-08) — authorizeWrite's ALLOW branches for state/city
  // (centre/batch already covered by "lets an admin create, edit and
  // delete a centre-targeted notice") had zero coverage: only the deny
  // paths above were ever exercised, so replacing the whole `case "city":`
  // block with a bare 403 would still pass every existing test.
  //
  // T-6 (review 2026-08) — adminFeedWhere itself had zero coverage from
  // any non-super-admin role. GET /admin as state_admin/city_admin here
  // closes that gap in the same pass.
  it("lets a state_admin target their own state, and a city_admin target their own city", async () => {
    const stateAdmin = await loginAs("state_admin"); // Maharashtra
    const cityAdmin = await loginAs("city_admin"); // Mumbai

    const [stateRow] = (
      await pool.query<{ state_id: string }>(`select state_id from users where id = $1`, [
        stateAdmin.user.id,
      ])
    ).rows;
    const [cityRow] = (
      await pool.query<{ city_id: string }>(`select city_id from users where id = $1`, [
        cityAdmin.user.id,
      ])
    ).rows;
    expect(stateRow?.state_id).toBeTruthy();
    expect(cityRow?.city_id).toBeTruthy();

    const stateNoticeId = await createNotice(stateAdmin.token, {
      title_en: `SA state ${tag()}`,
      audience: "state",
      state_id: stateRow!.state_id,
    });
    const cityNoticeId = await createNotice(cityAdmin.token, {
      title_en: `CA city ${tag()}`,
      audience: "city",
      city_id: cityRow!.city_id,
    });

    // T-6 — GET /admin as each role actually returns the row it just made
    // (adminFeedWhere resolves their own state/city correctly), and GET
    // /admin as a shikshak/sanchalak (centre-bound scope, no state/city)
    // never sees state/city rows outside their reach.
    const stateAdminList = await request(app).get("/v1/notices/admin?limit=300").set(auth(stateAdmin.token));
    expect(stateAdminList.status).toBe(200);
    expect(
      stateAdminList.body.data.items.find((n: { id: string }) => n.id === stateNoticeId),
    ).toBeTruthy();

    const cityAdminList = await request(app).get("/v1/notices/admin?limit=300").set(auth(cityAdmin.token));
    expect(cityAdminList.status).toBe(200);
    expect(cityAdminList.body.data.items.find((n: { id: string }) => n.id === cityNoticeId)).toBeTruthy();

    // Sanchalak/shikshak are ALSO Mumbai/Maharashtra personas, so
    // adminFeedWhere correctly includes their own state/city rows too —
    // this is the same geography arm as the admin cases above, just via a
    // centre-bound role. The point of exercising it here is T-6 coverage
    // (adminFeedWhere had never run as these two roles at all), not a
    // scope-exclusion assertion.
    const sanchalak = await loginAs("sanchalak");
    const shikshak = await loginAs("shikshak");
    for (const role of [sanchalak, shikshak]) {
      const roleList = await request(app).get("/v1/notices/admin?limit=300").set(auth(role.token));
      expect(roleList.status).toBe(200);
      expect(
        roleList.body.data.items.find((n: { id: string }) => n.id === stateNoticeId),
      ).toBeTruthy();
      expect(
        roleList.body.data.items.find((n: { id: string }) => n.id === cityNoticeId),
      ).toBeTruthy();
    }

    // GET /feed as an ordinary member (parent) in the same state/city sees
    // both — memberVisibility's geography arms, also otherwise untested
    // for the positive case (T-4).
    const parent = await loginAs("parent"); // Mumbai / Maharashtra
    const feed = await request(app).get("/v1/notices/feed?limit=300").set(auth(parent.token));
    expect(feed.status).toBe(200);
    expect(feed.body.data.items.find((n: { id: string }) => n.id === stateNoticeId)).toBeTruthy();
    expect(feed.body.data.items.find((n: { id: string }) => n.id === cityNoticeId)).toBeTruthy();

    // cleanup
    await request(app).delete(`/v1/notices/admin/${stateNoticeId}`).set(auth(stateAdmin.token));
    await request(app).delete(`/v1/notices/admin/${cityNoticeId}`).set(auth(cityAdmin.token));
  });

  /* ─────────────────── scoped feed: in-scope vs elsewhere ─────────────────── */

  it("shows a member only notices targeted to their scope, excluding ones targeted elsewhere", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const scope = await parentScope(parent.token, admin.token);

    const mark = tag();

    // Visible: targeted to the child's centre.
    const centreId = await createNotice(admin.token, {
      title_en: `IN centre ${mark}`,
      audience: "centre",
      centre_id: scope.centreId,
    });
    // Visible: targeted to the child's batch.
    const batchId = await createNotice(admin.token, {
      title_en: `IN batch ${mark}`,
      audience: "batch",
      batch_id: scope.batchId,
    });
    // Visible: national reaches everyone.
    const nationalId = await createNotice(admin.token, {
      title_en: `IN national ${mark}`,
      audience: "national",
    });
    // Excluded: a city in a different state (parent is in Mumbai, not Ahmedabad).
    const foreignCityId = await createNotice(admin.token, {
      title_en: `OUT foreign-city ${mark}`,
      audience: "city",
      city_id: AHMEDABAD_CITY,
    });

    const { items } = await feed(parent.token);
    const ids = new Set(items.map((i) => i.id));

    expect(ids.has(centreId)).toBe(true);
    expect(ids.has(batchId)).toBe(true);
    expect(ids.has(nationalId)).toBe(true);
    // The crux: a notice targeted to a foreign city/state is NOT in the feed.
    expect(ids.has(foreignCityId)).toBe(false);

    // cleanup
    for (const id of [centreId, batchId, nationalId, foreignCityId]) {
      await request(app).delete(`/v1/notices/admin/${id}`).set(auth(admin.token));
    }
  });

  /* ───────────────────────── read-tracking ───────────────────────── */

  it("records a read receipt that surfaces on subsequent feed reads (idempotently)", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const scope = await parentScope(parent.token, admin.token);

    const id = await createNotice(admin.token, {
      title_en: `Read-tracking ${tag()}`,
      audience: "centre",
      centre_id: scope.centreId,
    });

    // Initially unread for the parent.
    const before = await feed(parent.token);
    const rowBefore = before.items.find((i) => i.id === id);
    expect(rowBefore).toBeTruthy();
    expect(rowBefore!.read_at).toBeNull();
    const unreadBefore = before.unread;

    // Mark read.
    const read = await request(app).post(`/v1/notices/${id}/read`).set(auth(parent.token));
    expect(read.status).toBe(200);
    expect(read.body.data.read).toBe(true);
    expect(read.body.data.id).toBe(id);

    // Now the feed reflects the receipt and the unread count dropped by one.
    const after = await feed(parent.token);
    const rowAfter = after.items.find((i) => i.id === id);
    expect(rowAfter!.read_at).not.toBeNull();
    expect(after.unread).toBe(unreadBefore - 1);

    // Idempotent: re-reading keeps the same read_at and does not change unread.
    const reread = await request(app).post(`/v1/notices/${id}/read`).set(auth(parent.token));
    expect(reread.status).toBe(200);
    const after2 = await feed(parent.token);
    const rowAfter2 = after2.items.find((i) => i.id === id);
    expect(rowAfter2!.read_at).toBe(rowAfter!.read_at);
    expect(after2.unread).toBe(after.unread);

    // Marking a non-existent / malformed notice id 404s.
    const missing = await request(app)
      .post("/v1/notices/00000000-0000-0000-0000-000000000000/read")
      .set(auth(parent.token));
    expect(missing.status).toBe(404);
    const malformed = await request(app).post("/v1/notices/not-a-uuid/read").set(auth(parent.token));
    expect(malformed.status).toBe(404);

    // cleanup
    await request(app).delete(`/v1/notices/admin/${id}`).set(auth(admin.token));
  });

  /* ───────────────────────── validation ───────────────────────── */

  it("rejects bad create payloads with a validation error", async () => {
    const admin = await loginAs("super_admin");

    // Missing title (required).
    const noTitle = await request(app)
      .post("/v1/notices/admin")
      .set(auth(admin.token))
      .send({ audience: "national" });
    expect(noTitle.status).toBe(422);
    expect(noTitle.body.error.code).toBe("ERR_VALIDATION_FAILED");

    // T-12 (review 2026-08) — DB-7's NOT NULL on notices.title_hi previously
    // only had a direct-DB test (bypassing every route); this is the
    // route-level equivalent, isolating "title_hi missing" from "title_en
    // missing" so a regression that made title_hi optional again would be
    // caught even though title_en is present here.
    const noTitleHi = await request(app)
      .post("/v1/notices/admin")
      .set(auth(admin.token))
      .send({ title_en: "x", audience: "national" });
    expect(noTitleHi.status).toBe(422);
    expect(noTitleHi.body.error.code).toBe("ERR_VALIDATION_FAILED");

    // Invalid audience enum.
    const badAudience = await request(app)
      .post("/v1/notices/admin")
      .set(auth(admin.token))
      .send({ title_en: "x", audience: "galaxy" });
    expect(badAudience.status).toBe(422);

    // audience=centre but no centre_id (superRefine targeting rule).
    const missingTarget = await request(app)
      .post("/v1/notices/admin")
      .set(auth(admin.token))
      .send({ title_en: "x", audience: "centre" });
    expect(missingTarget.status).toBe(422);

    // audience=batch but no batch_id.
    const missingBatch = await request(app)
      .post("/v1/notices/admin")
      .set(auth(admin.token))
      .send({ title_en: "x", audience: "batch" });
    expect(missingBatch.status).toBe(422);

    // Non-uuid centre_id.
    const badUuid = await request(app)
      .post("/v1/notices/admin")
      .set(auth(admin.token))
      .send({ title_en: "x", audience: "centre", centre_id: "nope" });
    expect(badUuid.status).toBe(422);
  });

  /* ───────────────────────── public feed (no auth) ───────────────────────── */

  it("exposes only is_public notices on the public endpoint", async () => {
    const admin = await loginAs("super_admin");
    const mark = tag();

    const publicId = await createNotice(admin.token, {
      title_en: `PUBLIC ${mark}`,
      audience: "national",
      is_public: true,
    });
    const internalId = await createNotice(admin.token, {
      title_en: `INTERNAL ${mark}`,
      audience: "national",
      is_public: false,
    });

    const res = await request(app).get("/v1/notices/public?limit=200");
    expect(res.status).toBe(200);
    const ids = new Set(res.body.data.items.map((i: { id: string }) => i.id));
    expect(ids.has(publicId)).toBe(true);
    expect(ids.has(internalId)).toBe(false);

    // cleanup
    for (const id of [publicId, internalId]) {
      await request(app).delete(`/v1/notices/admin/${id}`).set(auth(admin.token));
    }
  });

  /* ───────────────────── scheduling: draft + expiry ───────────────────── */

  it("hides expired notices from /public and /feed but keeps them on /admin with is_expired", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const mark = tag();

    const publishedAt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const expiresAt = new Date(Date.now() - 60 * 1000); // already expired

    const id = await createNotice(admin.token, {
      title_en: `EXPIRED ${mark}`,
      audience: "national",
      is_public: true,
      publish_at: publishedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
    });

    const pub = await request(app).get("/v1/notices/public?limit=200");
    expect(pub.status).toBe(200);
    expect(pub.body.data.items.find((n: { id: string }) => n.id === id)).toBeUndefined();

    const { items: feedItems } = await feed(parent.token);
    expect(feedItems.find((n) => n.id === id)).toBeUndefined();

    const adminList = await request(app).get("/v1/notices/admin?limit=300").set(auth(admin.token));
    expect(adminList.status).toBe(200);
    const listed = adminList.body.data.items.find((n: { id: string }) => n.id === id);
    expect(listed).toBeTruthy();
    expect(listed.is_expired).toBe(true);
    expect(listed.expires_at).toBeTruthy();

    await request(app).delete(`/v1/notices/admin/${id}`).set(auth(admin.token));
  });

  it("keeps publish_now:false drafts off /public", async () => {
    const admin = await loginAs("super_admin");
    const mark = tag();

    const id = await createNotice(admin.token, {
      title_en: `DRAFT ${mark}`,
      audience: "national",
      is_public: true,
      publish_now: false,
    });

    const pub = await request(app).get("/v1/notices/public?limit=200");
    expect(pub.status).toBe(200);
    expect(pub.body.data.items.find((n: { id: string }) => n.id === id)).toBeUndefined();

    // Still visible to admins (draft, not expired).
    const adminList = await request(app).get("/v1/notices/admin?limit=300").set(auth(admin.token));
    const listed = adminList.body.data.items.find((n: { id: string }) => n.id === id);
    expect(listed).toBeTruthy();
    expect(listed.published_at).toBeNull();
    expect(listed.is_expired).toBe(false);

    await request(app).delete(`/v1/notices/admin/${id}`).set(auth(admin.token));
  });

  it("rejects expires_at <= published_at with 400 ERR_VALIDATION_FAILED", async () => {
    const admin = await loginAs("super_admin");
    const publishedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() - 60 * 1000).toISOString(); // before publish

    const res = await request(app)
      .post("/v1/notices/admin")
      .set(auth(admin.token))
      .send({
        title_en: `BAD EXPIRY ${tag()}`,
        title_hi: "शीर्षक",
        audience: "national",
        publish_at: publishedAt,
        expires_at: expiresAt,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("ERR_VALIDATION_FAILED");
    expect(res.body.error.message).toMatch(/end date must be after the publish date/i);
  });
});
