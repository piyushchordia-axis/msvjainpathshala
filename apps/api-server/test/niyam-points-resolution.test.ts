/**
 * resolveNiyamAwardPoints — city config > global config > the niyam's own points.
 *
 * Why this file exists: nothing exercised this function past its default
 * branch, so C3 shipped unnoticed. `POST /v1/admin/punya/configs` took a
 * free-text feature_key, always wrote a GLOBAL row (it could not set city_id),
 * was open to any city_admin, wrote no audit entry, and the resolver read with
 * `.limit(1)` and no ORDER BY. One city administrator typing `niyam_submission`
 * into a text box silently re-priced every niyam in the country.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { db, pool, punya_configs, centres, students } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { loginAs, auth, type Session } from "./helpers";
import { resolveNiyamAwardPoints } from "../src/lib/niyam-points";

afterAll(async () => {
  await pool.end();
});

const FEATURE = "niyam_submission";
const AUTHORED = 10;

let admin: Session;
let cityAdmin: Session;
let parent: Session;
let childCityId: string | null = null;

/** Remove every config for the award feature so each case starts clean. */
async function clearConfigs(): Promise<void> {
  await db.delete(punya_configs).where(eq(punya_configs.feature_key, FEATURE));
}

beforeAll(async () => {
  admin = await loginAs("super_admin");
  cityAdmin = await loginAs("city_admin");
  parent = await loginAs("parent");

  const children = await request(app).get("/v1/me/children").set(auth(parent.token));
  const childId = children.body.data.items[0].id as string;
  const [row] = await db
    .select({ city_id: centres.city_id })
    .from(students)
    .leftJoin(centres, eq(centres.id, students.centre_id))
    .where(eq(students.id, childId))
    .limit(1);
  childCityId = row?.city_id ?? null;
  await clearConfigs();
});

describe("niyam award points resolution", () => {
  it("falls back to the niyam's authored points when no config exists", async () => {
    await clearConfigs();
    await expect(resolveNiyamAwardPoints(AUTHORED, childCityId)).resolves.toBe(AUTHORED);
  });

  it("a global config overrides the authored points", async () => {
    await clearConfigs();
    await db.insert(punya_configs).values({
      feature_key: FEATURE,
      points: 77,
      city_id: null,
      is_active: true,
    });
    await expect(resolveNiyamAwardPoints(AUTHORED, childCityId)).resolves.toBe(77);
  });

  it("a city config beats the global one", async () => {
    if (!childCityId) return;
    await clearConfigs();
    await db.insert(punya_configs).values([
      { feature_key: FEATURE, points: 77, city_id: null, is_active: true },
      { feature_key: FEATURE, points: 33, city_id: childCityId, is_active: true },
    ]);
    await expect(resolveNiyamAwardPoints(AUTHORED, childCityId)).resolves.toBe(33);
    // A different city still sees the global value.
    await expect(resolveNiyamAwardPoints(AUTHORED, null)).resolves.toBe(77);
  });

  it("an inactive config is ignored", async () => {
    await clearConfigs();
    await db.insert(punya_configs).values({
      feature_key: FEATURE,
      points: 77,
      city_id: null,
      is_active: false,
    });
    await expect(resolveNiyamAwardPoints(AUTHORED, childCityId)).resolves.toBe(AUTHORED);
  });
});

describe("POST /v1/admin/punya/configs — scope + audit (C3)", () => {
  it("refuses a global (all-city) write from a city_admin", async () => {
    await clearConfigs();
    const res = await request(app)
      .post("/v1/admin/punya/configs")
      .set(auth(cityAdmin.token))
      .send({ feature_key: FEATURE, points: 99, city_id: null });

    expect(res.status).toBe(403);

    const globals = await db
      .select()
      .from(punya_configs)
      .where(and(eq(punya_configs.feature_key, FEATURE), isNull(punya_configs.city_id)));
    expect(globals).toHaveLength(0);
  });

  it("scopes a city_admin's config to their own city rather than globally", async () => {
    await clearConfigs();
    const res = await request(app)
      .post("/v1/admin/punya/configs")
      .set(auth(cityAdmin.token))
      .send({ feature_key: FEATURE, points: 42 });

    expect([200, 201]).toContain(res.status);

    const rows = await db
      .select()
      .from(punya_configs)
      .where(eq(punya_configs.feature_key, FEATURE));
    expect(rows).toHaveLength(1);
    // The bug: this landed with city_id NULL and re-priced every city.
    expect(rows[0]!.city_id).not.toBeNull();
  });

  it("rejects a duplicate config for the same (feature, city)", async () => {
    await clearConfigs();
    const first = await request(app)
      .post("/v1/admin/punya/configs")
      .set(auth(cityAdmin.token))
      .send({ feature_key: FEATURE, points: 42 });
    expect([200, 201]).toContain(first.status);

    const second = await request(app)
      .post("/v1/admin/punya/configs")
      .set(auth(cityAdmin.token))
      .send({ feature_key: FEATURE, points: 43 });
    expect(second.status).toBe(409);
  });

  it("lets a super_admin set the global value", async () => {
    await clearConfigs();
    const res = await request(app)
      .post("/v1/admin/punya/configs")
      .set(auth(admin.token))
      .send({ feature_key: FEATURE, points: 55, city_id: null });

    expect([200, 201]).toContain(res.status);
    const rows = await db
      .select()
      .from(punya_configs)
      .where(and(eq(punya_configs.feature_key, FEATURE), isNull(punya_configs.city_id)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.points).toBe(55);
    await clearConfigs();
  });
});
