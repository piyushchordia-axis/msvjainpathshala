/**
 * SPEC §17.11.1–17.11.2 — the granth section type and the Online Granth feed.
 *
 * The claims worth pinning down: a granth section behaves as an ordinary
 * item_list on the wire (so the clients can render it with the existing rules
 * rather than a fork), the reverse cross-link counts only what a reader could
 * actually go and borrow, and the section type survives the admin write path so
 * renaming and publishing the seeded row is a data operation.
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

/**
 * library_sections has a UNIQUE index on order_index among live rows, so a
 * fixed value means one leaked fixture poisons every later test in the file
 * with a confusing duplicate-key error. A counter keeps a failure local to
 * the test that caused it.
 */
let nextOrderIndex = 4000;

type Fixture = {
  sectionId: string;
  itemId: string;
  otherItemId: string;
  entryId: string;
  libraryIds: string[];
  cityId: string;
};

async function anyCityId(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(`select id from cities limit 1`);
  if (!rows[0]) throw new Error("seed a city before running granth tests");
  return rows[0].id;
}

async function insertFixture(opts?: { publishLibraries?: boolean }): Promise<Fixture> {
  const publishLibraries = opts?.publishLibraries ?? true;
  const cityId = await anyCityId();

  const order = nextOrderIndex++;
  const sec = await pool.query<{ id: string }>(
    `insert into library_sections
       (key, name_en, order_index, type, requires_login, is_published, content_version,
        draft_name_en, draft_type, draft_requires_login, draft_order_index)
     values ($1, 'Granth Test', $2, 'granth', false, true, 1,
             'Granth Test', 'granth', false, $2)
     returning id`,
    [`test_granth_${SUFFIX}-${order}`, order],
  );
  const sectionId = sec.rows[0]!.id;

  const mk = async (code: string, title: string) => {
    const r = await pool.query<{ id: string }>(
      `insert into library_items
         (section_id, item_code, title_en, order_index, text_content_en,
          is_published, content_version, draft_title_en, draft_order_index,
          draft_text_content_en)
       values ($1, $2, $3, 0, '<p>x</p>', true, 1, $3, 0, '<p>x</p>')
       returning id`,
      [sectionId, code, title],
    );
    return r.rows[0]!.id;
  };
  const itemId = await mk(`granth-a-${SUFFIX}`, "Kalpasutra");
  const otherItemId = await mk(`granth-b-${SUFFIX}`, "Tattvartha Sutra");

  const libIds: string[] = [];
  for (const n of ["Shri Jain Library", "Sanghvi Granth Bhandar"]) {
    // 0079 added the draft_* twins as NOT NULL; a fixture that names only the
    // live columns no longer inserts.
    const r = await pool.query<{ id: string }>(
      `insert into granth_libraries
         (name_en, address_en, city_id, is_published, content_version,
          draft_name_en, draft_address_en, draft_city_id)
       values ($1, 'Main road', $2, $3, 1, $1, 'Main road', $2)
       returning id`,
      [`${n} ${SUFFIX}`, cityId, publishLibraries],
    );
    libIds.push(r.rows[0]!.id);
  }

  const entry = await pool.query<{ id: string }>(
    `insert into granth_entries
       (title_en, linked_item_id, is_published, content_version,
        draft_title_en, draft_linked_item_id)
     values ($1, $2, true, 1, $1, $2)
     returning id`,
    [`Kalpasutra ${SUFFIX}`, itemId],
  );
  const entryId = entry.rows[0]!.id;

  for (const libId of libIds) {
    await pool.query(
      `insert into granth_availability (granth_id, library_id) values ($1, $2)`,
      [entryId, libId],
    );
  }

  return { sectionId, itemId, otherItemId, entryId, libraryIds: libIds, cityId };
}

async function cleanupFixture(fx: Fixture) {
  await pool.query(`delete from granth_availability where granth_id = $1`, [fx.entryId]);
  await pool.query(`delete from granth_entries where id = $1`, [fx.entryId]);
  await pool.query(`delete from granth_libraries where id = any($1::uuid[])`, [fx.libraryIds]);
  await pool.query(
    `delete from library_access_logs
      where library_section_id = $1
         or library_item_id in (select id from library_items where section_id = $1)`,
    [fx.sectionId],
  );
  await pool.query(`delete from library_items where section_id = $1`, [fx.sectionId]);
  await pool.query(`delete from library_sections where id = $1`, [fx.sectionId]);
}

describe("granth section type", () => {
  it("ships in the public tree shaped exactly like an item_list", async () => {
    const fx = await insertFixture();
    try {
      const tree = await request(app).get("/v1/public/library");
      expect(tree.status).toBe(200);
      const sections = tree.body.data.sections as Array<{
        id: string;
        type: string;
        items: Array<{ id: string; text_content_en: string | null }>;
        subsections: unknown[];
      }>;
      const section = sections.find((s) => s.id === fx.sectionId)!;

      // The clients branch on this and nothing else — never on the name.
      expect(section.type).toBe("granth");
      // Items and subsections come through with the same payload an item_list
      // section gets, which is what lets the existing renderer handle both.
      expect(section.items.map((i) => i.id).sort()).toEqual(
        [fx.itemId, fx.otherItemId].sort(),
      );
      expect(section.items[0]!.text_content_en).toBeTruthy();
      expect(Array.isArray(section.subsections)).toBe(true);
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("survives the admin write path so the seeded row can be renamed and re-typed", async () => {
    const { token } = await loginAs("super_admin");
    const key = `test_granth_admin_${SUFFIX}`;
    let createdId: string | null = null;
    try {
      const res = await request(app)
        .post("/v1/admin/library/sections")
        .set(auth(token))
        .send({ key, name_en: "Shastra Bhandar", type: "granth" });
      expect(res.status).toBe(200);
      createdId = res.body.data.section.id as string;
      expect(res.body.data.section.draft.type).toBe("granth");
    } finally {
      if (createdId) {
        await pool.query(`delete from library_sections where id = $1`, [createdId]);
      }
    }
  });

  it("logs granth_view against the SECTION, not against its items", async () => {
    const fx = await insertFixture();
    const device = `dev-granth-${SUFFIX}`;
    try {
      // §17.9 defines granth_view as a section open. A section id is not an
      // item id, so before the log table gained a section target this report
      // matched nothing and vanished; spreading it across the section's items
      // instead would turn one open into one read per granth on the shelf.
      for (let i = 0; i < 2; i++) {
        const res = await request(app)
          .post("/v1/library/access")
          .set("X-Device-Id", device)
          .send({ section_id: fx.sectionId, event: "granth_view" });
        expect(res.status).toBe(202);
        expect(res.body.data.recorded).toBe(true);
      }

      const rows = await pool.query<{ access_count: number }>(
        `select access_count from library_access_logs
          where library_section_id = $1 and device_id = $2 and event = 'granth_view'`,
        [fx.sectionId, device],
      );
      expect(rows.rowCount).toBe(1);
      expect(rows.rows[0]!.access_count).toBe(2);

      // Nothing landed on the items.
      const itemRows = await pool.query(
        `select 1 from library_access_logs where library_item_id is not null
           and library_item_id = any($1::uuid[])`,
        [[fx.itemId, fx.otherItemId]],
      );
      expect(itemRows.rowCount).toBe(0);
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("refuses a report that names both targets, or neither", async () => {
    const fx = await insertFixture();
    try {
      const both = await request(app)
        .post("/v1/library/access")
        .set("X-Device-Id", `dev-both-${SUFFIX}`)
        .send({ item_id: fx.itemId, section_id: fx.sectionId, event: "granth_view" });
      expect(both.status).toBe(422);

      const neither = await request(app)
        .post("/v1/library/access")
        .set("X-Device-Id", `dev-neither-${SUFFIX}`)
        .send({ event: "granth_view" });
      expect(neither.status).toBe(422);
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("does not log an unpublished section", async () => {
    const fx = await insertFixture();
    try {
      await pool.query(`update library_sections set is_published = false where id = $1`, [
        fx.sectionId,
      ]);
      const res = await request(app)
        .post("/v1/library/access")
        .set("X-Device-Id", `dev-draft-sec-${SUFFIX}`)
        .send({ section_id: fx.sectionId, event: "granth_view" });
      expect(res.status).toBe(202);
      expect(res.body.data.recorded).toBe(false);
    } finally {
      await cleanupFixture(fx);
    }
  });
});

describe("granth availability cross-link", () => {
  it("reports the libraries that hold an item, and omits items nothing holds", async () => {
    const fx = await insertFixture();
    try {
      const res = await request(app).get(
        `/v1/library/granth/availability?section_id=${fx.sectionId}`,
      );
      expect(res.status).toBe(200);
      const items = res.body.data.items as Record<
        string,
        { library_count: number; library_ids: string[] }
      >;
      expect(items[fx.itemId]!.library_count).toBe(2);
      expect(items[fx.itemId]!.library_ids.sort()).toEqual([...fx.libraryIds].sort());
      // "Available at 0 libraries" would read as a promise the directory cannot
      // keep — an item with nowhere to borrow is simply absent.
      expect(items[fx.otherItemId]).toBeUndefined();
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("counts a library once even when two entries point at it", async () => {
    const fx = await insertFixture();
    try {
      const second = await pool.query<{ id: string }>(
        `insert into granth_entries
           (title_en, linked_item_id, is_published, content_version,
            draft_title_en, draft_linked_item_id)
         values ($1, $2, true, 1, $1, $2) returning id`,
        [`Kalpasutra vol 2 ${SUFFIX}`, fx.itemId],
      );
      const secondId = second.rows[0]!.id;
      await pool.query(
        `insert into granth_availability (granth_id, library_id) values ($1, $2)`,
        [secondId, fx.libraryIds[0]],
      );

      const res = await request(app).get(
        `/v1/library/granth/availability?section_id=${fx.sectionId}`,
      );
      const entry = res.body.data.items[fx.itemId] as { library_count: number };
      // Two entries at one library is still one place to walk to.
      expect(entry.library_count).toBe(2);

      await pool.query(`delete from granth_availability where granth_id = $1`, [secondId]);
      await pool.query(`delete from granth_entries where id = $1`, [secondId]);
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("ignores unpublished libraries — a reader must not be sent to a closed door", async () => {
    const fx = await insertFixture({ publishLibraries: false });
    try {
      const res = await request(app).get(
        `/v1/library/granth/availability?section_id=${fx.sectionId}`,
      );
      expect(res.body.data.items[fx.itemId]).toBeUndefined();
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("ignores unpublished granth entries", async () => {
    const fx = await insertFixture();
    try {
      await pool.query(`update granth_entries set is_published = false where id = $1`, [
        fx.entryId,
      ]);
      const res = await request(app).get(
        `/v1/library/granth/availability?section_id=${fx.sectionId}`,
      );
      expect(res.body.data.items[fx.itemId]).toBeUndefined();
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("does not answer for a gated section's items when the caller is a guest", async () => {
    const fx = await insertFixture();
    try {
      await pool.query(
        `update library_sections set requires_login = true where id = $1`,
        [fx.sectionId],
      );

      // A guest gets the section as a shell with no items — so no ids, and no
      // way to probe which items exist behind the gate.
      const guest = await request(app).get(
        `/v1/library/granth/availability?section_id=${fx.sectionId}`,
      );
      expect(guest.status).toBe(200);
      expect(guest.body.data.items).toEqual({});

      const { token } = await loginAs("parent");
      const member = await request(app)
        .get(`/v1/library/granth/availability?section_id=${fx.sectionId}`)
        .set(auth(token));
      expect(member.body.data.items[fx.itemId]!.library_count).toBe(2);
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("422s without a section_id rather than scanning the whole catalogue", async () => {
    const res = await request(app).get("/v1/library/granth/availability");
    expect(res.status).toBe(422);
  });
});

describe("granth directory", () => {
  it("serves libraries, entries and the join to a guest in one payload", async () => {
    const fx = await insertFixture();
    try {
      const res = await request(app).get(
        `/v1/library/granth/directory?section_id=${fx.sectionId}`,
      );
      expect(res.status).toBe(200);
      const { libraries, entries, availability } = res.body.data as {
        libraries: Array<{ id: string; city_name: string; lat: number | null }>;
        entries: Array<{ id: string; linked_item_id: string | null }>;
        availability: Array<{ granth_id: string; library_id: string }>;
      };

      // The directory is a GLOBAL payload by design (§17.11.4 — one payload,
      // browsable offline); section_id is only the auth gate. So narrow to this
      // fixture's rows before asserting. Absolute equality here also swept in
      // the seeded MSV Granth Bhandar library and its two entries.
      const ourLibraries = libraries.filter((l) => fx.libraryIds.includes(l.id));
      const ourEntries = entries.filter((e) => e.id === fx.entryId);
      const ourAvailability = availability.filter((a) => a.granth_id === fx.entryId);

      expect(ourLibraries.map((l) => l.id).sort()).toEqual([...fx.libraryIds].sort());
      // Denormalised so the client can group and filter with no network and
      // no cities table of its own. Indexed by id, not position — `libraries[0]`
      // was asserting against the seeded row, so it passed without testing the
      // fixture at all.
      expect(ourLibraries.find((l) => l.id === fx.libraryIds[0])!.city_name).toBeTruthy();
      expect(ourEntries.map((e) => e.id)).toEqual([fx.entryId]);
      expect(ourEntries[0]!.linked_item_id).toBe(fx.itemId);
      expect(ourAvailability).toHaveLength(2);
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("returns numbers for coordinates, not the strings Postgres hands back", async () => {
    const fx = await insertFixture();
    try {
      await pool.query(
        `update granth_libraries set lat = 22.7196, lng = 75.8577 where id = $1`,
        [fx.libraryIds[0]],
      );
      const res = await request(app).get(
        `/v1/library/granth/directory?section_id=${fx.sectionId}`,
      );
      const lib = (res.body.data.libraries as Array<{ id: string; lat: unknown }>).find(
        (l) => l.id === fx.libraryIds[0],
      )!;
      // A string here would make every coordinate check on the client
      // (including the (0,0) guard) compare against "0" and pass silently.
      expect(typeof lib.lat).toBe("number");
      expect(lib.lat).toBeCloseTo(22.7196, 4);
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("omits unpublished libraries and entries, and joins that point at them", async () => {
    const fx = await insertFixture();
    try {
      await pool.query(`update granth_libraries set is_published = false where id = $1`, [
        fx.libraryIds[0],
      ]);
      const res = await request(app).get(
        `/v1/library/granth/directory?section_id=${fx.sectionId}`,
      );
      const data = res.body.data as {
        libraries: Array<{ id: string }>;
        availability: Array<{ library_id: string }>;
      };
      // Assert ABSENCE of the unpublished one and presence of the other. The
      // old absolute toEqual compared against the whole global directory, so it
      // was really asserting the seed's contents, not the fixture's.
      const libraryIds = data.libraries.map((l) => l.id);
      expect(libraryIds).not.toContain(fx.libraryIds[0]);
      expect(libraryIds).toContain(fx.libraryIds[1]);
      // A join row pointing at a library the reader cannot see would render
      // as a place to go that does not exist for them.
      const availLibraryIds = data.availability.map((a) => a.library_id);
      expect(availLibraryIds).not.toContain(fx.libraryIds[0]);
      expect(availLibraryIds).toContain(fx.libraryIds[1]);
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("respects the parent section's gate rather than inventing one", async () => {
    const fx = await insertFixture();
    try {
      await pool.query(`update library_sections set requires_login = true where id = $1`, [
        fx.sectionId,
      ]);
      const guest = await request(app).get(
        `/v1/library/granth/directory?section_id=${fx.sectionId}`,
      );
      // 403, not an empty directory: "no libraries listed" would read as an
      // empty shelf when the real answer is "sign in".
      expect(guest.status).toBe(403);

      const { token } = await loginAs("parent");
      const member = await request(app)
        .get(`/v1/library/granth/directory?section_id=${fx.sectionId}`)
        .set(auth(token));
      expect(member.status).toBe(200);
      // Both fixture libraries are visible once signed in. Counted within the
      // fixture, not across the global directory, which also carries the seed's.
      const visible = (member.body.data.libraries as Array<{ id: string }>).filter((l) =>
        fx.libraryIds.includes(l.id),
      );
      expect(visible).toHaveLength(2);
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("404s for a section that is not a granth section", async () => {
    const fx = await insertFixture();
    try {
      await pool.query(`update library_sections set type = 'item_list' where id = $1`, [
        fx.sectionId,
      ]);
      const res = await request(app).get(
        `/v1/library/granth/directory?section_id=${fx.sectionId}`,
      );
      expect(res.status).toBe(404);
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("versions the directory in the manifest so devices learn about edits", async () => {
    const fx = await insertFixture();
    try {
      const before = await request(app).get("/v1/public/library/manifest");
      expect(before.status).toBe(200);
      expect(before.body.data.granth_libraries[fx.libraryIds[0]!]).toBe(1);
      expect(before.body.data.granth_entries[fx.entryId]).toBe(1);

      // §17.7 — without this bump a corrected address never reaches a device
      // that already holds the directory, and its search index stays stale.
      await pool.query(
        `update granth_libraries set content_version = content_version + 1 where id = $1`,
        [fx.libraryIds[0]],
      );
      const after = await request(app).get("/v1/public/library/manifest");
      expect(after.body.data.granth_libraries[fx.libraryIds[0]!]).toBe(2);
    } finally {
      await cleanupFixture(fx);
    }
  });
});
