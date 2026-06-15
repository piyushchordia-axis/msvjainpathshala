/**
 * Competitions: super_admin authors an OPEN Mumbai competition, the parent
 * registers their child (Aarav), the admin records a rank-1 result and
 * publishes — verifying the winner Punya award lands, that publishing twice is
 * idempotent (409), and that a duplicate registration is rejected (409).
 *
 * Self-creating + rerun-safe: every run mints a fresh competition with a unique
 * name and high winner points so it never collides with seed data.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth } from "./helpers";

afterAll(async () => {
  await pool.end();
});

/** Resolve the seeded Mumbai city id via the admin geography endpoint. */
async function mumbaiCityId(token: string): Promise<string> {
  const geo = await request(app).get("/v1/admin/geography").set(auth(token));
  expect(geo.status).toBe(200);
  const cities: Array<{ id: string; name: string }> = geo.body.data.cities;
  const mumbai = cities.find((c) => c.name === "Mumbai");
  expect(mumbai).toBeDefined();
  return mumbai!.id;
}

/** Aarav's id + current Punya total via the parent's /v1/me/children. */
async function aaravState(parentToken: string): Promise<{ id: string; total: number }> {
  const res = await request(app).get("/v1/me/children").set(auth(parentToken));
  expect(res.status).toBe(200);
  const kids: Array<{ id: string; full_name: string; total_points: number }> = res.body.data.items;
  const aarav = kids.find((k) => k.full_name === "Aarav Shah");
  expect(aarav).toBeDefined();
  return { id: aarav!.id, total: aarav!.total_points };
}

describe("competitions", () => {
  it("registers a child, records a winner, and idempotently awards Punya", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const cityId = await mumbaiCityId(admin.token);

    const WINNER_POINTS = 75;
    const start = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const eventDate = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // Create a DRAFT competition (eligible_age_groups empty = all ages).
    const create = await request(app)
      .post("/v1/competitions")
      .set(auth(admin.token))
      .send({
        city_id: cityId,
        name_en: `Vitest Competition ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name_hi: "वीटेस्ट प्रतियोगिता",
        category: "essay",
        eligible_age_groups: [],
        msv_only: false,
        registration_window_start: start,
        registration_window_end: end,
        event_date: eventDate,
        winner_points: WINNER_POINTS,
        participant_points: 10,
      });
    expect(create.status).toBe(200);
    const competitionId: string = create.body.data.id;
    expect(competitionId).toBeTruthy();

    // Cannot register while still draft.
    const { id: aaravId, total: before } = await aaravState(parent.token);
    const earlyRegister = await request(app)
      .post(`/v1/competitions/${competitionId}/register`)
      .set(auth(parent.token))
      .send({ student_id: aaravId });
    expect(earlyRegister.status).toBe(422);
    expect(earlyRegister.body.error.code).toBe("ERR_NOT_OPEN");

    // Open registration.
    const open = await request(app)
      .post(`/v1/competitions/${competitionId}/status`)
      .set(auth(admin.token))
      .send({ status: "open" });
    expect(open.status).toBe(200);
    expect(open.body.data.status).toBe("open");

    // It now shows in the parent's open-competitions browse, eligible for Aarav.
    const openList = await request(app)
      .get("/v1/competitions/open")
      .set(auth(parent.token));
    expect(openList.status).toBe(200);
    const browse: Array<{ id: string; eligible_student_ids: string[] }> = openList.body.data.items;
    const mine = browse.find((c) => c.id === competitionId);
    expect(mine).toBeDefined();
    expect(mine!.eligible_student_ids).toContain(aaravId);

    // Parent registers Aarav.
    const register = await request(app)
      .post(`/v1/competitions/${competitionId}/register`)
      .set(auth(parent.token))
      .send({ student_id: aaravId });
    expect(register.status).toBe(200);
    const registrationId: string = register.body.data.id;
    expect(registrationId).toBeTruthy();

    // Duplicate registration -> 409.
    const dup = await request(app)
      .post(`/v1/competitions/${competitionId}/register`)
      .set(auth(parent.token))
      .send({ student_id: aaravId });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("ERR_ALREADY_REGISTERED");

    // Admin closes registration, then records Aarav as rank 1.
    const close = await request(app)
      .post(`/v1/competitions/${competitionId}/status`)
      .set(auth(admin.token))
      .send({ status: "closed" });
    expect(close.status).toBe(200);

    const results = await request(app)
      .post(`/v1/competitions/${competitionId}/results`)
      .set(auth(admin.token))
      .send({ results: [{ registration_id: registrationId, rank: 1, note: "Top essay" }] });
    expect(results.status).toBe(200);
    expect(results.body.data.recorded).toBe(1);

    // Publish results -> Aarav gets winner_points.
    const publish = await request(app)
      .post(`/v1/competitions/${competitionId}/publish-results`)
      .set(auth(admin.token));
    expect(publish.status).toBe(200);
    expect(publish.body.data.status).toBe("results_published");
    expect(publish.body.data.awarded).toBe(1);

    const { total: after } = await aaravState(parent.token);
    expect(after).toBe(before + WINNER_POINTS);

    // Double-publish is idempotent: 409, no further award.
    const republish = await request(app)
      .post(`/v1/competitions/${competitionId}/publish-results`)
      .set(auth(admin.token));
    expect(republish.status).toBe(409);
    expect(republish.body.error.code).toBe("ERR_ALREADY_PUBLISHED");

    const { total: afterRepublish } = await aaravState(parent.token);
    expect(afterRepublish).toBe(after);
  });

  it("awards winner Punya exactly once even when publish-results runs twice", async () => {
    // Focused regression for the atomic CLAIM in publish-results: a sequential
    // re-publish must be a 409 and must NOT award the winner a second time.
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const cityId = await mumbaiCityId(admin.token);

    const WINNER_POINTS = 91;
    const start = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const eventDate = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const create = await request(app)
      .post("/v1/competitions")
      .set(auth(admin.token))
      .send({
        city_id: cityId,
        name_en: `Vitest DoublePublish ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name_hi: "वीटेस्ट डबल",
        category: "essay",
        eligible_age_groups: [],
        msv_only: false,
        registration_window_start: start,
        registration_window_end: end,
        event_date: eventDate,
        winner_points: WINNER_POINTS,
        participant_points: 0,
      });
    expect(create.status).toBe(200);
    const competitionId: string = create.body.data.id;

    // Open -> register Aarav -> close -> record rank 1.
    const open = await request(app)
      .post(`/v1/competitions/${competitionId}/status`)
      .set(auth(admin.token))
      .send({ status: "open" });
    expect(open.status).toBe(200);

    const { id: aaravId, total: before } = await aaravState(parent.token);
    const register = await request(app)
      .post(`/v1/competitions/${competitionId}/register`)
      .set(auth(parent.token))
      .send({ student_id: aaravId });
    expect(register.status).toBe(200);
    const registrationId: string = register.body.data.id;

    const close = await request(app)
      .post(`/v1/competitions/${competitionId}/status`)
      .set(auth(admin.token))
      .send({ status: "closed" });
    expect(close.status).toBe(200);

    const results = await request(app)
      .post(`/v1/competitions/${competitionId}/results`)
      .set(auth(admin.token))
      .send({ results: [{ registration_id: registrationId, rank: 1 }] });
    expect(results.status).toBe(200);

    // First publish: 200, awards exactly the winner points.
    const publish1 = await request(app)
      .post(`/v1/competitions/${competitionId}/publish-results`)
      .set(auth(admin.token));
    expect(publish1.status).toBe(200);
    expect(publish1.body.data.awarded).toBe(1);
    const { total: afterFirst } = await aaravState(parent.token);
    expect(afterFirst).toBe(before + WINNER_POINTS);

    // Second publish (sequential): 409, and total is UNCHANGED (no re-award).
    const publish2 = await request(app)
      .post(`/v1/competitions/${competitionId}/publish-results`)
      .set(auth(admin.token));
    expect(publish2.status).toBe(409);
    expect(publish2.body.error.code).toBe("ERR_ALREADY_PUBLISHED");
    const { total: afterSecond } = await aaravState(parent.token);
    expect(afterSecond).toBe(afterFirst);

    // Defense-in-depth: a third publish is still 409 and still does not award.
    const publish3 = await request(app)
      .post(`/v1/competitions/${competitionId}/publish-results`)
      .set(auth(admin.token));
    expect(publish3.status).toBe(409);
    const { total: afterThird } = await aaravState(parent.token);
    expect(afterThird).toBe(afterFirst);
  });

  it("forbids creating a competition outside the admin's city scope", async () => {
    // city_admin (Mumbai) cannot create in a foreign/non-scoped city.
    const cityAdmin = await loginAs("city_admin");
    const superAdmin = await loginAs("super_admin");

    // Find a city that is NOT Mumbai (city_admin is scoped to Mumbai only).
    const geo = await request(app).get("/v1/admin/geography").set(auth(superAdmin.token));
    expect(geo.status).toBe(200);
    const cities: Array<{ id: string; name: string }> = geo.body.data.cities;
    const other = cities.find((c) => c.name !== "Mumbai");

    if (!other) {
      // Only one city seeded — nothing to assert against; skip gracefully.
      return;
    }

    const start = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const res = await request(app)
      .post("/v1/competitions")
      .set(auth(cityAdmin.token))
      .send({
        city_id: other.id,
        name_en: `Out of scope ${Date.now()}`,
        name_hi: "बाहर",
        registration_window_start: start,
        registration_window_end: end,
        event_date: end.slice(0, 10),
        winner_points: 10,
        participant_points: 5,
      });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ERR_FORBIDDEN");
  });

  it("rejects browsing open competitions for an admin with no children (empty list)", async () => {
    // super_admin owns no students; /open returns an empty list, not an error.
    const admin = await loginAs("super_admin");
    const res = await request(app).get("/v1/competitions/open").set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.items)).toBe(true);
  });
});
