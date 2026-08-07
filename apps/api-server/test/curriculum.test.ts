import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth, type Session } from "./helpers";

afterAll(async () => {
  await pool.end(); // close the shared pg pool so vitest exits cleanly
});

/**
 * Curriculum authoring (/v1/curriculum) owns the section + item CRUD beneath a
 * curriculum shell. Authoring is CITY-scoped via the parent curriculum's
 * city_id; a CENTRAL / MSV curriculum (city_id IS NULL) is national content
 * editable only by super_admin (Q2 / CU8).
 *
 * This test is additive & rerun-safe: it mints its own curricula via the admin
 * create endpoint each run (super_admin can target any city), so it never
 * relies on specific seed rows beyond the seeded personas, and never asserts
 * global row counts. The city_admin persona is scoped to a single city; we
 * discover an "other" city from the admin resources list rather than hardcoding
 * ids.
 */

const UUID_NONEXISTENT = "00000000-0000-0000-0000-000000000000";

/** super_admin: list states + cities (admin resources). */
async function listCities(adminToken: string): Promise<Array<{ id: string; name: string }>> {
  const res = await request(app).get("/v1/admin/geography").set(auth(adminToken));
  if (res.status === 200 && Array.isArray(res.body.data?.cities)) {
    return res.body.data.cities as Array<{ id: string; name: string }>;
  }
  // Fallback: derive cities from the centres list if the geography route differs.
  const centres = await request(app).get("/v1/admin/centres").set(auth(adminToken));
  expect(centres.status).toBe(200);
  const seen = new Map<string, string>();
  for (const c of centres.body.data.items as Array<{ city_id?: string; city_name?: string }>) {
    if (c.city_id) seen.set(c.city_id, c.city_name ?? "");
  }
  return Array.from(seen, ([id, name]) => ({ id, name }));
}

/** The city the city_admin persona is scoped to (their single curricula city). */
async function cityAdminCity(cityAdminToken: string, superToken: string): Promise<string> {
  // The admin curricula list for a city_admin only returns their own city's
  // curricula; create one for each candidate city as super_admin until the
  // city_admin can see it. Simpler: the city_admin's own /admin/curricula list
  // is city-filtered, so any curriculum we make in their city shows up there.
  const cities = await listCities(superToken);
  expect(cities.length).toBeGreaterThan(0);
  for (const city of cities) {
    const probe = await request(app)
      .post("/v1/admin/curricula")
      .set(auth(superToken))
      .send({ name: `scope-probe ${Date.now()}-${city.id.slice(0, 6)}`, kind: "standard", city_id: city.id });
    expect(probe.status).toBe(200);
    const list = await request(app).get("/v1/admin/curricula").set(auth(cityAdminToken));
    expect(list.status).toBe(200);
    const visible = (list.body.data.items as Array<{ id: string }>).some((c) => c.id === probe.body.data.id);
    if (visible) return city.id;
  }
  throw new Error("could not determine the city_admin's scoped city");
}

/** Create a curriculum as super_admin in the given city (null = central/MSV). */
async function createCurriculum(
  superToken: string,
  cityId: string | null,
  kind = "standard",
): Promise<string> {
  const payload: Record<string, unknown> = { name: `test-curriculum ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, kind };
  if (cityId) payload.city_id = cityId;
  const res = await request(app).post("/v1/admin/curricula").set(auth(superToken)).send(payload);
  expect(res.status).toBe(200);
  expect(res.body.data.id).toBeTruthy();
  return res.body.data.id as string;
}

describe("curriculum authoring", () => {
  it("requires authentication", async () => {
    const res = await request(app)
      .post(`/v1/curriculum/${UUID_NONEXISTENT}/sections`)
      .send({ title_en: "X", title_hi: "X" });
    expect(res.status).toBe(401);
  });

  it("denies a non-admin (parent) from authoring sections (403)", async () => {
    const parent = await loginAs("parent");
    const res = await request(app)
      .post(`/v1/curriculum/${UUID_NONEXISTENT}/sections`)
      .set(auth(parent.token))
      .send({ title_en: "X", title_hi: "X" });
    expect(res.status).toBe(403);
  });

  it("denies a non-admin (student) from authoring sections (403)", async () => {
    const student = await loginAs("student");
    const res = await request(app)
      .post(`/v1/curriculum/${UUID_NONEXISTENT}/sections`)
      .set(auth(student.token))
      .send({ title_en: "X", title_hi: "X" });
    expect(res.status).toBe(403);
  });

  it("runs the full section + item CRUD lifecycle for an authorized admin", async () => {
    const admin = await loginAs("super_admin");
    const cityAdmin = await loginAs("city_admin");
    const myCity = await cityAdminCity(cityAdmin.token, admin.token);

    // A curriculum in the city_admin's own city: they may author it.
    const curriculumId = await createCurriculum(admin.token, myCity, "standard");

    // CREATE a section.
    const createSection = await request(app)
      .post(`/v1/curriculum/${curriculumId}/sections`)
      .set(auth(cityAdmin.token))
      .send({ title_en: "Sutras", title_hi: "सूत्र" });
    expect(createSection.status).toBe(200);
    const sectionId: string = createSection.body.data.id;
    expect(sectionId).toBeTruthy();

    // LIST: the section appears in the admin curriculum tree.
    const tree1 = await request(app)
      .get(`/v1/admin/curricula/${curriculumId}/tree`)
      .set(auth(cityAdmin.token));
    expect(tree1.status).toBe(200);
    const sec1 = (tree1.body.data.sections as Array<{ id: string; title_en: string }>).find(
      (s) => s.id === sectionId,
    );
    expect(sec1).toBeTruthy();
    expect(sec1?.title_en).toBe("Sutras");

    // UPDATE (rename) the section.
    const renameSection = await request(app)
      .patch(`/v1/curriculum/sections/${sectionId}`)
      .set(auth(cityAdmin.token))
      .send({ title_en: "Sutras (revised)" });
    expect(renameSection.status).toBe(200);

    // CREATE an item under the section.
    const createItem = await request(app)
      .post(`/v1/curriculum/sections/${sectionId}/items`)
      .set(auth(cityAdmin.token))
      .send({ title_en: "Navkar Mantra", title_hi: "नवकार मंत्र", description_en: "Recite daily." });
    expect(createItem.status).toBe(200);
    const itemId: string = createItem.body.data.id;
    expect(itemId).toBeTruthy();

    // LIST: the renamed section + new item appear in the tree.
    const tree2 = await request(app)
      .get(`/v1/admin/curricula/${curriculumId}/tree`)
      .set(auth(cityAdmin.token));
    expect(tree2.status).toBe(200);
    const sec2 = (tree2.body.data.sections as Array<{ id: string; title_en: string; items: Array<{ id: string; title_en: string }> }>).find(
      (s) => s.id === sectionId,
    );
    expect(sec2?.title_en).toBe("Sutras (revised)");
    const item2 = sec2?.items.find((i) => i.id === itemId);
    expect(item2).toBeTruthy();
    expect(item2?.title_en).toBe("Navkar Mantra");

    // UPDATE the item.
    const updateItem = await request(app)
      .patch(`/v1/curriculum/items/${itemId}`)
      .set(auth(cityAdmin.token))
      .send({ title_en: "Navkar Mantra (108x)" });
    expect(updateItem.status).toBe(200);

    // DELETE the item.
    const deleteItem = await request(app)
      .delete(`/v1/curriculum/items/${itemId}`)
      .set(auth(cityAdmin.token));
    expect(deleteItem.status).toBe(200);
    expect(deleteItem.body.data.deleted).toBe(true);

    // DELETE the section (items cascade).
    const deleteSection = await request(app)
      .delete(`/v1/curriculum/sections/${sectionId}`)
      .set(auth(cityAdmin.token));
    expect(deleteSection.status).toBe(200);
    expect(deleteSection.body.data.deleted).toBe(true);

    // LIST: section is gone from the tree.
    const tree3 = await request(app)
      .get(`/v1/admin/curricula/${curriculumId}/tree`)
      .set(auth(cityAdmin.token));
    expect(tree3.status).toBe(200);
    expect(
      (tree3.body.data.sections as Array<{ id: string }>).some((s) => s.id === sectionId),
    ).toBe(false);
  });

  it("returns 422 on invalid section/item payloads", async () => {
    const admin = await loginAs("super_admin");
    const cityAdmin = await loginAs("city_admin");
    const myCity = await cityAdminCity(cityAdmin.token, admin.token);
    const curriculumId = await createCurriculum(admin.token, myCity, "standard");

    // Section: missing title_hi.
    const badSection = await request(app)
      .post(`/v1/curriculum/${curriculumId}/sections`)
      .set(auth(cityAdmin.token))
      .send({ title_en: "Only English" });
    expect(badSection.status).toBe(422);
    expect(badSection.body.error.code).toBe("ERR_VALIDATION_FAILED");

    // Section: empty title.
    const emptyTitle = await request(app)
      .post(`/v1/curriculum/${curriculumId}/sections`)
      .set(auth(cityAdmin.token))
      .send({ title_en: "", title_hi: "x" });
    expect(emptyTitle.status).toBe(422);

    // A valid section to hang a bad item off of.
    const section = await request(app)
      .post(`/v1/curriculum/${curriculumId}/sections`)
      .set(auth(cityAdmin.token))
      .send({ title_en: "Valid", title_hi: "मान्य" });
    expect(section.status).toBe(200);
    const sectionId: string = section.body.data.id;

    // Item: missing both required titles.
    const badItem = await request(app)
      .post(`/v1/curriculum/sections/${sectionId}/items`)
      .set(auth(cityAdmin.token))
      .send({ description_en: "no title" });
    expect(badItem.status).toBe(422);
    expect(badItem.body.error.code).toBe("ERR_VALIDATION_FAILED");

    // Update with an empty body (refine: at least one field required).
    const emptyUpdate = await request(app)
      .patch(`/v1/curriculum/sections/${sectionId}`)
      .set(auth(cityAdmin.token))
      .send({});
    expect(emptyUpdate.status).toBe(422);

    // cleanup (idempotent best-effort).
    await request(app).delete(`/v1/curriculum/sections/${sectionId}`).set(auth(cityAdmin.token));
  });

  it("returns 404 for authoring against a non-existent / malformed curriculum", async () => {
    const admin = await loginAs("super_admin");

    const missing = await request(app)
      .post(`/v1/curriculum/${UUID_NONEXISTENT}/sections`)
      .set(auth(admin.token))
      .send({ title_en: "X", title_hi: "X" });
    expect(missing.status).toBe(404);

    const malformed = await request(app)
      .post(`/v1/curriculum/not-a-uuid/sections`)
      .set(auth(admin.token))
      .send({ title_en: "X", title_hi: "X" });
    expect(malformed.status).toBe(404);
  });
});

describe("curriculum cross-city authoring isolation", () => {
  it("forbids a city_admin from authoring another city's curriculum (404)", async () => {
    const admin = await loginAs("super_admin");
    const cityAdmin = await loginAs("city_admin");
    const myCity = await cityAdminCity(cityAdmin.token, admin.token);

    const cities = await listCities(admin.token);
    const otherCity = cities.find((c) => c.id !== myCity);
    expect(otherCity, "test DB needs at least two cities").toBeTruthy();

    // Curriculum owned by a DIFFERENT city.
    const foreignCurriculum = await createCurriculum(admin.token, otherCity!.id, "standard");

    // super_admin (unrestricted) CAN author it — proves the curriculum is real.
    const okSection = await request(app)
      .post(`/v1/curriculum/${foreignCurriculum}/sections`)
      .set(auth(admin.token))
      .send({ title_en: "Foreign", title_hi: "विदेशी" });
    expect(okSection.status).toBe(200);

    // city_admin must NOT author the foreign curriculum -> scoped out as 404.
    const denied = await request(app)
      .post(`/v1/curriculum/${foreignCurriculum}/sections`)
      .set(auth(cityAdmin.token))
      .send({ title_en: "Sneaky", title_hi: "चुपके" });
    expect(denied.status).toBe(404);

    // Likewise they cannot rename/delete a section that lives in the foreign curriculum.
    const foreignSectionId: string = okSection.body.data.id;
    const renameDenied = await request(app)
      .patch(`/v1/curriculum/sections/${foreignSectionId}`)
      .set(auth(cityAdmin.token))
      .send({ title_en: "hijack" });
    expect(renameDenied.status).toBe(404);
  });

  it("forbids a city_admin from authoring a central / MSV (city-agnostic) curriculum (403)", async () => {
    const admin = await loginAs("super_admin");
    const stateAdmin = await loginAs("state_admin");
    const cityAdmin = await loginAs("city_admin");

    // Central curriculum: city_id NULL, kind 'msv'.
    const centralCurriculum = await createCurriculum(admin.token, null, "msv");

    // super_admin may author national content.
    const adminSection = await request(app)
      .post(`/v1/curriculum/${centralCurriculum}/sections`)
      .set(auth(admin.token))
      .send({ title_en: "National", title_hi: "राष्ट्रीय" });
    expect(adminSection.status).toBe(200);

    // Q2 / CU8 — state_admin is NOT a national author.
    const stateSection = await request(app)
      .post(`/v1/curriculum/${centralCurriculum}/sections`)
      .set(auth(stateAdmin.token))
      .send({ title_en: "State authored", title_hi: "राज्य" });
    expect(stateSection.status).toBe(403);

    // city_admin is explicitly excluded from national content -> 403 (not 404).
    const denied = await request(app)
      .post(`/v1/curriculum/${centralCurriculum}/sections`)
      .set(auth(cityAdmin.token))
      .send({ title_en: "City tries national", title_hi: "शहर" });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("ERR_FORBIDDEN");
  });
});

describe("progress cross-city scope isolation", () => {
  it("requires auth on the progress grid", async () => {
    const res = await request(app).get(`/v1/progress/students/${UUID_NONEXISTENT}`);
    expect(res.status).toBe(401);
  });

  it("a city_admin cannot read curriculum-progress for a student in another city", async () => {
    const admin = await loginAs("super_admin");
    const cityAdmin = await loginAs("city_admin");

    // super_admin sees ALL students; city_admin sees only their city's students.
    const allRes = await request(app).get("/v1/admin/students?limit=500").set(auth(admin.token));
    expect(allRes.status).toBe(200);
    const all = allRes.body.data.items as Array<{ id: string }>;
    expect(all.length).toBeGreaterThan(0);

    const myRes = await request(app).get("/v1/admin/students?limit=500").set(auth(cityAdmin.token));
    expect(myRes.status).toBe(200);
    const mine = new Set((myRes.body.data.items as Array<{ id: string }>).map((s) => s.id));
    expect(mine.size).toBeGreaterThan(0);

    // An out-of-scope student = visible to super_admin, NOT to the city_admin.
    const foreignStudent = all.find((s) => !mine.has(s.id));
    expect(
      foreignStudent,
      "test DB needs a student outside the city_admin's city",
    ).toBeTruthy();

    // The leak fix: progress grid for a foreign-city student is scoped out (404).
    const denied = await request(app)
      .get(`/v1/progress/students/${foreignStudent!.id}`)
      .set(auth(cityAdmin.token));
    expect(denied.status).toBe(404);

    // Sanity: an IN-scope student IS readable by the same city_admin (200),
    // proving the 404 is scope enforcement, not a blanket denial.
    const inScopeId = [...mine][0];
    const allowed = await request(app)
      .get(`/v1/progress/students/${inScopeId}`)
      .set(auth(cityAdmin.token));
    expect(allowed.status).toBe(200);
    expect(Array.isArray(allowed.body.data.items)).toBe(true);

    // The same scoping guards the write path (setting a level) and reports.
    const writeDenied = await request(app)
      .post(`/v1/progress/students/${foreignStudent!.id}/items/${UUID_NONEXISTENT}`)
      .set(auth(cityAdmin.token))
      .send({ level: "completed" });
    expect(writeDenied.status).toBe(404);

    const reportsDenied = await request(app)
      .post(`/v1/progress/students/${foreignStudent!.id}/reports`)
      .set(auth(cityAdmin.token))
      .send({ period_kind: "monthly", period_label: `leak-${Date.now()}` });
    expect(reportsDenied.status).toBe(404);
  });

  it("only relevant (own-city or central) curriculum items leak into a student's grid", async () => {
    const admin = await loginAs("super_admin");
    const cityAdmin = await loginAs("city_admin");
    const myCity = await cityAdminCity(cityAdmin.token, admin.token);

    const cities = await listCities(admin.token);
    const otherCity = cities.find((c) => c.id !== myCity);
    expect(otherCity).toBeTruthy();

    // A unique item in ANOTHER city's curriculum.
    const foreignCurriculum = await createCurriculum(admin.token, otherCity!.id, "standard");
    const fSection = await request(app)
      .post(`/v1/curriculum/${foreignCurriculum}/sections`)
      .set(auth(admin.token))
      .send({ title_en: "Foreign sec", title_hi: "f" });
    const foreignTag = `FOREIGN-${Date.now()}`;
    const fItem = await request(app)
      .post(`/v1/curriculum/sections/${fSection.body.data.id}/items`)
      .set(auth(admin.token))
      .send({ title_en: foreignTag, title_hi: "f" });
    expect(fItem.status).toBe(200);

    // Pick an in-scope (own-city) student for the city_admin.
    const myRes = await request(app).get("/v1/admin/students?limit=500").set(auth(cityAdmin.token));
    const myStudent = (myRes.body.data.items as Array<{ id: string }>)[0];
    expect(myStudent).toBeTruthy();

    // The own-city student's grid must NOT contain the foreign-city item.
    const grid = await request(app)
      .get(`/v1/progress/students/${myStudent.id}`)
      .set(auth(cityAdmin.token));
    expect(grid.status).toBe(200);
    const titles = (grid.body.data.items as Array<{ title_en: string }>).map((i) => i.title_en);
    expect(titles).not.toContain(foreignTag);
  });
});
