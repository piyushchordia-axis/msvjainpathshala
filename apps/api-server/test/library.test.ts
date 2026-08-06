import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool } from "@workspace/db";
import { signUploadUrl } from "../src/lib/file-tokens";
import { loginAs, auth } from "./helpers";

afterAll(async () => {
  await pool.end(); // close the shared pg pool so vitest exits cleanly
});

/**
 * Library / Resources module. The library is a NETWORK-WIDE resource: only
 * super_admin may create/update/delete; every authenticated user gets a tiered
 * member feed (GET /v1/library) that INCLUDES delivery URLs (file_url/embed_url
 * + a derived `url`) so content is actually deliverable.
 *
 * Tests are additive & idempotent: every mutating test mints its own item with
 * a unique title and cleans up after itself, so reruns stay green and no global
 * counts are asserted.
 */
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

/** Minimal valid create payload with a unique title. */
function newItem(overrides: Record<string, unknown> = {}) {
  return {
    content_type: "pdf",
    title_en: `Test Resource ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    file_url: "https://cdn.example.com/resource.pdf",
    access_tier: "public",
    is_published: true,
    ...overrides,
  };
}

/** Create an item as super_admin and return its id (assert success). */
async function createItem(adminToken: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const res = await request(app).post("/v1/library").set(auth(adminToken)).send(newItem(overrides));
  expect(res.status).toBe(200);
  expect(res.body.data.id).toBeTruthy();
  return res.body.data.id as string;
}

async function deleteItem(adminToken: string, id: string): Promise<void> {
  await request(app).delete(`/v1/library/${id}`).set(auth(adminToken));
}

describe("library", () => {
  /* ───────────────────────── auth / RBAC ───────────────────────── */

  it("requires auth on the member feed", async () => {
    const res = await request(app).get("/v1/library");
    expect(res.status).toBe(401);
  });

  it("requires auth on the admin list", async () => {
    const res = await request(app).get("/v1/library/admin");
    expect(res.status).toBe(401);
  });

  it("blocks non-admin roles from the admin list (403)", async () => {
    const { token } = await loginAs("parent");
    const res = await request(app).get("/v1/library/admin").set(auth(token));
    expect(res.status).toBe(403);
  });

  it("blocks non-super-admin admin roles from creating (403)", async () => {
    // city_admin can access the admin panel (sees the list) but may NOT write.
    const { token } = await loginAs("city_admin");
    const res = await request(app).post("/v1/library").set(auth(token)).send(newItem());
    expect(res.status).toBe(403);

    // ...yet the admin list is readable to them.
    const list = await request(app).get("/v1/library/admin").set(auth(token));
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.data.items)).toBe(true);
    expect(list.body.data.can_edit).toBe(false);
  });

  it("removes the duplicate POST /v1/admin/library write path (404)", async () => {
    // Library writes live only on POST /v1/library (super_admin). The old
    // admin-modules route let city_admin publish network-wide — it must be gone.
    const { token } = await loginAs("city_admin");
    const res = await request(app).post("/v1/admin/library").set(auth(token)).send(newItem());
    expect(res.status).toBe(404);
  });

  it("blocks a parent (non-admin) from creating (403)", async () => {
    const { token } = await loginAs("parent");
    const res = await request(app).post("/v1/library").set(auth(token)).send(newItem());
    expect(res.status).toBe(403);
  });

  /* ───────────────────────── admin CRUD ───────────────────────── */

  it("runs the full admin create -> list -> update -> delete lifecycle", async () => {
    const admin = await loginAs("super_admin");

    // CREATE
    const title = `Lifecycle Resource ${Date.now()}`;
    const id = await createItem(admin.token, {
      content_type: "video",
      title_en: title,
      title_hi: "वीडियो संसाधन",
      description_en: "A seeded test video.",
      embed_url: "https://www.youtube.com/embed/abc123",
      file_url: undefined,
      access_tier: "student",
    });

    // LIST (admin) — the new item is present with both URL fields + can_edit.
    const list = await request(app).get("/v1/library/admin").set(auth(admin.token));
    expect(list.status).toBe(200);
    expect(list.body.data.can_edit).toBe(true);
    const row = list.body.data.items.find((r: { id: string }) => r.id === id);
    expect(row).toBeTruthy();
    expect(row.title_en).toBe(title);
    expect(row.content_type).toBe("video");
    expect(row.access_tier).toBe("student");
    expect(row.is_published).toBe(true);
    expect(row.embed_url).toBe("https://www.youtube.com/embed/abc123");
    expect(row.can_edit).toBe(true);
    expect(typeof row.access_count).toBe("number");

    // UPDATE
    const patch = await request(app)
      .patch(`/v1/library/${id}`)
      .set(auth(admin.token))
      .send({ title_en: `${title} (edited)`, access_tier: "public", is_published: false });
    expect(patch.status).toBe(200);
    expect(patch.body.data.id).toBe(id);

    const list2 = await request(app).get("/v1/library/admin").set(auth(admin.token));
    const row2 = list2.body.data.items.find((r: { id: string }) => r.id === id);
    expect(row2.title_en).toBe(`${title} (edited)`);
    expect(row2.access_tier).toBe("public");
    expect(row2.is_published).toBe(false);

    // DELETE
    const del = await request(app).delete(`/v1/library/${id}`).set(auth(admin.token));
    expect(del.status).toBe(200);
    expect(del.body.data.id).toBe(id);

    // gone from the admin list
    const list3 = await request(app).get("/v1/library/admin").set(auth(admin.token));
    expect(list3.body.data.items.find((r: { id: string }) => r.id === id)).toBeUndefined();

    // deleting again -> 404
    const delAgain = await request(app).delete(`/v1/library/${id}`).set(auth(admin.token));
    expect(delAgain.status).toBe(404);
  });

  it("returns 404 when updating/deleting a non-existent item", async () => {
    const admin = await loginAs("super_admin");
    const upd = await request(app)
      .patch(`/v1/library/${NIL_UUID}`)
      .set(auth(admin.token))
      .send({ title_en: "x" });
    expect(upd.status).toBe(404);

    const del = await request(app).delete(`/v1/library/${NIL_UUID}`).set(auth(admin.token));
    expect(del.status).toBe(404);
  });

  /* ─────────────────── content delivery (Phase 2 fix) ─────────────────── */

  it("member feed includes delivery URLs for every content type", async () => {
    const admin = await loginAs("super_admin");
    const member = await loginAs("parent");

    // One public, deliverable item per content type so the feed must surface a
    // working URL for each. pdf/image use file_url; video/audio use embed_url.
    const created: Array<{ id: string; content_type: string; field: "file_url" | "embed_url"; value: string }> = [
      { content_type: "pdf", field: "file_url", value: "https://cdn.example.com/doc.pdf" },
      { content_type: "image", field: "file_url", value: "https://cdn.example.com/pic.png" },
      { content_type: "video", field: "embed_url", value: "https://www.youtube.com/embed/vid1" },
      { content_type: "audio", field: "embed_url", value: "https://cdn.example.com/track.mp3" },
    ].map((c) => ({ ...c, id: "" }));

    try {
      for (const c of created) {
        c.id = await createItem(admin.token, {
          content_type: c.content_type,
          file_url: undefined,
          embed_url: undefined,
          [c.field]: c.value,
          access_tier: "public",
        });
      }

      const feed = await request(app).get("/v1/library").set(auth(member.token));
      expect(feed.status).toBe(200);
      const items: Array<Record<string, unknown>> = feed.body.data.items;

      for (const c of created) {
        const row = items.find((r) => r.id === c.id);
        expect(row, `feed missing ${c.content_type} item`).toBeTruthy();
        expect(row!.content_type).toBe(c.content_type);
        // The delivery field is present...
        expect(row![c.field]).toBe(c.value);
        // ...and the derived single `url` the clients render from is set.
        expect(row!.url).toBe(c.value);
      }
    } finally {
      for (const c of created) if (c.id) await deleteItem(admin.token, c.id);
    }
  });

  it("POST /:id/access upserts distinct reach (one row per member)", async () => {
    const admin = await loginAs("super_admin");
    const member = await loginAs("parent");
    const other = await loginAs("shikshak");
    const id = await createItem(admin.token, {
      content_type: "pdf",
      file_url: "https://cdn.example.com/access-me.pdf",
      access_tier: "public",
    });
    try {
      const res = await request(app).post(`/v1/library/${id}/access`).set(auth(member.token));
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(id);
      expect(res.body.data.url).toBe("https://cdn.example.com/access-me.pdf");

      // Second open by the same member: still one row, access_count bumped.
      const res2 = await request(app).post(`/v1/library/${id}/access`).set(auth(member.token));
      expect(res2.status).toBe(200);
      expect(res2.body.data.url).toBe("https://cdn.example.com/access-me.pdf");

      const memberLogs = await pool.query<{ n: string; opens: string }>(
        `select count(*)::text as n, coalesce(max(access_count), 0)::text as opens
         from library_access_logs
         where library_item_id = $1 and user_id = $2`,
        [id, member.user.id],
      );
      expect(memberLogs.rows[0]!.n).toBe("1");
      expect(Number(memberLogs.rows[0]!.opens)).toBeGreaterThanOrEqual(2);

      // A second member adds a second distinct-reach row.
      const res3 = await request(app).post(`/v1/library/${id}/access`).set(auth(other.token));
      expect(res3.status).toBe(200);

      const list = await request(app).get("/v1/library/admin").set(auth(admin.token));
      const row = list.body.data.items.find((r: { id: string }) => r.id === id);
      expect(row).toBeTruthy();
      // Admin access_count = distinct members, not total opens.
      expect(row.access_count).toBe(2);
    } finally {
      await deleteItem(admin.token, id);
    }
  });

  /* ───────────────────── tiered / gated feed ───────────────────── */

  it("gates a shikshak-tier item: parent is excluded, teacher sees it", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const shikshak = await loginAs("shikshak");

    const id = await createItem(admin.token, {
      content_type: "pdf",
      file_url: "https://cdn.example.com/teacher-only.pdf",
      access_tier: "shikshak",
      is_published: true,
    });
    try {
      // The parent (public/student/msv tiers) must NOT see a shikshak-tier item.
      const parentFeed = await request(app).get("/v1/library").set(auth(parent.token));
      expect(parentFeed.status).toBe(200);
      expect(parentFeed.body.data.tiers).not.toContain("shikshak");
      expect(parentFeed.body.data.items.find((r: { id: string }) => r.id === id)).toBeUndefined();

      // Parent probing the access endpoint gets 404 (not 403 — non-enumerable).
      const probe = await request(app).post(`/v1/library/${id}/access`).set(auth(parent.token));
      expect(probe.status).toBe(404);

      // The shikshak (full tier set) DOES see it.
      const teacherFeed = await request(app).get("/v1/library").set(auth(shikshak.token));
      expect(teacherFeed.body.data.tiers).toContain("shikshak");
      expect(teacherFeed.body.data.items.find((r: { id: string }) => r.id === id)).toBeTruthy();

      // ...and can deliver it.
      const deliver = await request(app).post(`/v1/library/${id}/access`).set(auth(shikshak.token));
      expect(deliver.status).toBe(200);
      expect(deliver.body.data.url).toBe("https://cdn.example.com/teacher-only.pdf");
    } finally {
      await deleteItem(admin.token, id);
    }
  });

  it("excludes unpublished (draft) items from the member feed", async () => {
    const admin = await loginAs("super_admin");
    const member = await loginAs("parent");
    const id = await createItem(admin.token, {
      content_type: "pdf",
      file_url: "https://cdn.example.com/draft.pdf",
      access_tier: "public",
      is_published: false,
    });
    try {
      const feed = await request(app).get("/v1/library").set(auth(member.token));
      expect(feed.body.data.items.find((r: { id: string }) => r.id === id)).toBeUndefined();

      // A draft is also not deliverable via /access (404).
      const access = await request(app).post(`/v1/library/${id}/access`).set(auth(member.token));
      expect(access.status).toBe(404);
    } finally {
      await deleteItem(admin.token, id);
    }
  });

  /* ───────────────────────── validation (400/422) ───────────────────────── */

  it("rejects bad create payloads", async () => {
    const admin = await loginAs("super_admin");

    // Missing both file_url and embed_url -> not deliverable.
    const noUrl = await request(app)
      .post("/v1/library")
      .set(auth(admin.token))
      .send({ content_type: "pdf", title_en: "No URL", access_tier: "public" });
    expect(noUrl.status).toBe(422);

    // Invalid content_type enum.
    const badType = await request(app)
      .post("/v1/library")
      .set(auth(admin.token))
      .send({ content_type: "spreadsheet", title_en: "Bad type", file_url: "https://x.com/a.pdf" });
    expect(badType.status).toBe(422);

    // Empty title.
    const emptyTitle = await request(app)
      .post("/v1/library")
      .set(auth(admin.token))
      .send({ content_type: "pdf", title_en: "", file_url: "https://x.com/a.pdf" });
    expect(emptyTitle.status).toBe(422);

    // Non-URL file_url.
    const badUrl = await request(app)
      .post("/v1/library")
      .set(auth(admin.token))
      .send({ content_type: "pdf", title_en: "Bad url", file_url: "not-a-url" });
    expect(badUrl.status).toBe(422);
  });

  it("rejects bad update payloads", async () => {
    const admin = await loginAs("super_admin");
    const id = await createItem(admin.token, { file_url: "https://cdn.example.com/u.pdf" });
    try {
      // Empty patch -> nothing to update.
      const empty = await request(app).patch(`/v1/library/${id}`).set(auth(admin.token)).send({});
      expect(empty.status).toBe(422);

      // Clearing the only delivery URL -> item would be undeliverable.
      const undeliverable = await request(app)
        .patch(`/v1/library/${id}`)
        .set(auth(admin.token))
        .send({ file_url: null });
      expect(undeliverable.status).toBe(422);

      // Invalid access_tier enum.
      const badTier = await request(app)
        .patch(`/v1/library/${id}`)
        .set(auth(admin.token))
        .send({ access_tier: "premium" });
      expect(badTier.status).toBe(422);
    } finally {
      await deleteItem(admin.token, id);
    }
  });

  /* ───────────────────── Q7 video embed host whitelist ───────────────────── */

  it("rejects video embeds that are not YouTube/Vimeo (exact hostname)", async () => {
    const admin = await loginAs("super_admin");

    const nonWhitelist = await request(app)
      .post("/v1/library")
      .set(auth(admin.token))
      .send(
        newItem({
          content_type: "video",
          file_url: undefined,
          embed_url: "https://example.com/watch?v=x",
        }),
      );
    expect(nonWhitelist.status).toBe(422);

    // Substring trap: hostname is youtube.com.evil.tld, not youtube.com.
    const substringTrap = await request(app)
      .post("/v1/library")
      .set(auth(admin.token))
      .send(
        newItem({
          content_type: "video",
          file_url: undefined,
          embed_url: "https://youtube.com.evil.tld/watch?v=x",
        }),
      );
    expect(substringTrap.status).toBe(422);
  });

  it("accepts youtu.be and player.vimeo.com embeds for video items", async () => {
    const admin = await loginAs("super_admin");
    const ids: string[] = [];
    try {
      const youtu = await request(app)
        .post("/v1/library")
        .set(auth(admin.token))
        .send(
          newItem({
            content_type: "video",
            file_url: undefined,
            embed_url: "https://youtu.be/abc123",
          }),
        );
      // ok() defaults to 200 (this API does not mint 201 Created).
      expect(youtu.status).toBe(200);
      ids.push(youtu.body.data.id);

      const vimeo = await request(app)
        .post("/v1/library")
        .set(auth(admin.token))
        .send(
          newItem({
            content_type: "video",
            file_url: undefined,
            embed_url: "https://player.vimeo.com/video/123",
          }),
        );
      expect(vimeo.status).toBe(200);
      ids.push(vimeo.body.data.id);
    } finally {
      for (const id of ids) await deleteItem(admin.token, id);
    }
  });

  it("rejects patching a video embed_url to a disallowed host", async () => {
    const admin = await loginAs("super_admin");
    const id = await createItem(admin.token, {
      content_type: "video",
      file_url: undefined,
      embed_url: "https://www.youtube.com/embed/ok",
    });
    try {
      const patch = await request(app)
        .patch(`/v1/library/${id}`)
        .set(auth(admin.token))
        .send({ embed_url: "https://evil.example/not-allowed" });
      expect(patch.status).toBe(422);
    } finally {
      await deleteItem(admin.token, id);
    }
  });

  it("still allows arbitrary https URLs on non-video types (pdf)", async () => {
    const admin = await loginAs("super_admin");
    const id = await createItem(admin.token, {
      content_type: "pdf",
      file_url: "https://cdn.arbitrary-host.example/doc.pdf",
    });
    try {
      expect(id).toBeTruthy();
    } finally {
      await deleteItem(admin.token, id);
    }
  });

  it("POST /:id/access 409s when a stored delivery URL is a javascript: URI", async () => {
    const member = await loginAs("parent");
    // Bypass the route so we can plant a pre-Q7 / malicious row.
    const inserted = await pool.query<{ id: string }>(
      `insert into library_items (content_type, title_en, embed_url, access_tier, is_published)
       values ('video', $1, 'javascript:alert(1)', 'public', true)
       returning id`,
      [`JS trap ${Date.now()}`],
    );
    const id = inserted.rows[0]!.id;
    try {
      const res = await request(app).post(`/v1/library/${id}/access`).set(auth(member.token));
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("ERR_NO_CONTENT_URL");
    } finally {
      await pool.query(`delete from library_items where id = $1`, [id]);
    }
  });

  /* ───────────────────────── soft delete ───────────────────────── */

  /* ───────────────────── signed /uploads file_url ───────────────────── */

  it("signs /uploads file_url on the member feed; leaves external URLs alone", async () => {
    const admin = await loginAs("super_admin");
    const member = await loginAs("parent");
    const uploadUrl = "http://localhost:8080/uploads/library/signed-feed.pdf";
    const externalUrl = "https://cdn.example.com/external.pdf";
    const ids: string[] = [];
    try {
      // student-tier so a seeded parent (owns a child) can see it; public for the external control.
      const uploadId = await createItem(admin.token, {
        content_type: "pdf",
        file_url: uploadUrl,
        access_tier: "student",
        is_published: true,
      });
      ids.push(uploadId);

      const externalId = await createItem(admin.token, {
        content_type: "pdf",
        file_url: externalUrl,
        access_tier: "public",
      });
      ids.push(externalId);

      const feed = await request(app).get("/v1/library").set(auth(member.token));
      expect(feed.status).toBe(200);

      const uploaded = feed.body.data.items.find((r: { id: string }) => r.id === uploadId);
      expect(uploaded).toBeTruthy();
      expect(uploaded.file_url).toContain("/uploads/library/signed-feed.pdf");
      expect(uploaded.file_url).toMatch(/[?&]se=\d+/);
      expect(uploaded.file_url).toMatch(/[?&]sig=/);
      expect(uploaded.url).toBe(uploaded.file_url);

      const external = feed.body.data.items.find((r: { id: string }) => r.id === externalId);
      expect(external).toBeTruthy();
      expect(external.file_url).toBe(externalUrl);
      expect(external.url).toBe(externalUrl);

      // Admin preview links are signed too.
      const adminList = await request(app).get("/v1/library/admin").set(auth(admin.token));
      const adminRow = adminList.body.data.items.find((r: { id: string }) => r.id === uploadId);
      expect(adminRow.file_url).toMatch(/[?&]sig=/);
      expect(adminRow.url).toMatch(/[?&]sig=/);
    } finally {
      for (const id of ids) await deleteItem(admin.token, id);
    }
  });

  it("rejects an expired /uploads signature via the uploads route", async () => {
    // Integration with verifyUploadAccess — a past `se` must 403 regardless of sig.
    const expired = signUploadUrl("http://localhost:8080/uploads/library/expired.pdf", -60);
    const u = new URL(expired);
    const res = await request(app).get(u.pathname + u.search);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ERR_FORBIDDEN");
  });

  it("soft-deletes: hides from feeds, keeps access logs, second delete is 404", async () => {
    const admin = await loginAs("super_admin");
    const member = await loginAs("parent");
    const id = await createItem(admin.token, {
      content_type: "pdf",
      file_url: "https://cdn.example.com/soft-delete.pdf",
      access_tier: "public",
      is_published: true,
    });

    try {
      // Seed an access log before delete — this is the history that must survive.
      const access = await request(app).post(`/v1/library/${id}/access`).set(auth(member.token));
      expect(access.status).toBe(200);

      const logsBefore = await pool.query<{ n: string }>(
        `select count(*)::text as n from library_access_logs where library_item_id = $1`,
        [id],
      );
      expect(Number(logsBefore.rows[0]!.n)).toBeGreaterThanOrEqual(1);

      const del = await request(app).delete(`/v1/library/${id}`).set(auth(admin.token));
      expect(del.status).toBe(200);

      // Soft-deleted row still exists; access logs still point at it.
      const row = await pool.query<{ deleted_at: Date | null }>(
        `select deleted_at from library_items where id = $1`,
        [id],
      );
      expect(row.rows[0]?.deleted_at).toBeTruthy();

      const logsAfter = await pool.query<{ n: string }>(
        `select count(*)::text as n from library_access_logs where library_item_id = $1`,
        [id],
      );
      expect(logsAfter.rows[0]!.n).toBe(logsBefore.rows[0]!.n);

      const memberFeed = await request(app).get("/v1/library").set(auth(member.token));
      expect(memberFeed.body.data.items.find((r: { id: string }) => r.id === id)).toBeUndefined();

      const publicFeed = await request(app).get("/v1/public/library");
      expect(publicFeed.status).toBe(200);
      expect(publicFeed.body.data.items.find((r: { id: string }) => r.id === id)).toBeUndefined();

      const adminList = await request(app).get("/v1/library/admin").set(auth(admin.token));
      expect(adminList.body.data.items.find((r: { id: string }) => r.id === id)).toBeUndefined();

      // Second delete looks like a missing row to clients.
      const delAgain = await request(app).delete(`/v1/library/${id}`).set(auth(admin.token));
      expect(delAgain.status).toBe(404);

      // Access on a soft-deleted item is also 404.
      const accessGone = await request(app).post(`/v1/library/${id}/access`).set(auth(member.token));
      expect(accessGone.status).toBe(404);
    } finally {
      await pool.query(`delete from library_items where id = $1`, [id]);
    }
  });
});
