/**
 * SPEC §17.1.3 / §17.7 — Tarj end to end on the server side.
 *
 * The interesting behaviour is not "the column round-trips" but that a Tarj
 * goes through the same draft gate as every other item field: an edit is
 * invisible to readers until publish, publish bumps content_version so offline
 * clients know to resync and rebuild their search index, and a Tarj on its own
 * never turns a contentless draft into something publishable.
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

type Fixture = { sectionId: string; itemId: string };

async function insertFixture(): Promise<Fixture> {
  const sec = await pool.query<{ id: string }>(
    `insert into library_sections
       (key, name_en, order_index, type, requires_login, is_published, content_version,
        draft_name_en, draft_type, draft_requires_login, draft_order_index)
     values ($1, 'Tarj Test', 2000, 'item_list', false, true, 1,
             'Tarj Test', 'item_list', false, 2000)
     returning id`,
    [`test_tarj_${SUFFIX}`],
  );
  const sectionId = sec.rows[0]!.id;

  // Published with text so it is a real, readable item; the Tarj is metadata on
  // top of that, never the thing that makes it readable.
  const item = await pool.query<{ id: string }>(
    `insert into library_items
       (section_id, item_code, title_en, title_hi, order_index,
        text_content_en, is_published, content_version,
        draft_title_en, draft_title_hi, draft_order_index, draft_text_content_en)
     values ($1, $2, 'Bhaktamar', 'भक्तामर', 0,
             '<p>Praise</p>', true, 1,
             'Bhaktamar', 'भक्तामर', 0, '<p>Praise</p>')
     returning id`,
    [sectionId, `tarj-${SUFFIX}`],
  );

  return { sectionId, itemId: item.rows[0]!.id };
}

async function cleanupFixture(fx: Fixture) {
  await pool.query(`delete from library_items where section_id = $1`, [fx.sectionId]);
  await pool.query(`delete from library_sections where id = $1`, [fx.sectionId]);
}

function publicItem(itemId: string) {
  return request(app).get(`/v1/public/library/items/${itemId}`);
}

describe("library item Tarj", () => {
  it("edits land in the draft and reach readers only on publish, with a version bump", async () => {
    const fx = await insertFixture();
    const { token } = await loginAs("super_admin");
    try {
      const before = await publicItem(fx.itemId);
      expect(before.status).toBe(200);
      expect(before.body.data.item.tarj_en).toBeNull();
      const versionBefore = before.body.data.item.content_version as number;

      const patch = await request(app)
        .patch(`/v1/admin/library/items/${fx.itemId}`)
        .set(auth(token))
        .send({ tarj_en: "Meri Bhavna", tarj_hi: "मेरी भावना" });
      expect(patch.status).toBe(200);
      expect(patch.body.data.item.draft.tarj_en).toBe("Meri Bhavna");
      // Published half untouched — this is the whole point of the draft gate.
      expect(patch.body.data.item.published.tarj_en).toBeNull();

      const stillOld = await publicItem(fx.itemId);
      expect(stillOld.body.data.item.tarj_en).toBeNull();
      expect(stillOld.body.data.item.tarj_hi).toBeNull();

      const pubRes = await request(app)
        .post(`/v1/admin/library/items/${fx.itemId}/publish`)
        .set(auth(token))
        .send({});
      expect(pubRes.status).toBe(200);

      const after = await publicItem(fx.itemId);
      expect(after.body.data.item.tarj_en).toBe("Meri Bhavna");
      expect(after.body.data.item.tarj_hi).toBe("मेरी भावना");
      // §17.7 — without the bump an offline client keeps its cached row and its
      // stale search index, and the Tarj never becomes findable on device.
      expect(after.body.data.item.content_version).toBe(versionBefore + 1);

      const manifest = await request(app).get("/v1/public/library/manifest");
      expect(manifest.status).toBe(200);
      expect(manifest.body.data.items[fx.itemId]).toBe(versionBefore + 1);
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("carries the Tarj into the section tree, not just the item endpoint", async () => {
    const fx = await insertFixture();
    const { token } = await loginAs("super_admin");
    try {
      await request(app)
        .patch(`/v1/admin/library/items/${fx.itemId}`)
        .set(auth(token))
        .send({ tarj_en: "Meri Bhavna" });
      await request(app)
        .post(`/v1/admin/library/items/${fx.itemId}/publish`)
        .set(auth(token))
        .send({});

      const tree = await request(app).get("/v1/public/library");
      const sections = tree.body.data.sections as Array<{
        id: string;
        items: Array<Record<string, unknown>>;
      }>;
      const section = sections.find((s) => s.id === fx.sectionId)!;
      const item = section.items.find((i) => i.id === fx.itemId)!;
      expect(item.tarj_en).toBe("Meri Bhavna");
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("collapses a pasted multi-line Tarj to one caption line", async () => {
    const fx = await insertFixture();
    const { token } = await loginAs("super_admin");
    try {
      const patch = await request(app)
        .patch(`/v1/admin/library/items/${fx.itemId}`)
        .set(auth(token))
        .send({ tarj_en: "  Meri\n\tBhavna   ki   tarj  " });
      expect(patch.status).toBe(200);
      expect(patch.body.data.item.draft.tarj_en).toBe("Meri Bhavna ki tarj");
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("treats a blank Tarj as cleared, not as an empty caption", async () => {
    const fx = await insertFixture();
    const { token } = await loginAs("super_admin");
    try {
      await request(app)
        .patch(`/v1/admin/library/items/${fx.itemId}`)
        .set(auth(token))
        .send({ tarj_en: "Meri Bhavna" });
      const cleared = await request(app)
        .patch(`/v1/admin/library/items/${fx.itemId}`)
        .set(auth(token))
        .send({ tarj_en: "   " });
      expect(cleared.status).toBe(200);
      // "" would render as a label with nothing after it; null renders nothing.
      expect(cleared.body.data.item.draft.tarj_en).toBeNull();
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("leaves the Tarj alone when a later edit does not mention it", async () => {
    const fx = await insertFixture();
    const { token } = await loginAs("super_admin");
    try {
      await request(app)
        .patch(`/v1/admin/library/items/${fx.itemId}`)
        .set(auth(token))
        .send({ tarj_en: "Meri Bhavna" });
      const titleOnly = await request(app)
        .patch(`/v1/admin/library/items/${fx.itemId}`)
        .set(auth(token))
        .send({ title_en: "Bhaktamar Stotra" });
      expect(titleOnly.body.data.item.draft.tarj_en).toBe("Meri Bhavna");
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("rejects a Tarj longer than the caption limit", async () => {
    const fx = await insertFixture();
    const { token } = await loginAs("super_admin");
    try {
      const res = await request(app)
        .patch(`/v1/admin/library/items/${fx.itemId}`)
        .set(auth(token))
        .send({ tarj_en: "x".repeat(201) });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("ERR_VALIDATION_FAILED");
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("is metadata, not a modality: a Tarj alone does not make a draft publishable", async () => {
    const fx = await insertFixture();
    const { token } = await loginAs("super_admin");
    try {
      const created = await request(app)
        .post("/v1/admin/library/items")
        .set(auth(token))
        .send({
          section_id: fx.sectionId,
          item_code: `tarj-only-${SUFFIX}`,
          title_en: "Melody but no content",
          tarj_en: "Meri Bhavna",
        });
      expect(created.status).toBe(200);
      const emptyId = created.body.data.item.id as string;
      expect(created.body.data.item.draft.tarj_en).toBe("Meri Bhavna");

      // §17.1.3 lists the modalities a published item must have one of, and the
      // Tarj is deliberately absent from that list.
      const pubRes = await request(app)
        .post(`/v1/admin/library/items/${emptyId}/publish`)
        .set(auth(token))
        .send({});
      expect(pubRes.status).toBeGreaterThanOrEqual(400);

      const stillDraft = await pool.query<{ is_published: boolean }>(
        `select is_published from library_items where id = $1`,
        [emptyId],
      );
      expect(stillDraft.rows[0]!.is_published).toBe(false);
    } finally {
      await cleanupFixture(fx);
    }
  });
});
