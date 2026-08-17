import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth } from "./helpers";

afterAll(async () => {
  await pool.end();
});

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function insertFixture(): Promise<{
  publicSectionId: string;
  gatedSectionId: string;
  subsectionId: string;
  itemIds: string[];
}> {
  const pubKey = `test_pub_${SUFFIX}`;
  const gatedKey = `test_gated_${SUFFIX}`;

  const pub = await pool.query<{ id: string }>(
    `insert into library_sections
       (key, name_en, name_hi, name_gu, order_index, type, requires_login, is_published, content_version,
        draft_name_en, draft_name_hi, draft_name_gu, draft_type, draft_requires_login, draft_order_index)
     values ($1, 'Public List', 'सार्वजनिक', 'સાર્વજનિક', 1000, 'item_list', false, true, 1,
             'Public List', 'सार्वजनिक', 'સાર્વજનિક', 'item_list', false, 1000)
     returning id`,
    [pubKey],
  );
  const gated = await pool.query<{ id: string }>(
    `insert into library_sections
       (key, name_en, order_index, type, requires_login, is_published, content_version,
        draft_name_en, draft_type, draft_requires_login, draft_order_index)
     values ($1, 'Members Only', 1001, 'item_list', true, true, 1,
             'Members Only', 'item_list', true, 1001)
     returning id`,
    [gatedKey],
  );
  const publicSectionId = pub.rows[0]!.id;
  const gatedSectionId = gated.rows[0]!.id;

  const sub = await pool.query<{ id: string }>(
    `insert into library_subsections
       (section_id, name_en, name_hi, order_index, is_published, content_version,
        draft_name_en, draft_name_hi, draft_order_index)
     values ($1, 'Group A', 'समूह अ', 0, true, 1, 'Group A', 'समूह अ', 0)
     returning id`,
    [publicSectionId],
  );
  const subsectionId = sub.rows[0]!.id;

  const item1 = await pool.query<{ id: string }>(
    `insert into library_items
       (section_id, subsection_id, item_code, title_en, title_hi, order_index,
        youtube_url, is_published, content_version,
        draft_title_en, draft_title_hi, draft_order_index, draft_youtube_url)
     values ($1, $2, $3, 'Video item', 'वीडियो', 0,
             'https://www.youtube.com/watch?v=dQw4w9WgXcQ', true, 1,
             'Video item', 'वीडियो', 0, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')
     returning id`,
    [publicSectionId, subsectionId, `vid-${SUFFIX}`],
  );
  const item2 = await pool.query<{ id: string }>(
    `insert into library_items
       (section_id, subsection_id, item_code, title_en, order_index,
        audio_url, audio_size_bytes, is_published, content_version,
        draft_title_en, draft_order_index, draft_audio_url, draft_audio_size_bytes)
     values ($1, $2, $3, 'Audio item', 1,
             'https://example.org/a.mp3', 1024, true, 1,
             'Audio item', 1, 'https://example.org/a.mp3', 1024)
     returning id`,
    [publicSectionId, subsectionId, `aud-${SUFFIX}`],
  );

  await pool.query(
    `insert into library_items
       (section_id, item_code, title_en, order_index, text_content_en, is_published, content_version,
        draft_title_en, draft_order_index, draft_text_content_en)
     values ($1, $2, 'Loose text', 0, '<p>Hello</p>', true, 1,
             'Loose text', 0, '<p>Hello</p>')`,
    [publicSectionId, `txt-${SUFFIX}`],
  );

  const gatedItem = await pool.query<{ id: string }>(
    `insert into library_items
       (section_id, item_code, title_en, order_index, text_content_en, is_published, content_version,
        draft_title_en, draft_order_index, draft_text_content_en)
     values ($1, $2, 'Gated only', 0, '<p>Secret</p>', true, 1,
             'Gated only', 0, '<p>Secret</p>')
     returning id`,
    [gatedSectionId, `gated-${SUFFIX}`],
  );

  return {
    publicSectionId,
    gatedSectionId,
    subsectionId,
    itemIds: [item1.rows[0]!.id, item2.rows[0]!.id],
    gatedItemId: gatedItem.rows[0]!.id,
  };
}

async function cleanupFixture(ids: { publicSectionId: string; gatedSectionId: string }) {
  await pool.query(`delete from library_items where section_id = any($1::uuid[])`, [
    [ids.publicSectionId, ids.gatedSectionId],
  ]);
  await pool.query(`delete from library_subsections where section_id = any($1::uuid[])`, [
    [ids.publicSectionId, ids.gatedSectionId],
  ]);
  await pool.query(`delete from library_sections where id = any($1::uuid[])`, [
    [ids.publicSectionId, ids.gatedSectionId],
  ]);
}

describe("library browsing tree", () => {
  it("requires auth on the member feed", async () => {
    const res = await request(app).get("/v1/library");
    expect(res.status).toBe(401);
  });

  it("returns 501 on library writes", async () => {
    const { token } = await loginAs("super_admin");
    const res = await request(app).post("/v1/library").set(auth(token)).send({});
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe("ERR_INTERNAL");
  });

  it("has the rebuilt tables and dropped access logs", async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public'
         and table_name = any($1::text[])
       order by table_name`,
      [["library_items", "library_sections", "library_subsections"]],
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      "library_items",
      "library_sections",
      "library_subsections",
    ]);

    const dropped = await pool.query<{ exists: boolean }>(
      `select exists(
         select 1 from information_schema.tables
         where table_schema = 'public' and table_name = 'library_access_logs'
       ) as exists`,
    );
    expect(dropped.rows[0]?.exists).toBe(false);
  });

  it("public tree lists gated sections without children; member sees content", async () => {
    const fx = await insertFixture();
    try {
      const pub = await request(app).get("/v1/public/library");
      expect(pub.status).toBe(200);
      const publicSections = pub.body.data.sections as Array<{
        id: string;
        order_index: number;
        requires_login: boolean;
        subsections: Array<{ id: string; items: Array<{ id: string }> }>;
        items: Array<{ id: string; item_code: string }>;
      }>;

      const pubIds = publicSections.map((s) => s.id);
      expect(pubIds).toContain(fx.publicSectionId);
      expect(pubIds).toContain(fx.gatedSectionId);

      for (let i = 1; i < publicSections.length; i++) {
        expect(publicSections[i]!.order_index).toBeGreaterThanOrEqual(
          publicSections[i - 1]!.order_index,
        );
      }

      const openSec = publicSections.find((s) => s.id === fx.publicSectionId)!;
      expect(openSec.subsections.length).toBe(1);
      expect(openSec.subsections[0]!.items.map((i) => i.id)).toEqual(fx.itemIds);
      expect(openSec.items.some((i) => i.item_code.startsWith("txt-"))).toBe(true);

      const gatedSec = publicSections.find((s) => s.id === fx.gatedSectionId)!;
      expect(gatedSec.requires_login).toBe(true);
      expect(gatedSec.subsections).toEqual([]);
      expect(gatedSec.items).toEqual([]);

      const { token } = await loginAs("parent");
      const mem = await request(app).get("/v1/library").set(auth(token));
      expect(mem.status).toBe(200);
      const memberSections = mem.body.data.sections as Array<{ id: string }>;
      expect(memberSections.map((s) => s.id)).toEqual(
        expect.arrayContaining([fx.publicSectionId, fx.gatedSectionId]),
      );
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("member tree includes requires_login published sections", async () => {
    const fx = await insertFixture();
    try {
      const { token } = await loginAs("parent");
      const res = await request(app).get("/v1/library").set(auth(token));
      expect(res.status).toBe(200);
      const sections = res.body.data.sections as Array<{ id: string }>;
      const ids = sections.map((s) => s.id);
      expect(ids).toContain(fx.publicSectionId);
      expect(ids).toContain(fx.gatedSectionId);
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("manifest: guest omits gated items; member includes section versions", async () => {
    const fx = await insertFixture();
    try {
      const pub = await request(app).get("/v1/public/library/manifest");
      expect(pub.status).toBe(200);
      const guest = pub.body.data as {
        sections: Record<string, number>;
        items: Record<string, number>;
      };
      expect(guest.sections[fx.publicSectionId]).toBe(1);
      expect(guest.sections[fx.gatedSectionId]).toBe(1);
      for (const id of fx.itemIds) {
        expect(guest.items[id]).toBe(1);
      }

      // Gated section has no public items in fixture — ensure no stray gated item ids.
      const gatedItems = await pool.query<{ id: string }>(
        `select id from library_items where section_id = $1`,
        [fx.gatedSectionId],
      );
      for (const row of gatedItems.rows) {
        expect(guest.items[row.id]).toBeUndefined();
      }

      const { token } = await loginAs("parent");
      const mem = await request(app).get("/v1/library/manifest").set(auth(token));
      expect(mem.status).toBe(200);
      const member = mem.body.data as {
        sections: Record<string, number>;
        items: Record<string, number>;
      };
      expect(member.sections[fx.publicSectionId]).toBe(1);
      expect(member.sections[fx.gatedSectionId]).toBe(1);
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("GET section returns nested DTO; 404 when missing", async () => {
    const fx = await insertFixture();
    try {
      const res = await request(app).get(`/v1/public/library/sections/${fx.publicSectionId}`);
      expect(res.status).toBe(200);
      const section = res.body.data.section as {
        id: string;
        subsections: Array<{ items: Array<{ id: string }> }>;
        items: Array<{ id: string }>;
      };
      expect(section.id).toBe(fx.publicSectionId);
      expect(section.subsections[0]!.items.map((i) => i.id)).toEqual(fx.itemIds);

      const gated = await request(app).get(`/v1/public/library/sections/${fx.gatedSectionId}`);
      expect(gated.status).toBe(200);
      expect(gated.body.data.section.subsections).toEqual([]);
      expect(gated.body.data.section.items).toEqual([]);

      const missing = await request(app).get(
        "/v1/public/library/sections/00000000-0000-4000-8000-000000000000",
      );
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe("ERR_NOT_FOUND");

      // Non-UUID ids 404 without touching the query (hardening).
      const junk = await request(app).get("/v1/public/library/sections/not-a-uuid");
      expect(junk.status).toBe(404);
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("GET item returns the deep-link unit; gated is guest-404 but member-visible", async () => {
    const fx = await insertFixture();
    try {
      // The scoped item endpoint exists so a cold deep-link ships ONE item,
      // not the whole corpus (GST-PRF-01).
      const pub = await request(app).get(`/v1/public/library/items/${fx.itemIds[0]}`);
      expect(pub.status).toBe(200);
      expect(pub.body.data.item.id).toBe(fx.itemIds[0]);
      expect(pub.body.data.item.section_id).toBe(fx.publicSectionId);

      // A guest deep link into a login-gated section reads as not-found.
      const gatedGuest = await request(app).get(`/v1/public/library/items/${fx.gatedItemId}`);
      expect(gatedGuest.status).toBe(404);

      const { token } = await loginAs("parent");
      const gatedMember = await request(app)
        .get(`/v1/library/items/${fx.gatedItemId}`)
        .set(auth(token));
      expect(gatedMember.status).toBe(200);
      expect(gatedMember.body.data.item.id).toBe(fx.gatedItemId);

      const junk = await request(app).get("/v1/public/library/items/not-a-uuid");
      expect(junk.status).toBe(404);
    } finally {
      await cleanupFixture(fx);
    }
  });
});
