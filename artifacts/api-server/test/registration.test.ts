import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth } from "./helpers";

afterAll(async () => {
  await pool.end(); // close the shared pg pool so vitest exits cleanly
});

/**
 * Self-creating, rerun-safe: each test publishes its OWN fresh global config
 * for kind 'student' (a new version_no every run, so we never collide with the
 * seed or prior runs) and uses a unique required-field key per run so the
 * public fetch/submit path always resolves to a config WE control.
 *
 * Resolution rule under test: with no city_id, the public GET returns the
 * highest-version global config — which is the one we just published.
 */
function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
}

describe("registration forms", () => {
  it("publishes a config, serves it publicly, validates required fields, submits, and reviews", async () => {
    const admin = await loginAs("super_admin");
    const suffix = uniqueSuffix();
    const reqKey = `req_${suffix}`; // required field
    const optKey = `opt_${suffix}`; // optional field

    // 1. super_admin publishes a global 'student' config with 2 fields (1 required).
    const create = await request(app)
      .post("/v1/registration/configs")
      .set(auth(admin.token))
      .send({
        form_kind: "student",
        title_en: `Student Registration ${suffix}`,
        title_hi: "विद्यार्थी पंजीकरण",
        fields: [
          { key: reqKey, label_en: "Full Name", type: "text", required: true },
          { key: optKey, label_en: "Notes", type: "textarea", required: false },
        ],
      });
    expect(create.status).toBe(200);
    expect(typeof create.body.data.id).toBe("string");
    expect(create.body.data.version_no).toBeGreaterThanOrEqual(1);

    // 2. Public GET (no auth) resolves the active config (highest global version = ours).
    const publicGet = await request(app).get("/v1/registration/forms/student");
    expect(publicGet.status).toBe(200);
    expect(publicGet.body.data.form_kind).toBe("student");
    expect(Array.isArray(publicGet.body.data.fields)).toBe(true);
    const servedKeys = publicGet.body.data.fields.map((f: { key: string }) => f.key);
    expect(servedKeys).toContain(reqKey);

    // 3. Public POST missing the required field -> 422 listing the missing key.
    const missing = await request(app)
      .post("/v1/registration/forms/student/responses")
      .send({ full_name: "Test Applicant", responses: { [optKey]: "just a note" } });
    expect(missing.status).toBe(422);
    expect(missing.body.error.code).toBe("ERR_VALIDATION_FAILED");
    expect(missing.body.error.details.missing).toContain(reqKey);

    // 4. Public POST with the required field present -> 200 (status 'submitted').
    const submit = await request(app)
      .post("/v1/registration/forms/student/responses")
      .send({
        full_name: "Test Applicant",
        phone: "+919999999999",
        responses: { [reqKey]: "Aarav Test", [optKey]: "hello" },
      });
    expect(submit.status).toBe(200);
    expect(submit.body.data.status).toBe("submitted");
    const responseId: string = submit.body.data.id;
    expect(typeof responseId).toBe("string");

    // 5. super_admin lists responses, finds ours, and approves it.
    const list = await request(app)
      .get("/v1/registration/responses?kind=student&limit=300")
      .set(auth(admin.token));
    expect(list.status).toBe(200);
    const found = list.body.data.items.find((r: { id: string }) => r.id === responseId);
    expect(found).toBeTruthy();
    expect(found.status).toBe("submitted");

    const approve = await request(app)
      .post(`/v1/registration/responses/${responseId}/approve`)
      .set(auth(admin.token))
      .send({ review_note: "Looks good." });
    expect(approve.status).toBe(200);
    expect(approve.body.data.status).toBe("approved");
  });

  it("rejects an unknown form kind with 404 (public fetch)", async () => {
    const res = await request(app).get("/v1/registration/forms/teacher");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ERR_NOT_FOUND");
  });

  it("requires admin panel for config publishing", async () => {
    const parent = await loginAs("parent");
    const res = await request(app)
      .post("/v1/registration/configs")
      .set(auth(parent.token))
      .send({ form_kind: "student", title_en: "Nope", fields: [] });
    expect(res.status).toBe(403);
  });

  it("requires auth for listing responses", async () => {
    const res = await request(app).get("/v1/registration/responses");
    expect(res.status).toBe(401);
  });
});
