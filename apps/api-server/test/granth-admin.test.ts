/**
 * SPEC §17.11.5 — Granth directory administration.
 *
 * The scoping is the whole point of this file. Three resources share one mount
 * point under three different authorities, and the interesting cases are the
 * ones where a role can do part of the job: a city_admin who owns the shelf but
 * not the granth, and one who must not be able to reach across a city line —
 * including by moving a library over it.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth } from "./helpers";

afterAll(async () => {
  await pool.end();
});

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const BASE = "/v1/admin/library/granth";

type Cities = { own: string; other: string };

/** The seeded city_admin's own city, plus a different one to push against. */
async function cityPair(): Promise<Cities> {
  const { rows } = await pool.query<{ city_id: string }>(
    `select city_id from users where phone = '+919800000003' limit 1`,
  );
  const own = rows[0]?.city_id;
  if (!own) throw new Error("seeded city_admin has no city_id");
  const other = await pool.query<{ id: string }>(
    `select id from cities where id <> $1 limit 1`,
    [own],
  );
  if (!other.rows[0]) throw new Error("seed a second city before running granth admin tests");
  return { own, other: other.rows[0].id };
}

const createdLibraries: string[] = [];
const createdEntries: string[] = [];

async function makeLibrary(token: string, cityId: string, name = `Lib ${SUFFIX}`) {
  const res = await request(app)
    .post(`${BASE}/libraries`)
    .set(auth(token))
    .send({ name_en: name, address_en: "Main road", city_id: cityId });
  if (res.status === 200) createdLibraries.push(res.body.data.library.id);
  return res;
}

async function makeEntry(token: string, title = `Granth ${SUFFIX}`) {
  const res = await request(app)
    .post(`${BASE}/entries`)
    .set(auth(token))
    .send({ title_en: title });
  if (res.status === 200) createdEntries.push(res.body.data.entry.id);
  return res;
}

afterAll(async () => {
  if (createdEntries.length > 0) {
    await pool.query(`delete from granth_availability where granth_id = any($1::uuid[])`, [
      createdEntries,
    ]);
    await pool.query(`delete from granth_entries where id = any($1::uuid[])`, [createdEntries]);
  }
  if (createdLibraries.length > 0) {
    await pool.query(`delete from granth_availability where library_id = any($1::uuid[])`, [
      createdLibraries,
    ]);
    await pool.query(`delete from granth_libraries where id = any($1::uuid[])`, [
      createdLibraries,
    ]);
  }
});

describe("granth libraries — city scoping", () => {
  it("lets a city_admin create one in their own city and refuses another city", async () => {
    const { own, other } = await cityPair();
    const { token } = await loginAs("city_admin");

    const mine = await makeLibrary(token, own);
    expect(mine.status).toBe(200);
    expect(mine.body.data.library.draft.city_id).toBe(own);
    // Draft/publish: the row exists but readers cannot see it yet.
    expect(mine.body.data.library.is_published).toBe(false);

    const theirs = await makeLibrary(token, other, `Out of scope ${SUFFIX}`);
    expect(theirs.status).toBe(403);
    expect(theirs.body.error.code).toBe("ERR_FORBIDDEN");
  });

  it("refuses to let a city_admin move a library out of their city", async () => {
    const { own, other } = await cityPair();
    const { token } = await loginAs("city_admin");
    const created = await makeLibrary(token, own, `Movable ${SUFFIX}`);
    const id = created.body.data.library.id as string;

    // Checking only the CURRENT city would let this through and hand the row to
    // another city's admin; checking only the target would let them take one.
    const moved = await request(app)
      .patch(`${BASE}/libraries/${id}`)
      .set(auth(token))
      .send({ name_en: "Movable", address_en: "Main road", city_id: other });
    expect(moved.status).toBe(403);

    const still = await pool.query<{ draft_city_id: string }>(
      `select draft_city_id from granth_libraries where id = $1`,
      [id],
    );
    expect(still.rows[0]!.draft_city_id).toBe(own);
  });

  it("hides out-of-scope libraries from the list without relying on that for safety", async () => {
    const { own, other } = await cityPair();
    const state = await loginAs("state_admin");
    const outside = await makeLibrary(state.token, other, `Elsewhere ${SUFFIX}`);
    expect(outside.status).toBe(200);
    const outsideId = outside.body.data.library.id as string;
    const mine = await makeLibrary(state.token, own, `Here ${SUFFIX}`);
    const mineId = mine.body.data.library.id as string;

    const city = await loginAs("city_admin");
    const list = await request(app).get(`${BASE}/libraries`).set(auth(city.token));
    const ids = (list.body.data.libraries as Array<{ id: string }>).map((l) => l.id);
    expect(ids).toContain(mineId);
    expect(ids).not.toContain(outsideId);

    // The hidden row is still an id someone can type, so the write re-checks.
    const poke = await request(app)
      .post(`${BASE}/libraries/${outsideId}/publish`)
      .set(auth(city.token))
      .send({});
    expect(poke.status).toBe(403);
  });

  it("offers a city_admin only their own city in the picker", async () => {
    const { own } = await cityPair();
    const { token } = await loginAs("city_admin");
    const res = await request(app).get(`${BASE}/cities`).set(auth(token));
    expect(res.status).toBe(200);
    expect((res.body.data.cities as Array<{ id: string }>).map((c) => c.id)).toEqual([own]);
  });

  it("publishes draft to live and bumps content_version", async () => {
    const { own } = await cityPair();
    const { token } = await loginAs("city_admin");
    const created = await makeLibrary(token, own, `Publishable ${SUFFIX}`);
    const id = created.body.data.library.id as string;

    await request(app)
      .patch(`${BASE}/libraries/${id}`)
      .set(auth(token))
      .send({
        name_en: "Shri Jain Granth Bhandar",
        address_en: "12 Temple Road",
        city_id: own,
        timings_en: "9am - 6pm",
      });

    const beforePublish = await request(app).get(`${BASE}/libraries`).set(auth(token));
    const row = (beforePublish.body.data.libraries as Array<{ id: string; draft: { name_en: string }; published: { name_en: string } }>).find(
      (l) => l.id === id,
    )!;
    // Edits land in the draft and reach nobody until publish.
    expect(row.draft.name_en).toBe("Shri Jain Granth Bhandar");
    expect(row.published.name_en).toBe(`Publishable ${SUFFIX}`);

    const pub = await request(app)
      .post(`${BASE}/libraries/${id}/publish`)
      .set(auth(token))
      .send({});
    expect(pub.status).toBe(200);
    expect(pub.body.data.library.published.name_en).toBe("Shri Jain Granth Bhandar");
    // §17.7 — the bump is how a cached directory learns anything changed.
    expect(pub.body.data.library.content_version).toBe(2);
  });

  it("soft-deletes and drops the row from the public directory", async () => {
    const { own } = await cityPair();
    const { token } = await loginAs("city_admin");
    const created = await makeLibrary(token, own, `Doomed ${SUFFIX}`);
    const id = created.body.data.library.id as string;
    await request(app).post(`${BASE}/libraries/${id}/publish`).set(auth(token)).send({});

    const del = await request(app).delete(`${BASE}/libraries/${id}`).set(auth(token));
    expect(del.status).toBe(200);

    const row = await pool.query<{ deleted_at: string | null; is_published: boolean }>(
      `select deleted_at, is_published from granth_libraries where id = $1`,
      [id],
    );
    // Still there, and no longer live: soft delete, never a DELETE.
    expect(row.rows[0]!.deleted_at).not.toBeNull();
    expect(row.rows[0]!.is_published).toBe(false);
  });

  it("writes an audit entry for every action", async () => {
    const { own } = await cityPair();
    const { token } = await loginAs("city_admin");
    const created = await makeLibrary(token, own, `Audited ${SUFFIX}`);
    const id = created.body.data.library.id as string;
    await request(app).post(`${BASE}/libraries/${id}/publish`).set(auth(token)).send({});

    const rows = await pool.query<{ action: string }>(
      `select action from audit_logs
        where entity_kind = 'granth_library' and entity_id = $1
        order by created_at`,
      [id],
    );
    expect(rows.rows.map((r) => r.action)).toEqual(["create", "approve"]);
  });
});

describe("granth entries — state_admin and above", () => {
  it("refuses a city_admin and allows a state_admin", async () => {
    const city = await loginAs("city_admin");
    const denied = await request(app)
      .post(`${BASE}/entries`)
      .set(auth(city.token))
      .send({ title_en: "Kalpasutra" });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("ERR_FORBIDDEN");

    const state = await loginAs("state_admin");
    const allowed = await makeEntry(state.token, `Kalpasutra ${SUFFIX}`);
    expect(allowed.status).toBe(200);
  });

  it("lets a city_admin READ the entries list, flagged as read-only", async () => {
    const city = await loginAs("city_admin");
    const res = await request(app).get(`${BASE}/entries`).set(auth(city.token));
    expect(res.status).toBe(200);
    // The UI hides the write actions off this flag; the service refuses them
    // regardless, so the two can never disagree.
    expect(res.body.data.can_manage).toBe(false);

    const state = await loginAs("state_admin");
    const asState = await request(app).get(`${BASE}/entries`).set(auth(state.token));
    expect(asState.body.data.can_manage).toBe(true);
  });

  it("refuses a linked_item_id that does not exist", async () => {
    const state = await loginAs("state_admin");
    const res = await request(app)
      .post(`${BASE}/entries`)
      .set(auth(state.token))
      .send({
        title_en: `Bad link ${SUFFIX}`,
        linked_item_id: "11111111-1111-4111-8111-111111111111",
      });
    expect(res.status).toBe(404);
  });

  it("publishes draft to live and bumps content_version", async () => {
    const state = await loginAs("state_admin");
    const created = await makeEntry(state.token, `Versioned ${SUFFIX}`);
    const id = created.body.data.entry.id as string;

    await request(app)
      .patch(`${BASE}/entries/${id}`)
      .set(auth(state.token))
      .send({ title_en: "Tattvartha Sutra", author_en: "Umaswami" });

    const pub = await request(app)
      .post(`${BASE}/entries/${id}/publish`)
      .set(auth(state.token))
      .send({});
    expect(pub.status).toBe(200);
    expect(pub.body.data.entry.published.title_en).toBe("Tattvartha Sutra");
    expect(pub.body.data.entry.published.author_en).toBe("Umaswami");
    expect(pub.body.data.entry.content_version).toBe(2);
  });

  it("reorders on an ordered id array", async () => {
    const state = await loginAs("state_admin");
    const a = await makeEntry(state.token, `AAA ${SUFFIX}`);
    const b = await makeEntry(state.token, `BBB ${SUFFIX}`);
    const ids = [b.body.data.entry.id, a.body.data.entry.id];

    const res = await request(app)
      .post(`${BASE}/entries/reorder`)
      .set(auth(state.token))
      .send({ ids });
    expect(res.status).toBe(200);
    expect(res.body.data.reordered).toBe(2);

    const rows = await pool.query<{ id: string; draft_order: number }>(
      `select id, draft_order from granth_entries where id = any($1::uuid[]) order by draft_order`,
      [ids],
    );
    expect(rows.rows.map((r) => r.id)).toEqual(ids);
  });

  it("refuses a reorder from a city_admin", async () => {
    const state = await loginAs("state_admin");
    const a = await makeEntry(state.token, `Order guard ${SUFFIX}`);
    const city = await loginAs("city_admin");
    const res = await request(app)
      .post(`${BASE}/entries/reorder`)
      .set(auth(city.token))
      .send({ ids: [a.body.data.entry.id] });
    expect(res.status).toBe(403);
  });
});

describe("granth availability — governed by the library's city", () => {
  it("lets a city_admin shelve a state-owned granth in their own library", async () => {
    const { own } = await cityPair();
    const state = await loginAs("state_admin");
    const entry = await makeEntry(state.token, `Shelved ${SUFFIX}`);
    const entryId = entry.body.data.entry.id as string;

    const city = await loginAs("city_admin");
    const lib = await makeLibrary(city.token, own, `Shelf ${SUFFIX}`);
    const libId = lib.body.data.library.id as string;

    // §17.11.5 — the granth is a state record, but shelf facts belong to
    // whoever runs the shelf.
    const res = await request(app)
      .put(`${BASE}/entries/${entryId}/availability`)
      .set(auth(city.token))
      .send({ library_id: libId, note: "reference only, not for issue" });
    expect(res.status).toBe(200);
    const rows = res.body.data.availability as Array<{ library_id: string; note: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.note).toBe("reference only, not for issue");
  });

  it("refuses availability against a library in another city", async () => {
    const { other } = await cityPair();
    const state = await loginAs("state_admin");
    const entry = await makeEntry(state.token, `Elsewhere shelf ${SUFFIX}`);
    const outsideLib = await makeLibrary(state.token, other, `Far shelf ${SUFFIX}`);

    const city = await loginAs("city_admin");
    const res = await request(app)
      .put(`${BASE}/entries/${entry.body.data.entry.id}/availability`)
      .set(auth(city.token))
      .send({ library_id: outsideLib.body.data.library.id });
    expect(res.status).toBe(403);
  });

  it("updates the note in place rather than duplicating the row", async () => {
    const { own } = await cityPair();
    const state = await loginAs("state_admin");
    const entry = await makeEntry(state.token, `Note edit ${SUFFIX}`);
    const entryId = entry.body.data.entry.id as string;
    const city = await loginAs("city_admin");
    const lib = await makeLibrary(city.token, own, `Note shelf ${SUFFIX}`);
    const libId = lib.body.data.library.id as string;

    await request(app)
      .put(`${BASE}/entries/${entryId}/availability`)
      .set(auth(city.token))
      .send({ library_id: libId, note: "first" });
    const second = await request(app)
      .put(`${BASE}/entries/${entryId}/availability`)
      .set(auth(city.token))
      .send({ library_id: libId, note: "second" });

    const rows = second.body.data.availability as Array<{ note: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.note).toBe("second");
  });

  it("removes a shelving row", async () => {
    const { own } = await cityPair();
    const state = await loginAs("state_admin");
    const entry = await makeEntry(state.token, `Unshelve ${SUFFIX}`);
    const entryId = entry.body.data.entry.id as string;
    const city = await loginAs("city_admin");
    const lib = await makeLibrary(city.token, own, `Unshelve shelf ${SUFFIX}`);
    const libId = lib.body.data.library.id as string;

    await request(app)
      .put(`${BASE}/entries/${entryId}/availability`)
      .set(auth(city.token))
      .send({ library_id: libId });
    const res = await request(app)
      .delete(`${BASE}/entries/${entryId}/availability/${libId}`)
      .set(auth(city.token));
    expect(res.status).toBe(200);
    expect(res.body.data.availability).toEqual([]);
  });
});

describe("granth admin — role floor and validation", () => {
  it("keeps sanchalak and shikshak out entirely", async () => {
    for (const role of ["sanchalak", "shikshak"] as const) {
      const { token } = await loginAs(role);
      const res = await request(app).get(`${BASE}/libraries`).set(auth(token));
      expect(res.status, role).toBe(403);
    }
  });

  it("refuses half a coordinate", async () => {
    const { own } = await cityPair();
    const { token } = await loginAs("city_admin");
    // One without the other would send the maps hand-off to a point on the
    // equator or the prime meridian.
    const res = await request(app)
      .post(`${BASE}/libraries`)
      .set(auth(token))
      .send({ name_en: "Half", address_en: "Road", city_id: own, lat: 22.7 });
    expect(res.status).toBe(422);
  });

  it("refuses WhatsApp with no number to address", async () => {
    const { own } = await cityPair();
    const { token } = await loginAs("city_admin");
    const res = await request(app)
      .post(`${BASE}/libraries`)
      .set(auth(token))
      .send({ name_en: "No phone", address_en: "Road", city_id: own, has_whatsapp: true });
    expect(res.status).toBe(422);
  });

  it("refuses an out-of-range coordinate", async () => {
    const { own } = await cityPair();
    const { token } = await loginAs("city_admin");
    const res = await request(app)
      .post(`${BASE}/libraries`)
      .set(auth(token))
      .send({ name_en: "Bad", address_en: "Road", city_id: own, lat: 751.85, lng: 22.7 });
    expect(res.status).toBe(422);
  });
});
