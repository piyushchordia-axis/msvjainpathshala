import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth } from "./helpers";

afterAll(async () => {
  await pool.end();
});

describe("GET /v1/me/students/:id/punya ledger paging", () => {
  it("reports has_more when the ledger is truncated by limit", async () => {
    const parent = await loginAs("parent");
    const children = await request(app).get("/v1/me/children").set(auth(parent.token));
    expect(children.status).toBe(200);
    const child = children.body.data.items[0];
    expect(child).toBeTruthy();
    const studentId = child.id as string;

    const page = await request(app)
      .get(`/v1/me/students/${studentId}/punya?limit=1`)
      .set(auth(parent.token));
    expect(page.status).toBe(200);
    expect(page.body.data.transactions.length).toBeLessThanOrEqual(1);
    expect(typeof page.body.data.has_more).toBe("boolean");
    expect(typeof page.body.data.total_points).toBe("number");

    const wider = await request(app)
      .get(`/v1/me/students/${studentId}/punya?limit=50`)
      .set(auth(parent.token));
    expect(wider.status).toBe(200);
    if (wider.body.data.transactions.length > 1) {
      expect(page.body.data.has_more).toBe(true);
      expect(page.body.data.transactions).toHaveLength(1);
    }
  });
});
