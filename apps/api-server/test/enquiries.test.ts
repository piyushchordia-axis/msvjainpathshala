import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth } from "./helpers";

afterAll(async () => {
  await pool.end();
});

describe("/v1/enquiries", () => {
  it("accepts a public enquiry with no auth, surfaces it to admins, and lets an admin close it; non-admins are forbidden", async () => {
    // 1. PUBLIC submit (no auth) -> 200, status 'new'.
    const unique = `Test Enquiry ${Date.now()}`;
    const submit = await request(app)
      .post("/v1/enquiries")
      .send({
        kind: "enquire",
        name: unique,
        phone: "+919812345678",
        city: "Mumbai",
        message: "Please tell me about enrolling my child.",
      });
    expect(submit.status).toBe(200);
    expect(submit.body.data.status).toBe("new");
    const enquiryId: string = submit.body.data.id;
    expect(enquiryId).toBeTruthy();

    // 2. city_admin GET /v1/enquiries finds it.
    const cityAdmin = await loginAs("city_admin");
    const list = await request(app)
      .get("/v1/enquiries?kind=enquire&limit=300")
      .set(auth(cityAdmin.token));
    expect(list.status).toBe(200);
    const found = list.body.data.items.find(
      (e: { id: string }) => e.id === enquiryId,
    );
    expect(found).toBeTruthy();
    expect(found.status).toBe("new");
    expect(found.name).toBe(unique);

    // 3. city_admin marks it 'closed'.
    const close = await request(app)
      .post(`/v1/enquiries/${enquiryId}/status`)
      .set(auth(cityAdmin.token))
      .send({ status: "closed" });
    expect(close.status).toBe(200);
    expect(close.body.data.status).toBe("closed");

    // Verify the closed status filter returns it.
    const closedList = await request(app)
      .get("/v1/enquiries?status=closed&limit=300")
      .set(auth(cityAdmin.token));
    expect(closedList.status).toBe(200);
    expect(
      closedList.body.data.items.some((e: { id: string }) => e.id === enquiryId),
    ).toBe(true);

    // 4. A non-admin (parent) GET /v1/enquiries -> 403.
    const parent = await loginAs("parent");
    const denied = await request(app)
      .get("/v1/enquiries")
      .set(auth(parent.token));
    expect(denied.status).toBe(403);
  });

  it("rejects an invalid public enquiry (missing message / bad kind) with 422", async () => {
    const badKind = await request(app)
      .post("/v1/enquiries")
      .send({ kind: "spam", name: "X", message: "hi" });
    expect(badKind.status).toBe(422);

    const noMessage = await request(app)
      .post("/v1/enquiries")
      .send({ kind: "contact", name: "X" });
    expect(noMessage.status).toBe(422);
  });
});
