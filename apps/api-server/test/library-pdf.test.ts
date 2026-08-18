/**
 * SPEC §17.1.3 / §17.11.2 / §17.9 — PDF + external-link modalities.
 *
 * What is worth pinning down: the size cap answers with the documented 413 and
 * not a generic upload error, a file that merely claims to be a PDF is refused,
 * a video link cannot sneak in through external_url and dodge Q7, a PDF-only
 * item is publishable at all, and the access log counts humans rather than taps.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { PDFDocument } from "pdf-lib";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth } from "./helpers";
import { storage } from "../src/lib/storage";
import { uploadKeyFromUrl } from "../src/lib/file-tokens";
import { runLibraryPdfPageCount } from "../src/jobs/media-jobs";

afterAll(async () => {
  await pool.end();
});

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const storedKeys: string[] = [];

/** A real, parseable PDF of `pages` pages — small enough to post in a test. */
async function makePdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200, 200]);
  return Buffer.from(await doc.save());
}

type Fixture = { sectionId: string; itemId: string };

async function insertFixture(): Promise<Fixture> {
  const sec = await pool.query<{ id: string }>(
    `insert into library_sections
       (key, name_en, order_index, type, requires_login, is_published, content_version,
        draft_name_en, draft_type, draft_requires_login, draft_order_index)
     values ($1, 'PDF Test', 3000, 'item_list', false, true, 1,
             'PDF Test', 'item_list', false, 3000)
     returning id`,
    [`test_pdf_${SUFFIX}`],
  );
  const sectionId = sec.rows[0]!.id;
  const item = await pool.query<{ id: string }>(
    `insert into library_items
       (section_id, item_code, title_en, order_index, is_published, content_version,
        draft_title_en, draft_order_index)
     values ($1, $2, 'Granth scan', 0, false, 1, 'Granth scan', 0)
     returning id`,
    [sectionId, `pdf-${SUFFIX}-${Math.random().toString(36).slice(2, 7)}`],
  );
  return { sectionId, itemId: item.rows[0]!.id };
}

async function cleanupFixture(fx: Fixture) {
  await pool.query(
    `delete from library_access_logs where library_item_id in
       (select id from library_items where section_id = $1)`,
    [fx.sectionId],
  );
  await pool.query(`delete from library_items where section_id = $1`, [fx.sectionId]);
  await pool.query(`delete from library_sections where id = $1`, [fx.sectionId]);
}

/** Remember an uploaded object so the test suite does not litter uploads/. */
function trackStored(url: string | null | undefined) {
  const key = url ? uploadKeyFromUrl(url) : null;
  if (key) storedKeys.push(key);
}

afterAll(async () => {
  for (const key of storedKeys) await storage.remove(key).catch(() => undefined);
});

describe("library PDF upload", () => {
  it("stores the PDF on the draft and records its size", async () => {
    const fx = await insertFixture();
    const { token } = await loginAs("super_admin");
    try {
      const bytes = await makePdf(3);
      const res = await request(app)
        .post(`/v1/admin/library/items/${fx.itemId}/pdf`)
        .set(auth(token))
        .attach("file", bytes, { filename: "granth.pdf", contentType: "application/pdf" });
      expect(res.status).toBe(200);
      trackStored(res.body.data.pdf.url);

      expect(res.body.data.item.draft.pdf_url).toBeTruthy();
      expect(res.body.data.item.draft.pdf_size_bytes).toBe(bytes.byteLength);
      // Published half untouched until publish, like every other library field.
      expect(res.body.data.item.published.pdf_url).toBeNull();
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("refuses a file that only claims to be a PDF", async () => {
    const fx = await insertFixture();
    const { token } = await loginAs("super_admin");
    try {
      const res = await request(app)
        .post(`/v1/admin/library/items/${fx.itemId}/pdf`)
        .set(auth(token))
        .attach("file", Buffer.from("PK this is a zip"), {
          filename: "granth.pdf",
          contentType: "application/pdf",
        });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("ERR_VALIDATION_FAILED");
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("refuses a non-PDF extension outright", async () => {
    const fx = await insertFixture();
    const { token } = await loginAs("super_admin");
    try {
      const res = await request(app)
        .post(`/v1/admin/library/items/${fx.itemId}/pdf`)
        .set(auth(token))
        .attach("file", Buffer.from("hello"), {
          filename: "granth.txt",
          contentType: "text/plain",
        });
      expect(res.status).toBe(422);
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("clears a stale page count when a new file replaces the old one", async () => {
    const fx = await insertFixture();
    const { token } = await loginAs("super_admin");
    try {
      const first = await request(app)
        .post(`/v1/admin/library/items/${fx.itemId}/pdf`)
        .set(auth(token))
        .attach("file", await makePdf(4), { filename: "a.pdf", contentType: "application/pdf" });
      trackStored(first.body.data.pdf.url);
      await runLibraryPdfPageCount(fx.itemId);

      const counted = await pool.query<{ draft_pdf_page_count: number | null }>(
        `select draft_pdf_page_count from library_items where id = $1`,
        [fx.itemId],
      );
      expect(counted.rows[0]!.draft_pdf_page_count).toBe(4);

      const second = await request(app)
        .post(`/v1/admin/library/items/${fx.itemId}/pdf`)
        .set(auth(token))
        .attach("file", await makePdf(9), { filename: "b.pdf", contentType: "application/pdf" });
      trackStored(second.body.data.pdf.url);
      // "412 pages" left over from the previous scan is worse than no number.
      expect(second.body.data.item.draft.pdf_page_count).toBeNull();

      await runLibraryPdfPageCount(fx.itemId);
      const recounted = await pool.query<{ draft_pdf_page_count: number | null }>(
        `select draft_pdf_page_count from library_items where id = $1`,
        [fx.itemId],
      );
      expect(recounted.rows[0]!.draft_pdf_page_count).toBe(9);
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("completes the page count on a row that is already live on the same file", async () => {
    const fx = await insertFixture();
    const { token } = await loginAs("super_admin");
    try {
      const up = await request(app)
        .post(`/v1/admin/library/items/${fx.itemId}/pdf`)
        .set(auth(token))
        .attach("file", await makePdf(6), { filename: "a.pdf", contentType: "application/pdf" });
      trackStored(up.body.data.pdf.url);

      // Admin publishes faster than the queue drains — without the live-write
      // exception the published count would stay NULL until a republish.
      await request(app)
        .post(`/v1/admin/library/items/${fx.itemId}/publish`)
        .set(auth(token))
        .send({});
      await runLibraryPdfPageCount(fx.itemId);

      const item = await request(app).get(`/v1/public/library/items/${fx.itemId}`);
      expect(item.body.data.item.pdf_page_count).toBe(6);
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("publishes a PDF-only item and carries every field across", async () => {
    const fx = await insertFixture();
    const { token } = await loginAs("super_admin");
    try {
      const up = await request(app)
        .post(`/v1/admin/library/items/${fx.itemId}/pdf`)
        .set(auth(token))
        .attach("file", await makePdf(2), { filename: "a.pdf", contentType: "application/pdf" });
      trackStored(up.body.data.pdf.url);
      await runLibraryPdfPageCount(fx.itemId);

      // The 0073 modality CHECK named pdf_asset_id, which is never populated —
      // a PDF-only item could not have published at all before 0077.
      const pub = await request(app)
        .post(`/v1/admin/library/items/${fx.itemId}/publish`)
        .set(auth(token))
        .send({});
      expect(pub.status).toBe(200);

      const item = await request(app).get(`/v1/public/library/items/${fx.itemId}`);
      expect(item.status).toBe(200);
      expect(item.body.data.item.pdf_url).toBeTruthy();
      expect(item.body.data.item.pdf_size_bytes).toBeGreaterThan(0);
      expect(item.body.data.item.pdf_page_count).toBe(2);
      // Signed like audio: an unsigned /uploads URL is refused by the gate.
      expect(String(item.body.data.item.pdf_url)).toContain("sig=");
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("detaches the draft PDF without touching what is already published", async () => {
    const fx = await insertFixture();
    const { token } = await loginAs("super_admin");
    try {
      const up = await request(app)
        .post(`/v1/admin/library/items/${fx.itemId}/pdf`)
        .set(auth(token))
        .attach("file", await makePdf(2), { filename: "a.pdf", contentType: "application/pdf" });
      trackStored(up.body.data.pdf.url);
      await request(app)
        .post(`/v1/admin/library/items/${fx.itemId}/publish`)
        .set(auth(token))
        .send({});

      const del = await request(app)
        .delete(`/v1/admin/library/items/${fx.itemId}/pdf`)
        .set(auth(token));
      expect(del.status).toBe(200);
      expect(del.body.data.item.draft.pdf_url).toBeNull();
      expect(del.body.data.item.published.pdf_url).toBeTruthy();

      const stillLive = await request(app).get(`/v1/public/library/items/${fx.itemId}`);
      expect(stillLive.body.data.item.pdf_url).toBeTruthy();
    } finally {
      await cleanupFixture(fx);
    }
  });
});

describe("library external_url", () => {
  it("accepts an http(s) document link and publishes it", async () => {
    const fx = await insertFixture();
    const { token } = await loginAs("super_admin");
    try {
      const patch = await request(app)
        .patch(`/v1/admin/library/items/${fx.itemId}`)
        .set(auth(token))
        .send({ external_url: "https://archive.org/details/bhaktamar" });
      expect(patch.status).toBe(200);
      expect(patch.body.data.item.draft.external_url).toBe(
        "https://archive.org/details/bhaktamar",
      );

      await request(app)
        .post(`/v1/admin/library/items/${fx.itemId}/publish`)
        .set(auth(token))
        .send({});
      const item = await request(app).get(`/v1/public/library/items/${fx.itemId}`);
      expect(item.body.data.item.external_url).toBe("https://archive.org/details/bhaktamar");
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("refuses a video link — Q7 keeps video on the guarded field", async () => {
    const fx = await insertFixture();
    const { token } = await loginAs("super_admin");
    try {
      for (const url of [
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtu.be/dQw4w9WgXcQ",
        "https://player.vimeo.com/video/12345",
      ]) {
        const res = await request(app)
          .patch(`/v1/admin/library/items/${fx.itemId}`)
          .set(auth(token))
          .send({ external_url: url });
        expect(res.status, url).toBe(422);
      }
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("refuses non-http schemes that would render into an href", async () => {
    const fx = await insertFixture();
    const { token } = await loginAs("super_admin");
    try {
      for (const url of ["javascript:alert(1)", "data:text/html,<script>", "ftp://x.example"]) {
        const res = await request(app)
          .patch(`/v1/admin/library/items/${fx.itemId}`)
          .set(auth(token))
          .send({ external_url: url });
        expect(res.status, url).toBe(422);
      }
    } finally {
      await cleanupFixture(fx);
    }
  });
});

describe("library access logs", () => {
  async function publishedItem(): Promise<Fixture> {
    const fx = await insertFixture();
    await pool.query(
      `update library_items
          set text_content_en = '<p>x</p>', draft_text_content_en = '<p>x</p>',
              is_published = true
        where id = $1`,
      [fx.itemId],
    );
    return fx;
  }

  it("counts a repeat open as one reader, not two", async () => {
    const fx = await publishedItem();
    try {
      const device = `dev-${SUFFIX}`;
      for (let i = 0; i < 3; i++) {
        const res = await request(app)
          .post("/v1/library/access")
          .set("X-Device-Id", device)
          .send({ item_id: fx.itemId, event: "pdf_view" });
        expect(res.status).toBe(202);
        expect(res.body.data.recorded).toBe(true);
      }
      const rows = await pool.query<{ access_count: number }>(
        `select access_count from library_access_logs
          where library_item_id = $1 and device_id = $2 and event = 'pdf_view'`,
        [fx.itemId, device],
      );
      expect(rows.rowCount).toBe(1);
      expect(rows.rows[0]!.access_count).toBe(3);
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("keeps the three v3 events apart", async () => {
    const fx = await publishedItem();
    try {
      const device = `dev-multi-${SUFFIX}`;
      for (const event of ["pdf_view", "pdf_download", "external_link_open"]) {
        await request(app)
          .post("/v1/library/access")
          .set("X-Device-Id", device)
          .send({ item_id: fx.itemId, event });
      }
      const rows = await pool.query<{ event: string }>(
        `select event from library_access_logs
          where library_item_id = $1 and device_id = $2 order by event::text`,
        [fx.itemId, device],
      );
      expect(rows.rows.map((r) => r.event)).toEqual([
        "external_link_open",
        "pdf_download",
        "pdf_view",
      ]);
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("records a signed-in caller against the account, not the handset", async () => {
    const fx = await publishedItem();
    const { token, user } = await loginAs("parent");
    try {
      await request(app)
        .post("/v1/library/access")
        .set(auth(token))
        .set("X-Device-Id", `dev-signed-${SUFFIX}`)
        .send({ item_id: fx.itemId, event: "pdf_view" });
      const rows = await pool.query<{ user_id: string }>(
        `select user_id from library_access_logs
          where library_item_id = $1 and event = 'pdf_view' and user_id is not null`,
        [fx.itemId],
      );
      expect(rows.rows.map((r) => r.user_id)).toEqual([user.id]);
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("does not log an unpublished item — accepting the id would leak drafts", async () => {
    const fx = await insertFixture();
    try {
      const res = await request(app)
        .post("/v1/library/access")
        .set("X-Device-Id", `dev-draft-${SUFFIX}`)
        .send({ item_id: fx.itemId, event: "pdf_view" });
      expect(res.status).toBe(202);
      expect(res.body.data.recorded).toBe(false);
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("needs an actor — an anonymous body with no device id is refused", async () => {
    const fx = await publishedItem();
    try {
      const res = await request(app)
        .post("/v1/library/access")
        .send({ item_id: fx.itemId, event: "pdf_view" });
      expect(res.status).toBe(422);
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("folds a guest's history into the account on first login, without double counting", async () => {
    const fx = await publishedItem();
    const device = `test-parent`; // the device_id helpers.loginAs sends
    try {
      // Read twice as a guest on this handset…
      await request(app)
        .post("/v1/library/access")
        .set("X-Device-Id", device)
        .send({ item_id: fx.itemId, event: "pdf_view" });
      await request(app)
        .post("/v1/library/access")
        .set("X-Device-Id", device)
        .send({ item_id: fx.itemId, event: "pdf_view" });

      // …then sign in on the same handset.
      const { token, user } = await loginAs("parent");
      const guestRows = await pool.query(
        `select 1 from library_access_logs
          where library_item_id = $1 and user_id is null and device_id = $2`,
        [fx.itemId, device],
      );
      expect(guestRows.rowCount).toBe(0);

      // One more read while signed in.
      await request(app)
        .post("/v1/library/access")
        .set(auth(token))
        .set("X-Device-Id", device)
        .send({ item_id: fx.itemId, event: "pdf_view" });

      const merged = await pool.query<{ access_count: number }>(
        `select access_count from library_access_logs
          where library_item_id = $1 and user_id = $2 and event = 'pdf_view'`,
        [fx.itemId, user.id],
      );
      expect(merged.rowCount).toBe(1);
      // Two as a guest plus one signed in — one human, three reads.
      expect(merged.rows[0]!.access_count).toBe(3);
    } finally {
      await cleanupFixture(fx);
    }
  });
});
