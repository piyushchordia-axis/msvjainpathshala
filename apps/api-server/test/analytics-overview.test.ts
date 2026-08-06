/**
 * GET /v1/admin/analytics/overview — scope integrity of the metric block.
 *
 * Every metric on this endpoint is centre-scoped except the donations sum:
 * `donations` carries no centre_id and no direct city_id, so the figure cannot
 * be narrowed to a sanchalak's centres. It is therefore withheld from roles
 * outside DONATION_VIEW_ROLES rather than returned as a national total, which
 * would leak past the city_admin gate the /admin/donations page draws.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool } from "@workspace/db";
import { canViewDonations } from "@workspace/api-zod";
import { loginAs, auth, type SeedRole } from "./helpers";

afterAll(async () => {
  await pool.end();
});

async function overviewFor(role: SeedRole) {
  const session = await loginAs(role);
  const res = await request(app).get("/v1/admin/analytics/overview").set(auth(session.token));
  expect(res.status).toBe(200);
  return res.body.data as Record<string, unknown>;
}

describe("admin analytics overview — donation figure scoping", () => {
  it("omits donations_total_paise_ytd for a sanchalak", async () => {
    const data = await overviewFor("sanchalak");
    // The rest of the block still arrives — only the unscopable metric is withheld.
    expect(data.active_students).toBeTypeOf("number");
    expect(data.centres).toBeTypeOf("number");
    expect("donations_total_paise_ytd" in data).toBe(false);
  });

  it("omits donations_total_paise_ytd for a shikshak", async () => {
    const data = await overviewFor("shikshak");
    expect("donations_total_paise_ytd" in data).toBe(false);
  });

  it("still returns donations_total_paise_ytd to a city_admin", async () => {
    const data = await overviewFor("city_admin");
    expect("donations_total_paise_ytd" in data).toBe(true);
    expect(data.donations_total_paise_ytd).toBeTypeOf("number");
    expect(data.donations_total_paise_ytd as number).toBeGreaterThanOrEqual(0);
  });

  it("canViewDonations is narrower than the admin panel roster", () => {
    expect(canViewDonations("super_admin")).toBe(true);
    expect(canViewDonations("state_admin")).toBe(true);
    expect(canViewDonations("city_admin")).toBe(true);
    expect(canViewDonations("sanchalak")).toBe(false);
    expect(canViewDonations("shikshak")).toBe(false);
    expect(canViewDonations(null)).toBe(false);
  });
});
