/**
 * /v1/join — gan registration public + admin surfaces.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool, db, cities, centres, join_settings } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { loginAs, auth } from "./helpers";

afterAll(async () => {
  await pool.end();
});

async function cityId(code: string): Promise<string> {
  const [row] = await db.select({ id: cities.id }).from(cities).where(eq(cities.code, code)).limit(1);
  if (!row) throw new Error(`city ${code} missing — seed required`);
  return row.id;
}

async function centreWithCode(): Promise<{ id: string; code: string }> {
  const [row] = await db
    .select({ id: centres.id, code: centres.code })
    .from(centres)
    .where(eq(centres.status, "active"))
    .limit(1);
  if (!row?.code) throw new Error("active centre with code missing — seed required");
  return { id: row.id, code: row.code };
}

async function centreInCity(cityId: string): Promise<{ id: string; code: string }> {
  const [row] = await db
    .select({ id: centres.id, code: centres.code })
    .from(centres)
    .where(and(eq(centres.city_id, cityId), eq(centres.status, "active")))
    .limit(1);
  if (!row?.code) throw new Error(`active centre in city ${cityId} missing — seed required`);
  return { id: row.id, code: row.code };
}

describe("join registrations", () => {
  it("serves settings and form fields publicly", async () => {
    const settings = await request(app).get("/v1/join/settings?kind=shikshak");
    expect(settings.status).toBe(200);
    expect(settings.body.data.kind).toBe("shikshak");
    expect(typeof settings.body.data.registration_open).toBe("boolean");

    const fields = await request(app).get("/v1/join/form-fields?kind=student");
    expect(fields.status).toBe(200);
    expect(Array.isArray(fields.body.data.items)).toBe(true);
    expect(fields.body.data.items.length).toBeGreaterThan(0);
  });

  it("rejects student create when registration is closed", async () => {
    const city = await cityId("MUM");
    const centre = await centreInCity(city);
    await db
      .update(join_settings)
      .set({ value: "no", updated_at: new Date() })
      .where(and(eq(join_settings.kind, "student"), eq(join_settings.key, "registration_open")));
    const closed = await request(app).post("/v1/join/registrations").send({
      kind: "student",
      city_id: city,
      centre_id: centre.id,
      name: "Closed Test",
      parent_mobile: "9876500001",
    });
    expect(closed.status).toBe(403);
    expect(closed.body.error.code).toBe("ERR_FORBIDDEN");
    await db
      .update(join_settings)
      .set({ value: "yes", updated_at: new Date() })
      .where(and(eq(join_settings.kind, "student"), eq(join_settings.key, "registration_open")));
  });

  it("creates shikshak with PATHSHALA-SHK code, supports payment + lookup", async () => {
    const centre = await centreWithCode();
    const create = await request(app).post("/v1/join/registrations").send({
      kind: "shikshak",
      centre_id: centre.id,
      name: "Guruji Test",
      whatsapp_contact: "9876500011",
      role: "गुरुजी",
      age: 40,
    });
    expect(create.status).toBe(201);
    expect(create.body.data.display_code).toMatch(
      new RegExp(`^${centre.code.replace(/-/g, "\\-")}-SHK-\\d{5}$`),
    );
    const id = create.body.data.id as string;
    const code = create.body.data.display_code as string;
    const screenshot = "http://localhost:8080/uploads/join-registration/pay-proof.png";

    // Payment PATCH is throttled and mobile-authorised (guest re-review #1):
    // the registration UUID leaks through create/lookup, so alone it must not
    // authorise a write, and the response must not dump the row's PII.
    const noMobile = await request(app).patch(`/v1/join/registrations/${id}/payment`).send({
      kind: "shikshak",
      payment_screenshot_url: screenshot,
      has_paid: "yes",
    });
    expect(noMobile.status).toBe(422);

    const wrongMobilePay = await request(app).patch(`/v1/join/registrations/${id}/payment`).send({
      kind: "shikshak",
      payment_screenshot_url: screenshot,
      has_paid: "yes",
      mobile: "1112223334",
    });
    expect(wrongMobilePay.status).toBe(404);

    const externalUrl = await request(app).patch(`/v1/join/registrations/${id}/payment`).send({
      kind: "shikshak",
      payment_screenshot_url: "https://example.com/pay.png",
      has_paid: "yes",
      mobile: "9876500011",
    });
    expect(externalUrl.status).toBe(422);

    const pay = await request(app).patch(`/v1/join/registrations/${id}/payment`).send({
      kind: "shikshak",
      payment_screenshot_url: screenshot,
      has_paid: "yes",
      mobile: "9876500011",
    });
    expect(pay.status).toBe(200);
    expect(pay.body.data.has_paid).toBe("yes");
    // Minimal projection only — the old handler returned the entire row.
    expect(Object.keys(pay.body.data).sort()).toEqual(["display_code", "has_paid", "id"]);
    expect(pay.body.data).not.toHaveProperty("whatsapp_contact");
    expect(pay.body.data).not.toHaveProperty("address");

    // Idempotent: a replay does not error and stays minimal.
    const replay = await request(app).patch(`/v1/join/registrations/${id}/payment`).send({
      kind: "shikshak",
      payment_screenshot_url: screenshot,
      has_paid: "yes",
      mobile: "9876500011",
    });
    expect(replay.status).toBe(200);
    expect(replay.body.data.has_paid).toBe("yes");

    // Code alone is refused — sequential codes were a name-enumeration oracle;
    // the registered mobile is the required shared secret (GST-API-11).
    const codeOnly = await request(app).get(
      `/v1/join/registrations/lookup?kind=shikshak&display_code=${encodeURIComponent(code)}`,
    );
    expect(codeOnly.status).toBe(422);

    const lookup = await request(app).get(
      `/v1/join/registrations/lookup?kind=shikshak&mobile=9876500011&display_code=${encodeURIComponent(code)}`,
    );
    expect(lookup.status).toBe(200);
    expect(lookup.body.data.items[0].display_code).toBe(code);
    expect(lookup.body.data.items[0].has_paid).toBe("yes");

    // A valid code paired with the wrong mobile must not disclose the record.
    const wrongMobile = await request(app).get(
      `/v1/join/registrations/lookup?kind=shikshak&mobile=1112223334&display_code=${encodeURIComponent(code)}`,
    );
    expect(wrongMobile.status).toBe(404);
  });

  it("creates sanchalak with PATHSHALA-SAN code", async () => {
    const centre = await centreWithCode();
    const create = await request(app).post("/v1/join/registrations").send({
      kind: "sanchalak",
      centre_id: centre.id,
      name: "Sanchalak Test",
      whatsapp_contact: "9876500012",
      role: "संचालक",
      age: 45,
    });
    expect(create.status).toBe(201);
    expect(create.body.data.display_code).toMatch(
      new RegExp(`^${centre.code.replace(/-/g, "\\-")}-SAN-\\d{5}$`),
    );
  });

  it("opens student registration, allocates CITY-STU code, admin lists and closes", async () => {
    const admin = await loginAs("super_admin");
    const open = await request(app)
      .put("/v1/join/settings/registration_open?kind=student")
      .set(auth(admin.token))
      .send({ value: "yes" });
    expect(open.status).toBe(200);

    const city = await cityId("MUM");
    const centre = await centreInCity(city);
    const create = await request(app).post("/v1/join/registrations").send({
      kind: "student",
      city_id: city,
      centre_id: centre.id,
      name: "Student Join",
      parent_mobile: "9876500022",
      age: 12,
    });
    expect(create.status).toBe(201);
    expect(create.body.data.display_code).toMatch(/^MUM-STU-\d{5}$/);
    expect(create.body.data.status).toBe("pending");

    const list = await request(app)
      .get("/v1/join/registrations?kind=student&status=pending&q=Student%20Join")
      .set(auth(admin.token));
    expect(list.status).toBe(200);
    expect(list.body.data.items.some((r: { name: string }) => r.name === "Student Join")).toBe(true);

    const stats = await request(app)
      .get("/v1/join/registrations/stats?kind=student")
      .set(auth(admin.token));
    expect(stats.status).toBe(200);
    expect(stats.body.data.total).toBeGreaterThanOrEqual(1);
    expect(typeof stats.body.data.pending).toBe("number");

    // Student payment PATCH matches parent_mobile and never echoes it back.
    const regId = create.body.data.id as string;
    const pay = await request(app).patch(`/v1/join/registrations/${regId}/payment`).send({
      kind: "student",
      payment_screenshot_url: "http://localhost:8080/uploads/join-registration/stu-pay.png",
      has_paid: "yes",
      mobile: "9876500022",
    });
    expect(pay.status).toBe(200);
    expect(Object.keys(pay.body.data).sort()).toEqual(["display_code", "has_paid", "id"]);
    expect(pay.body.data).not.toHaveProperty("parent_mobile");

    await request(app)
      .put("/v1/join/settings/registration_open?kind=student")
      .set(auth(admin.token))
      .send({ value: "yes" });
  });
});
