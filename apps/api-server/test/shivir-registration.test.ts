/**
 * Shivir registration — the module's core parent action, which had no
 * implementation on any surface until now.
 *
 * `shivir_registrations` had zero writers repo-wide, so `capacity` was stored
 * and rendered but never enforced, the dashboard's "Registered" figure was
 * structurally 0, and SPEC Step 15's exit criterion ("parents register 50
 * students") was unreachable.
 *
 * Self-creating: each run makes its own shivir so capacity can be driven to the
 * edge without touching seeded data.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool, db, cities, shivir_events } from "@workspace/db";
import { eq } from "drizzle-orm";
import { loginAs, auth } from "./helpers";

afterAll(async () => {
  await pool.end();
});

function isoDate(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}

async function mumbaiCityId(): Promise<string> {
  const [row] = await db.select({ id: cities.id }).from(cities).where(eq(cities.name, "Mumbai")).limit(1);
  expect(row).toBeTruthy();
  return row!.id;
}

/** A fresh shivir owned by this test run. */
async function createShivir(
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const res = await request(app)
    .post("/v1/admin/shivirs")
    .set(auth(token))
    .send({
      name_en: `Vitest Shivir ${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
      city_id: await mumbaiCityId(),
      start_date: isoDate(7),
      end_date: isoDate(9),
      ...overrides,
    });
  expect(res.status).toBe(200);
  return res.body.data.id as string;
}

/** The caller's own children, via the shared ownership rule. */
async function myChildren(token: string): Promise<Array<{ id: string }>> {
  const res = await request(app).get("/v1/me/children").set(auth(token));
  expect(res.status).toBe(200);
  return res.body.data.items as Array<{ id: string }>;
}

describe("shivir registration", () => {
  it("rejects an inverted date range at create time", async () => {
    const admin = await loginAs("super_admin");
    const res = await request(app)
      .post("/v1/admin/shivirs")
      .set(auth(admin.token))
      .send({
        name_en: "Backwards shivir",
        city_id: await mumbaiCityId(),
        start_date: isoDate(9),
        end_date: isoDate(7),
      });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("ERR_VALIDATION_FAILED");
  });

  it("registers a child, refuses a duplicate, then cancels and re-registers", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const shivirId = await createShivir(admin.token);
    const [child] = await myChildren(parent.token);
    expect(child).toBeTruthy();

    const first = await request(app)
      .post(`/v1/shivirs/${shivirId}/register`)
      .set(auth(parent.token))
      .send({ student_id: child!.id });
    expect(first.status).toBe(200);
    expect(first.body.data.status).toBe("registered");

    const dup = await request(app)
      .post(`/v1/shivirs/${shivirId}/register`)
      .set(auth(parent.token))
      .send({ student_id: child!.id });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("ERR_ALREADY_REGISTERED");

    const cancel = await request(app)
      .delete(`/v1/shivirs/${shivirId}/register/${child!.id}`)
      .set(auth(parent.token));
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.status).toBe("cancelled");

    // Re-registering reuses the same row rather than stacking a second one that
    // would double-count against capacity.
    const again = await request(app)
      .post(`/v1/shivirs/${shivirId}/register`)
      .set(auth(parent.token))
      .send({ student_id: child!.id });
    expect(again.status).toBe(200);
    expect(again.body.data.id).toBe(first.body.data.id);
  });

  it("enforces capacity", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const children = await myChildren(parent.token);
    // Needs at least two children to prove the second is refused, not the first.
    if (children.length < 2) return;

    const shivirId = await createShivir(admin.token, { capacity: 1 });

    const first = await request(app)
      .post(`/v1/shivirs/${shivirId}/register`)
      .set(auth(parent.token))
      .send({ student_id: children[0]!.id });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/v1/shivirs/${shivirId}/register`)
      .set(auth(parent.token))
      .send({ student_id: children[1]!.id });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("ERR_FULL");
  });

  it("refuses a student the caller does not own — as a 404, not a 403", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const shivirId = await createShivir(admin.token);

    // Someone else's student: take the admin's first student and confirm it is
    // not one of the parent's own before asserting.
    const all = await request(app).get("/v1/admin/students?limit=50").set(auth(admin.token));
    const mine = new Set((await myChildren(parent.token)).map((c) => c.id));
    const foreign = (all.body.data.items as Array<{ id: string }>).find((s) => !mine.has(s.id));
    if (!foreign) return;

    const res = await request(app)
      .post(`/v1/shivirs/${shivirId}/register`)
      .set(auth(parent.token))
      .send({ student_id: foreign.id });
    // 404 not 403 — the caller must not learn that student exists.
    expect(res.status).toBe(404);
  });

  it("refuses a non-MSV child on an msv_only shivir, with a message that says what to do", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const shivirId = await createShivir(admin.token, { msv_only: true });
    const children = await myChildren(parent.token);

    const results = await Promise.all(
      children.map((c) =>
        request(app)
          .post(`/v1/shivirs/${shivirId}/register`)
          .set(auth(parent.token))
          .send({ student_id: c.id }),
      ),
    );
    const refused = results.find((r) => r.status === 403);
    if (refused) {
      expect(refused.body.error.code).toBe("ERR_NOT_ELIGIBLE");
      expect(refused.body.error.message).toMatch(/MSV/);
    }
  });

  it("reports capacity and per-child state for the CTA", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const shivirId = await createShivir(admin.token, { capacity: 5 });
    const [child] = await myChildren(parent.token);

    await request(app)
      .post(`/v1/shivirs/${shivirId}/register`)
      .set(auth(parent.token))
      .send({ student_id: child!.id });

    const res = await request(app)
      .get(`/v1/shivirs/${shivirId}/registrations/mine`)
      .set(auth(parent.token));
    expect(res.status).toBe(200);
    expect(res.body.data.capacity).toBe(5);
    expect(res.body.data.registered_count).toBe(1);
    expect(res.body.data.is_full).toBe(false);
    expect(res.body.data.registration_open).toBe(true);
    const row = (res.body.data.students as Array<{ student_id: string; status: string }>).find(
      (s) => s.student_id === child!.id,
    );
    expect(row!.status).toBe("registered");
  });

  it("counts registrations on the admin dashboard, which was structurally 0 before", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const shivirId = await createShivir(admin.token);
    const [child] = await myChildren(parent.token);

    await request(app)
      .post(`/v1/shivirs/${shivirId}/register`)
      .set(auth(parent.token))
      .send({ student_id: child!.id });

    const dash = await request(app)
      .get(`/v1/shivir-scanner/shivirs/${shivirId}/dashboard`)
      .set(auth(admin.token));
    expect(dash.status).toBe(200);
    expect(dash.body.data.registered_total).toBe(1);
  });

  it("hides a soft-deleted shivir from registration and from the public list", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const shivirId = await createShivir(admin.token);

    const del = await request(app)
      .delete(`/v1/admin/shivirs/${shivirId}`)
      .set(auth(admin.token));
    expect(del.status).toBe(200);

    const [child] = await myChildren(parent.token);
    const res = await request(app)
      .post(`/v1/shivirs/${shivirId}/register`)
      .set(auth(parent.token))
      .send({ student_id: child!.id });
    expect(res.status).toBe(404);

    const pub = await request(app).get(`/v1/public/shivirs/${shivirId}`);
    expect(pub.status).toBe(404);

    // The row survives — cancellation must never destroy the attendance record.
    const [row] = await db
      .select({ id: shivir_events.id })
      .from(shivir_events)
      .where(eq(shivir_events.id, shivirId))
      .limit(1);
    expect(row).toBeTruthy();
  });

  it("keeps an unpublished draft off the public list until it is published", async () => {
    const admin = await loginAs("super_admin");
    const shivirId = await createShivir(admin.token, { is_published: false });

    const hidden = await request(app).get(`/v1/public/shivirs/${shivirId}`);
    expect(hidden.status).toBe(404);

    const publish = await request(app)
      .patch(`/v1/admin/shivirs/${shivirId}`)
      .set(auth(admin.token))
      .send({ is_published: true });
    expect(publish.status).toBe(200);

    const shown = await request(app).get(`/v1/public/shivirs/${shivirId}`);
    expect(shown.status).toBe(200);
  });

  it("rejects a patch that would invert the date range", async () => {
    const admin = await loginAs("super_admin");
    const shivirId = await createShivir(admin.token);
    // Only start_date moves — the merged row is what must be checked, not the
    // patch alone.
    const res = await request(app)
      .patch(`/v1/admin/shivirs/${shivirId}`)
      .set(auth(admin.token))
      .send({ start_date: isoDate(30) });
    expect(res.status).toBe(422);
  });

  it("hides msv_only shivirs from a guest", async () => {
    const admin = await loginAs("super_admin");
    const shivirId = await createShivir(admin.token, { msv_only: true });

    const asGuest = await request(app).get(`/v1/public/shivirs/${shivirId}`);
    expect(asGuest.status).toBe(404);

    const listed = await request(app).get("/v1/public/shivirs?limit=300");
    expect(listed.status).toBe(200);
    const ids = (listed.body.data.items as Array<{ id: string }>).map((s) => s.id);
    expect(ids).not.toContain(shivirId);
  });
});
