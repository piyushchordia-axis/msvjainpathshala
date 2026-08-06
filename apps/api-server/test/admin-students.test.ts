/**
 * GET /v1/admin/students — search, status filter, names, keyset cursor.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth } from "./helpers";

afterAll(async () => {
  await pool.end();
});

describe("GET /v1/admin/students", () => {
  it("returns batch_name and centre_name on each row", async () => {
    const session = await loginAs("sanchalak");
    const res = await request(app)
      .get("/v1/admin/students?limit=10")
      .set(auth(session.token));
    expect(res.status).toBe(200);
    const items = res.body.data.items as Array<Record<string, unknown>>;
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    const row = items[0]!;
    expect("batch_name" in row).toBe(true);
    expect("centre_name" in row).toBe(true);
    expect("next_cursor" in res.body.data).toBe(true);
  });

  it("filters by q= against student_code or full_name", async () => {
    const session = await loginAs("sanchalak");
    const list = await request(app)
      .get("/v1/admin/students?limit=5")
      .set(auth(session.token));
    expect(list.status).toBe(200);
    const sample = list.body.data.items[0] as { student_code: string; full_name: string };
    expect(sample).toBeTruthy();

    const byCode = await request(app)
      .get(`/v1/admin/students?q=${encodeURIComponent(sample.student_code)}`)
      .set(auth(session.token));
    expect(byCode.status).toBe(200);
    const codes = (byCode.body.data.items as Array<{ student_code: string }>).map((r) => r.student_code);
    expect(codes).toContain(sample.student_code);

    const token = sample.full_name.trim().split(/\s+/)[0]!;
    const byName = await request(app)
      .get(`/v1/admin/students?q=${encodeURIComponent(token)}`)
      .set(auth(session.token));
    expect(byName.status).toBe(200);
    expect(byName.body.data.items.length).toBeGreaterThan(0);
  });

  it("filters by status=inactive", async () => {
    const session = await loginAs("city_admin");
    const res = await request(app)
      .get("/v1/admin/students?status=inactive&limit=20")
      .set(auth(session.token));
    expect(res.status).toBe(200);
    for (const row of res.body.data.items as Array<{ status: string }>) {
      expect(row.status).toBe("inactive");
    }
  });

  it("rejects an unknown status", async () => {
    const session = await loginAs("sanchalak");
    const res = await request(app)
      .get("/v1/admin/students?status=graduated")
      .set(auth(session.token));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("ERR_VALIDATION_FAILED");
  });
});
