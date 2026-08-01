import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth } from "./helpers";

afterAll(async () => {
  await pool.end();
});

describe("client settings", () => {
  it("lets anyone read allowlisted keys and never leaks default_otp_code", async () => {
    const res = await request(app).get("/v1/settings/public");
    expect(res.status).toBe(200);
    const items = res.body.data.items as Array<{ key: string; value: string }>;
    expect(Array.isArray(items)).toBe(true);
    const keys = items.map((i) => i.key);
    expect(keys).not.toContain("default_otp_code");
    // Seed (or prior PATCH) should have the carousel interval.
    const interval = items.find((i) => i.key === "gallery_carousel_interval_ms");
    expect(interval).toBeTruthy();
    expect(typeof interval!.value).toBe("string");
  });

  it("rejects PATCH from a non-super_admin", async () => {
    const city = await loginAs("city_admin");
    const res = await request(app)
      .patch("/v1/admin/settings")
      .set(auth(city.token))
      .send({ key: "gallery_carousel_interval_ms", value: "2500" });
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe("ERR_FORBIDDEN");
  });

  it("rejects PATCH for an off-allowlist key", async () => {
    const admin = await loginAs("super_admin");
    const res = await request(app)
      .patch("/v1/admin/settings")
      .set(auth(admin.token))
      .send({ key: "default_otp_code", value: "999999" });
    expect(res.status).toBe(422);
    expect(res.body.error?.code).toBe("ERR_VALIDATION_FAILED");
  });

  it("lets super_admin PATCH an allowlisted key and public GET reflects it", async () => {
    const admin = await loginAs("super_admin");
    const next = String(2100 + (Date.now() % 500));
    const patch = await request(app)
      .patch("/v1/admin/settings")
      .set(auth(admin.token))
      .send({ key: "gallery_carousel_interval_ms", value: next });
    expect(patch.status).toBe(200);
    expect(patch.body.data.key).toBe("gallery_carousel_interval_ms");
    expect(patch.body.data.value).toBe(next);

    const pub = await request(app).get("/v1/settings/public");
    expect(pub.status).toBe(200);
    const items = pub.body.data.items as Array<{ key: string; value: string }>;
    const row = items.find((i) => i.key === "gallery_carousel_interval_ms");
    expect(row?.value).toBe(next);

    // Restore default so other suites / manual checks stay predictable.
    await request(app)
      .patch("/v1/admin/settings")
      .set(auth(admin.token))
      .send({ key: "gallery_carousel_interval_ms", value: "2000" });
  });
});
