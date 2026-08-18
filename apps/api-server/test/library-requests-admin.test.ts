/**
 * /v1/admin/library/requests — Section 17 v3 §17.10.4–§17.10.5.
 *
 * The point of these tests is the authority SPLIT: city_admin reads the queue
 * but cannot act, and the refusal must come from the service, not from a route
 * guard that would also have blocked the read.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth } from "./helpers";

afterAll(async () => {
  await pool.query(`delete from library_content_requests where title like 'ADMREQ %'`);
  await pool.query(`delete from library_items where item_code like 'admreq-%'`);
  await pool.query(`delete from library_sections where key like 'test\\_admreq\\_%'`);
  await pool.end();
});

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let sectionId: string | null = null;

async function publishedSection(): Promise<string> {
  if (sectionId) return sectionId;
  const next = await pool.query<{ n: number }>(
    `select coalesce(max(order_index), 0) + 1 + floor(random() * 1000)::int as n from library_sections`,
  );
  const res = await pool.query<{ id: string }>(
    `insert into library_sections
       (key, name_en, order_index, type, requires_login, is_published, content_version,
        draft_name_en, draft_type, draft_requires_login, draft_order_index)
     values ($1, 'Admin Requests Target', $2, 'item_list', false, true, 1,
             'Admin Requests Target', 'item_list', false, $2)
     returning id`,
    [`test_admreq_${SUFFIX}`, next.rows[0]!.n],
  );
  sectionId = res.rows[0]!.id;
  return sectionId;
}

/** Insert a pending request directly — the public POST path is tested elsewhere. */
async function seedRequest(
  title: string,
  opts: { userId?: string | null; sectionId?: string | null } = {},
): Promise<string> {
  const sec = opts.sectionId === undefined ? await publishedSection() : opts.sectionId;
  const res = await pool.query<{ id: string }>(
    `insert into library_content_requests
       (section_id, suggested_section, title, details, requester_user_id, requester_device_id,
        requester_name, requester_phone, status)
     values ($1, $2, $3, 'Seeded for the admin queue tests — twenty characters at least.',
             $4, $5, 'Meera Shah', '+919876543210', 'pending')
     returning id`,
    [
      sec,
      sec ? null : 'Paryushan pravachans',
      title,
      opts.userId ?? null,
      opts.userId ? null : `admreq-device-${SUFFIX}`,
    ],
  );
  return res.rows[0]!.id;
}

async function statusOf(id: string): Promise<string> {
  const r = await pool.query<{ status: string }>(
    `select status from library_content_requests where id = $1`,
    [id],
  );
  return r.rows[0]!.status;
}

describe("admin content-request queue", () => {
  it("city_admin may read the queue but is refused every action", async () => {
    const city = await loginAs("city_admin");
    const id = await seedRequest("ADMREQ city admin read");

    const list = await request(app)
      .get("/v1/admin/library/requests?status=pending")
      .set(auth(city.token));
    expect(list.status).toBe(200);
    expect(list.body.data.can_act).toBe(false);
    expect(
      (list.body.data.requests as Array<{ id: string }>).some((r) => r.id === id),
    ).toBe(true);

    const detail = await request(app)
      .get(`/v1/admin/library/requests/${id}`)
      .set(auth(city.token));
    expect(detail.status).toBe(200);
    expect(detail.body.data.can_act).toBe(false);

    // The refusal is the service's, on a route the same caller may GET.
    const decide = await request(app)
      .patch(`/v1/admin/library/requests/${id}`)
      .set(auth(city.token))
      .send({ action: "accept" });
    expect(decide.status).toBe(403);
    expect(decide.body.error.code).toBe("ERR_LIBRARY_REQUEST_ACTION_FORBIDDEN");

    const create = await request(app)
      .post(`/v1/admin/library/requests/${id}/create-item`)
      .set(auth(city.token))
      .send({});
    expect(create.status).toBe(403);
    expect(create.body.error.code).toBe("ERR_LIBRARY_REQUEST_ACTION_FORBIDDEN");

    expect(await statusOf(id)).toBe("pending");
  });

  it("sanchalak cannot even read the queue", async () => {
    const sanchalak = await loginAs("sanchalak");
    const list = await request(app).get("/v1/admin/library/requests").set(auth(sanchalak.token));
    expect(list.status).toBe(403);
  });

  it("state_admin accepts with a note, and the note reaches the row", async () => {
    const state = await loginAs("state_admin");
    const id = await seedRequest("ADMREQ state accept");

    const res = await request(app)
      .patch(`/v1/admin/library/requests/${id}`)
      .set(auth(state.token))
      .send({ action: "accept", admin_note: "Sourcing this from the Ghatkopar recording." });
    expect(res.status).toBe(200);
    expect(res.body.data.request.status).toBe("accepted");
    expect(res.body.data.request.admin_note).toContain("Ghatkopar");
    expect(res.body.data.request.actioned_by).toBe(state.user.id);
    expect(res.body.data.request.actioned_at).toBeTruthy();

    const audit = await pool.query<{ n: string }>(
      `select count(*)::text as n from audit_logs
        where entity_kind = 'library_content_request' and entity_id = $1 and action = 'approve'`,
      [id],
    );
    expect(Number(audit.rows[0]!.n)).toBeGreaterThan(0);
  });

  it("holds the lifecycle: accepted may still be rejected, rejected is terminal", async () => {
    const state = await loginAs("state_admin");
    const id = await seedRequest("ADMREQ lifecycle");

    const accept = await request(app)
      .patch(`/v1/admin/library/requests/${id}`)
      .set(auth(state.token))
      .send({ action: "accept" });
    expect(accept.status).toBe(200);

    // accepted → rejected is allowed; plans change.
    const reject = await request(app)
      .patch(`/v1/admin/library/requests/${id}`)
      .set(auth(state.token))
      .send({ action: "reject", admin_note: "We could not source a clean recording." });
    expect(reject.status).toBe(200);
    expect(reject.body.data.request.status).toBe("rejected");

    // rejected is terminal in both directions.
    const reAccept = await request(app)
      .patch(`/v1/admin/library/requests/${id}`)
      .set(auth(state.token))
      .send({ action: "accept" });
    expect(reAccept.status).toBe(409);
    expect(await statusOf(id)).toBe("rejected");
  });

  it("omitting admin_note on a later action keeps the note the requester was shown", async () => {
    const state = await loginAs("state_admin");
    const id = await seedRequest("ADMREQ note retention");

    await request(app)
      .patch(`/v1/admin/library/requests/${id}`)
      .set(auth(state.token))
      .send({ action: "accept", admin_note: "Told the family we are sourcing it." });

    const res = await request(app)
      .patch(`/v1/admin/library/requests/${id}`)
      .set(auth(state.token))
      .send({ action: "reject" });
    expect(res.status).toBe(200);
    expect(res.body.data.request.admin_note).toContain("sourcing");
  });

  it("create-item spawns a draft prefilled from the request and links it", async () => {
    const state = await loginAs("state_admin");
    const sec = await publishedSection();
    const id = await seedRequest("ADMREQ Bhaktamar recording");

    const res = await request(app)
      .post(`/v1/admin/library/requests/${id}/create-item`)
      .set(auth(state.token))
      .send({});
    expect(res.status).toBe(200);
    const itemId = res.body.data.item_id as string;
    expect(res.body.data.request.linked_item_id).toBe(itemId);

    const item = await pool.query<{
      title_en: string;
      draft_title_en: string;
      section_id: string;
      is_published: boolean;
    }>(`select title_en, draft_title_en, section_id, is_published from library_items where id = $1`, [
      itemId,
    ]);
    expect(item.rows[0]!.title_en).toBe("ADMREQ Bhaktamar recording");
    expect(item.rows[0]!.draft_title_en).toBe("ADMREQ Bhaktamar recording");
    expect(item.rows[0]!.section_id).toBe(sec);
    // A DRAFT — the normal publish flow takes over from here.
    expect(item.rows[0]!.is_published).toBe(false);

    // Creating an item does not decide the request.
    expect(await statusOf(id)).toBe("pending");

    // And it cannot be done twice.
    const again = await request(app)
      .post(`/v1/admin/library/requests/${id}/create-item`)
      .set(auth(state.token))
      .send({});
    expect(again.status).toBe(409);

    await pool.query(`delete from library_items where id = $1`, [itemId]);
  });

  it("refuses create-item for an Other request that names no real section", async () => {
    const state = await loginAs("state_admin");
    const id = await seedRequest("ADMREQ other section", { sectionId: null });
    const res = await request(app)
      .post(`/v1/admin/library/requests/${id}/create-item`)
      .set(auth(state.token))
      .send({});
    expect(res.status).toBe(409);
  });

  it("publishing the linked item flips accepted requests to published and notifies the account", async () => {
    const superAdmin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const id = await seedRequest("ADMREQ publish fanout", { userId: parent.user.id });

    const created = await request(app)
      .post(`/v1/admin/library/requests/${id}/create-item`)
      .set(auth(superAdmin.token))
      .send({});
    expect(created.status).toBe(200);
    const itemId = created.body.data.item_id as string;

    await request(app)
      .patch(`/v1/admin/library/requests/${id}`)
      .set(auth(superAdmin.token))
      .send({ action: "accept" });

    // The item needs a modality before it may be published (the CHECK added
    // with the v3 schema), which is also what makes the notification honest.
    await pool.query(
      `update library_items
          set draft_text_content_en = '<p>Seeded body.</p>', text_content_en = '<p>Seeded body.</p>'
        where id = $1`,
      [itemId],
    );

    const before = await pool.query<{ n: string }>(
      `select count(*)::text as n from notifications where user_id = $1 and kind = 'library'`,
      [parent.user.id],
    );

    const publish = await request(app)
      .post(`/v1/admin/library/items/${itemId}/publish`)
      .set(auth(superAdmin.token))
      .send({});
    expect(publish.status).toBe(200);

    expect(await statusOf(id)).toBe("published");

    const after = await pool.query<{ n: string }>(
      `select count(*)::text as n from notifications where user_id = $1 and kind = 'library'`,
      [parent.user.id],
    );
    expect(Number(after.rows[0]!.n)).toBe(Number(before.rows[0]!.n) + 1);

    // published is terminal — no admin action reopens it.
    const reopen = await request(app)
      .patch(`/v1/admin/library/requests/${id}`)
      .set(auth(superAdmin.token))
      .send({ action: "reject" });
    expect(reopen.status).toBe(409);

    await pool.query(`delete from notifications where user_id = $1 and kind = 'library'`, [
      parent.user.id,
    ]);
    await pool.query(`delete from library_items where id = $1`, [itemId]);
  });

  it("a guest requester with no account blocks nothing — publish still succeeds", async () => {
    const superAdmin = await loginAs("super_admin");
    const id = await seedRequest("ADMREQ guest publish", { userId: null });

    const created = await request(app)
      .post(`/v1/admin/library/requests/${id}/create-item`)
      .set(auth(superAdmin.token))
      .send({});
    const itemId = created.body.data.item_id as string;
    await request(app)
      .patch(`/v1/admin/library/requests/${id}`)
      .set(auth(superAdmin.token))
      .send({ action: "accept" });
    await pool.query(
      `update library_items set draft_text_content_en = '<p>x</p>', text_content_en = '<p>x</p>' where id = $1`,
      [itemId],
    );

    const publish = await request(app)
      .post(`/v1/admin/library/items/${itemId}/publish`)
      .set(auth(superAdmin.token))
      .send({});
    expect(publish.status).toBe(200);
    expect(await statusOf(id)).toBe("published");

    await pool.query(`delete from library_items where id = $1`, [itemId]);
  });

  it("surfaces duplicate asks on the detail pane", async () => {
    const state = await loginAs("state_admin");
    const first = await seedRequest("ADMREQ Bhaktamar Stotra full recording");
    const second = await seedRequest("ADMREQ please add Bhaktamar Stotra");
    const unrelated = await seedRequest("ADMREQ Panchang for next year");

    const detail = await request(app)
      .get(`/v1/admin/library/requests/${first}`)
      .set(auth(state.token));
    expect(detail.status).toBe(200);
    const ids = (detail.body.data.similar_pending as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(second);
    expect(ids).not.toContain(unrelated);
    expect(ids).not.toContain(first);
  });

  it("filters by status and paginates with a total", async () => {
    const state = await loginAs("state_admin");
    await seedRequest("ADMREQ filter one");
    await seedRequest("ADMREQ filter two");

    const page = await request(app)
      .get("/v1/admin/library/requests?status=pending&limit=1")
      .set(auth(state.token));
    expect(page.status).toBe(200);
    expect(page.body.data.requests).toHaveLength(1);
    expect(page.body.meta.total).toBeGreaterThanOrEqual(2);
    expect(page.body.meta.has_more).toBe(true);

    const sec = await publishedSection();
    const bySection = await request(app)
      .get(`/v1/admin/library/requests?section_id=${sec}`)
      .set(auth(state.token));
    expect(bySection.status).toBe(200);
    expect((bySection.body.data.requests as unknown[]).length).toBeGreaterThan(0);

    // A window that closed before anything was seeded returns nothing.
    const empty = await request(app)
      .get("/v1/admin/library/requests?from=2020-01-01&to=2020-01-02")
      .set(auth(state.token));
    expect(empty.status).toBe(200);
    expect(empty.body.data.requests).toEqual([]);
  });
});
