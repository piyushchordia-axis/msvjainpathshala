import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth } from "./helpers";
import { signUploadUrl } from "../src/lib/file-tokens";

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

  it("uploads a real image, then serves it only with a valid signature", async () => {
    const { token } = await loginAs("shikshak");
    // 1x1 PNG — content sniffing requires real image bytes (magic number).
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQAY3Y2wAAAAAElFTkSuQmCC",
      "base64",
    );
    const res = await request(app)
      .post("/v1/uploads")
      .set(auth(token))
      .field("folder", "misc")
      .attach("file", png, { filename: "x.png", contentType: "image/png" });
    expect(res.status).toBe(200);
    expect(res.body.data.url).toContain("/uploads/");
    expect(res.body.data.size).toBeGreaterThan(0);

    // /uploads is no longer public: unsigned GET is 403, a signed URL serves 200.
    const path = new URL(res.body.data.url).pathname;
    expect((await request(app).get(path)).status).toBe(403);
    const signed = new URL(signUploadUrl(res.body.data.url));
    expect((await request(app).get(signed.pathname + signed.search)).status).toBe(200);
  });

  it("rejects content that does not match the declared type", async () => {
    const { token } = await loginAs("shikshak");
    const res = await request(app)
      .post("/v1/uploads")
      .set(auth(token))
      .field("folder", "misc")
      .attach("file", Buffer.from("<svg onload=alert(1)>"), { filename: "x.png", contentType: "image/png" });
    expect(res.status).toBe(422);
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
