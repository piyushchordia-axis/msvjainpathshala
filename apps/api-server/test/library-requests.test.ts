/**
 * /v1/library/requests — Section 17 v3 §17.10.
 *
 * The rate limiter is a no-op under NODE_ENV=test unless JP_TEST_RATE_LIMIT=1,
 * so the abuse-control tests opt in explicitly and clear their buckets.
 */
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth } from "./helpers";
import { resetMemoryRateLimitsForTests } from "../src/lib/ratelimit";

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let sectionId: string | null = null;

afterAll(async () => {
  // library_sections carries a UNIQUE(order_index) WHERE deleted_at IS NULL, so
  // a fixture left behind collides with the next run rather than merely
  // littering. Clear ours before the pool closes.
  await pool.query(`delete from library_sections where key like 'test\\_req\\_%'`);
  await pool.end();
});

/**
 * A published section for the "picked a section" path.
 *
 * order_index is claimed from above the current maximum: the unique index means
 * a hard-coded value collides with any fixture a previous run failed to clean.
 */
async function insertSection(name: string, published: boolean): Promise<string> {
  const next = await pool.query<{ n: number }>(
    `select coalesce(max(order_index), 0) + 1 + floor(random() * 1000)::int as n from library_sections`,
  );
  const order = next.rows[0]!.n;
  const res = await pool.query<{ id: string }>(
    `insert into library_sections
       (key, name_en, name_hi, order_index, type, requires_login, is_published, content_version,
        draft_name_en, draft_name_hi, draft_type, draft_requires_login, draft_order_index)
     values ($1, $2, 'अनुरोध', $3, 'item_list', false, $4, 1,
             $2, 'अनुरोध', 'item_list', false, $3)
     returning id`,
    [`test_req_${name}_${SUFFIX}`, name, order, published],
  );
  return res.rows[0]!.id;
}

async function publishedSection(): Promise<string> {
  if (sectionId) return sectionId;
  sectionId = await insertSection("RequestsTarget", true);
  return sectionId;
}

async function cleanupDevice(deviceId: string): Promise<void> {
  await pool.query(`delete from library_content_requests where requester_device_id = $1`, [deviceId]);
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    title: "Bhaktamar Stotra recording",
    details: "Please add the full Bhaktamar Stotra audio with the Hindi meaning after each verse.",
    ...overrides,
  };
}

beforeEach(() => {
  resetMemoryRateLimitsForTests();
});

describe("library content requests", () => {
  it("a guest may submit with a device id, name and phone — no login, no tier", async () => {
    const device = `guest-${SUFFIX}-a`;
    const sec = await publishedSection();
    try {
      const res = await request(app)
        .post("/v1/library/requests")
        .send(
          body({
            section_id: sec,
            requester_device_id: device,
            requester_name: "Meera Shah",
            requester_phone: "9876543210",
          }),
        );
      expect(res.status).toBe(201);
      expect(res.body.data.request.status).toBe("pending");

      // Phone normalised to E.164 on write; device id retained as provenance.
      const row = await pool.query<{ requester_phone: string; requester_user_id: string | null }>(
        `select requester_phone, requester_user_id from library_content_requests where id = $1`,
        [res.body.data.request.id],
      );
      expect(row.rows[0]!.requester_phone).toBe("+919876543210");
      expect(row.rows[0]!.requester_user_id).toBeNull();
    } finally {
      await cleanupDevice(device);
    }
  });

  it("rejects a guest with no device id, and a guest with no name/phone", async () => {
    const sec = await publishedSection();
    const noDevice = await request(app)
      .post("/v1/library/requests")
      .send(body({ section_id: sec, requester_name: "A", requester_phone: "9876543210" }));
    expect(noDevice.status).toBe(422);

    const noContact = await request(app)
      .post("/v1/library/requests")
      .send(body({ section_id: sec, requester_device_id: `guest-${SUFFIX}-b` }));
    expect(noContact.status).toBe(422);
  });

  it("enforces exactly one targeting path and the content floor", async () => {
    const device = `guest-${SUFFIX}-c`;
    const sec = await publishedSection();
    const common = { requester_device_id: device, requester_name: "A", requester_phone: "9876543210" };

    const neither = await request(app).post("/v1/library/requests").send(body(common));
    expect(neither.status).toBe(422);

    const both = await request(app)
      .post("/v1/library/requests")
      .send(body({ ...common, section_id: sec, suggested_section: "Something else" }));
    expect(both.status).toBe(422);

    const shortDetails = await request(app)
      .post("/v1/library/requests")
      .send(body({ ...common, suggested_section: "Stavans", details: "too short" }));
    expect(shortDetails.status).toBe(422);

    // suggested_section alone is a complete, valid path.
    const ok = await request(app)
      .post("/v1/library/requests")
      .send(body({ ...common, suggested_section: "Stavans" }));
    expect(ok.status).toBe(201);
    await cleanupDevice(device);
  });

  it("rejects a non-http(s) reference_url", async () => {
    const device = `guest-${SUFFIX}-d`;
    const res = await request(app)
      .post("/v1/library/requests")
      .send(
        body({
          suggested_section: "Stavans",
          requester_device_id: device,
          requester_name: "A",
          requester_phone: "9876543210",
          // eslint-disable-next-line no-script-url
          reference_url: "javascript:alert(1)",
        }),
      );
    expect(res.status).toBe(422);
    await cleanupDevice(device);
  });

  it("rejects an unpublished section id rather than leaking it exists", async () => {
    const device = `guest-${SUFFIX}-e`;
    const hiddenId = await insertSection("Hidden", false);
    try {
      const res = await request(app)
        .post("/v1/library/requests")
        .send(
          body({
            section_id: hiddenId,
            requester_device_id: device,
            requester_name: "A",
            requester_phone: "9876543210",
          }),
        );
      expect(res.status).toBe(404);
    } finally {
      await cleanupDevice(device);
    }
  });

  it("a signed-in caller needs no name or phone — both come off the profile", async () => {
    const session = await loginAs("parent");
    try {
      const res = await request(app)
        .post("/v1/library/requests")
        .set(auth(session.token))
        .send(body({ suggested_section: "Stavans" }));
      expect(res.status).toBe(201);

      const row = await pool.query<{ requester_user_id: string; requester_name: string; requester_phone: string }>(
        `select requester_user_id, requester_name, requester_phone
           from library_content_requests where id = $1`,
        [res.body.data.request.id],
      );
      expect(row.rows[0]!.requester_user_id).toBe(session.user.id);
      expect(row.rows[0]!.requester_name).toBeTruthy();
      expect(row.rows[0]!.requester_phone).toBeTruthy();
    } finally {
      await pool.query(`delete from library_content_requests where requester_user_id = $1`, [
        (await loginAs("parent")).user.id,
      ]);
    }
  });

  it("GET /mine returns the caller's own requests newest-first, by device then by user", async () => {
    const device = `guest-${SUFFIX}-f`;
    const other = `guest-${SUFFIX}-g`;
    try {
      for (const title of ["First ask", "Second ask"]) {
        const r = await request(app)
          .post("/v1/library/requests")
          .send(
            body({
              title,
              suggested_section: "Stavans",
              requester_device_id: device,
              requester_name: "A",
              requester_phone: "9876543210",
            }),
          );
        expect(r.status).toBe(201);
      }
      await request(app)
        .post("/v1/library/requests")
        .send(
          body({
            title: "Someone else",
            suggested_section: "Stavans",
            requester_device_id: other,
            requester_name: "B",
            requester_phone: "9876543211",
          }),
        );

      const mine = await request(app).get("/v1/library/requests/mine").set("X-Device-Id", device);
      expect(mine.status).toBe(200);
      const titles = (mine.body.data.requests as Array<{ title: string; status: string }>).map(
        (r) => r.title,
      );
      expect(titles).toContain("First ask");
      expect(titles).toContain("Second ask");
      expect(titles).not.toContain("Someone else");

      // The clients' shared apiGet takes a path and nothing else, so both apps
      // send the device id in the query string — same result as the header.
      const viaQuery = await request(app).get(
        `/v1/library/requests/mine?device_id=${encodeURIComponent(device)}`,
      );
      expect(viaQuery.status).toBe(200);
      expect((viaQuery.body.data.requests as Array<{ title: string }>).map((r) => r.title)).toEqual(
        titles,
      );
      expect(mine.body.data.requests[0].status).toBe("pending");
      expect(mine.body.data.requests[0]).toHaveProperty("admin_note");
      expect(mine.body.data.requests[0]).toHaveProperty("linked_item_id");

      // No device id and no session — an empty list, not an error.
      const anon = await request(app).get("/v1/library/requests/mine");
      expect(anon.status).toBe(200);
      expect(anon.body.data.requests).toEqual([]);
    } finally {
      await cleanupDevice(device);
      await cleanupDevice(other);
    }
  });

  it("re-keys device-scoped requests to the account on login", async () => {
    // loginAs('student') signs in with device_id 'test-student'.
    const device = "test-student";
    try {
      const created = await request(app)
        .post("/v1/library/requests")
        .send(
          body({
            title: "Pre-login ask",
            suggested_section: "Stavans",
            requester_device_id: device,
            requester_name: "A",
            requester_phone: "9876543210",
          }),
        );
      expect(created.status).toBe(201);

      const before = await pool.query<{ requester_user_id: string | null }>(
        `select requester_user_id from library_content_requests where id = $1`,
        [created.body.data.request.id],
      );
      expect(before.rows[0]!.requester_user_id).toBeNull();

      const session = await loginAs("student");

      const after = await pool.query<{ requester_user_id: string | null; requester_device_id: string }>(
        `select requester_user_id, requester_device_id from library_content_requests where id = $1`,
        [created.body.data.request.id],
      );
      expect(after.rows[0]!.requester_user_id).toBe(session.user.id);
      // Provenance kept — this is what makes the re-key idempotent.
      expect(after.rows[0]!.requester_device_id).toBe(device);

      // The re-keyed row now shows up in the signed-in caller's own list.
      const mine = await request(app).get("/v1/library/requests/mine").set(auth(session.token));
      expect(mine.status).toBe(200);
      const titles = (mine.body.data.requests as Array<{ title: string }>).map((r) => r.title);
      expect(titles).toContain("Pre-login ask");
    } finally {
      await cleanupDevice(device);
    }
  });

  it("does not leak one person's requests to the next user of a shared handset", async () => {
    // A family phone: the parent signs in, their guest requests re-key to them,
    // and the next person to open the app must not see them.
    const device = "test-parent";
    try {
      const created = await request(app)
        .post("/v1/library/requests")
        .send(
          body({
            title: "Shared handset ask",
            suggested_section: "Stavans",
            requester_device_id: device,
            requester_name: "A",
            requester_phone: "9876543210",
          }),
        );
      expect(created.status).toBe(201);
      await loginAs("parent"); // re-keys the row to the parent

      // Signed out on the same device: the row now belongs to an account.
      const asGuest = await request(app).get("/v1/library/requests/mine").set("X-Device-Id", device);
      expect(asGuest.status).toBe(200);
      expect((asGuest.body.data.requests as Array<{ title: string }>).map((r) => r.title)).not.toContain(
        "Shared handset ask",
      );

      // A different account on the same handset must not see it either.
      const other = await loginAs("shikshak");
      const asOther = await request(app)
        .get("/v1/library/requests/mine")
        .set(auth(other.token))
        .set("X-Device-Id", device);
      expect(asOther.status).toBe(200);
      expect((asOther.body.data.requests as Array<{ title: string }>).map((r) => r.title)).not.toContain(
        "Shared handset ask",
      );
    } finally {
      await pool.query(`delete from library_content_requests where title = 'Shared handset ask'`);
    }
  });

  it("caps pending requests per requester with 409", async () => {
    const device = `guest-${SUFFIX}-h`;
    try {
      for (let i = 0; i < 3; i++) {
        const r = await request(app)
          .post("/v1/library/requests")
          .send(
            body({
              title: `Ask ${i}`,
              suggested_section: "Stavans",
              requester_device_id: device,
              requester_name: "A",
              requester_phone: "9876543210",
            }),
          );
        expect(r.status).toBe(201);
      }
      const fourth = await request(app)
        .post("/v1/library/requests")
        .send(
          body({
            title: "Ask 4",
            suggested_section: "Stavans",
            requester_device_id: device,
            requester_name: "A",
            requester_phone: "9876543210",
          }),
        );
      expect(fourth.status).toBe(409);
      expect(fourth.body.error.code).toBe("ERR_LIBRARY_REQUEST_PENDING_LIMIT");

      // A decided request frees the allowance; the cap is on `pending` only.
      await pool.query(
        `update library_content_requests set status = 'rejected'
          where requester_device_id = $1 and title = 'Ask 0'`,
        [device],
      );
      const afterDecision = await request(app)
        .post("/v1/library/requests")
        .send(
          body({
            title: "Ask 5",
            suggested_section: "Stavans",
            requester_device_id: device,
            requester_name: "A",
            requester_phone: "9876543210",
          }),
        );
      expect(afterDecision.status).toBe(201);
    } finally {
      await cleanupDevice(device);
    }
  });

  it("rate-limits submissions per requester with 429", async () => {
    process.env.JP_TEST_RATE_LIMIT = "1";
    const device = `guest-${SUFFIX}-i`;
    try {
      // Three succeed against the per-day cap; the fourth is refused by the
      // limiter before the pending cap is ever consulted.
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) {
        const r = await request(app)
          .post("/v1/library/requests")
          .send(
            body({
              title: `RL ${i}`,
              suggested_section: "Stavans",
              requester_device_id: device,
              requester_name: "A",
              requester_phone: "9876543210",
            }),
          );
        statuses.push(r.status);
        if (r.status === 429) {
          expect(r.body.error.code).toBe("ERR_LIBRARY_REQUEST_RATE_LIMITED");
        }
      }
      expect(statuses).toContain(429);
    } finally {
      delete process.env.JP_TEST_RATE_LIMIT;
      resetMemoryRateLimitsForTests();
      await cleanupDevice(device);
    }
  });

  it("does not gate the form behind login — an expired token is treated as a guest", async () => {
    const device = `guest-${SUFFIX}-j`;
    try {
      const res = await request(app)
        .post("/v1/library/requests")
        .set({ Authorization: "Bearer not-a-real-token" })
        .send(
          body({
            suggested_section: "Stavans",
            requester_device_id: device,
            requester_name: "A",
            requester_phone: "9876543210",
          }),
        );
      expect(res.status).toBe(201);
    } finally {
      await cleanupDevice(device);
    }
  });
});
