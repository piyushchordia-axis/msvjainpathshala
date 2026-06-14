import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth } from "./helpers";

afterAll(async () => {
  await pool.end(); // close the shared pg pool so vitest exits cleanly
});

describe("foundation", () => {
  it("GET /api/healthz returns 200 ok", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("rejects /v1/uploads without auth", async () => {
    const res = await request(app).post("/v1/uploads");
    expect(res.status).toBe(401);
  });

  it("uploads a file and serves it back", async () => {
    const { token } = await loginAs("shikshak");
    const res = await request(app)
      .post("/v1/uploads")
      .set(auth(token))
      .field("folder", "misc")
      .attach("file", Buffer.from("hello-world"), { filename: "note.txt", contentType: "image/png" });
    expect(res.status).toBe(200);
    expect(res.body.data.url).toContain("/uploads/");
    expect(res.body.data.size).toBeGreaterThan(0);
  });

  it("rejects a disallowed mime type", async () => {
    const { token } = await loginAs("shikshak");
    const res = await request(app)
      .post("/v1/uploads")
      .set(auth(token))
      .attach("file", Buffer.from("MZ"), { filename: "x.exe", contentType: "application/x-msdownload" });
    expect(res.status).toBe(422);
  });
});
