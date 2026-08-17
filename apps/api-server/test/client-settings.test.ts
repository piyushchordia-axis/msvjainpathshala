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

describe("80G platform settings (Q3)", () => {
  async function patchSetting(token: string, key: string, value: string) {
    return request(app).patch("/v1/admin/settings").set(auth(token)).send({ key, value });
  }

  it("rejects a non-boolean eighty_g_enabled value", async () => {
    const admin = await loginAs("super_admin");
    const res = await patchSetting(admin.token, "eighty_g_enabled", "yes please");
    expect(res.status).toBe(422);
    expect(res.body.error?.message).toContain("'true' or 'false'");
  });

  it("refuses to enable 80G until both registration number and PAN are set, then allows it", async () => {
    const admin = await loginAs("super_admin");

    // Clean slate: disabled, both fields blank (blank normalises to unset).
    for (const [key, value] of [
      ["eighty_g_enabled", "false"],
      ["eighty_g_registration_number", ""],
      ["organization_pan", ""],
    ] as const) {
      const r = await patchSetting(admin.token, key, value);
      expect(r.status).toBe(200);
    }

    const blocked = await patchSetting(admin.token, "eighty_g_enabled", "true");
    expect(blocked.status).toBe(422);
    expect(blocked.body.error?.code).toBe("ERR_VALIDATION_FAILED");
    expect(blocked.body.error?.message).toContain("80G registration number and organisation PAN");

    // Half the pair is still not enough.
    expect((await patchSetting(admin.token, "eighty_g_registration_number", "AAATM1234FF20214")).status).toBe(200);
    const stillBlocked = await patchSetting(admin.token, "eighty_g_enabled", "true");
    expect(stillBlocked.status).toBe(422);

    // Full pair → toggle accepted (value normalised to lowercase 'true').
    expect((await patchSetting(admin.token, "organization_pan", "AAATM1234F")).status).toBe(200);
    const enabled = await patchSetting(admin.token, "eighty_g_enabled", "TRUE");
    expect(enabled.status).toBe(200);
    expect(enabled.body.data.value).toBe("true");

    // Turning it off never requires the pair.
    const disabled = await patchSetting(admin.token, "eighty_g_enabled", "false");
    expect(disabled.status).toBe(200);

    // Leave the shared dev DB the way we found it: toggle off, fields blank.
    await patchSetting(admin.token, "eighty_g_registration_number", "");
    await patchSetting(admin.token, "organization_pan", "");
  });

  it("never exposes platform 80G keys on the public settings endpoint", async () => {
    const res = await request(app).get("/v1/settings/public");
    expect(res.status).toBe(200);
    const keys = (res.body.data.items as Array<{ key: string }>).map((i) => i.key);
    expect(keys).not.toContain("organization_pan");
    expect(keys).not.toContain("eighty_g_registration_number");
    expect(keys).not.toContain("eighty_g_enabled");
  });
});
