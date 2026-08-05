/**
 * PUT /v1/me/photo — user profile avatar (not student ID-card headshot).
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import app from "../src/app";
import { pool, db, users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { loginAs, auth } from "./helpers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures");

afterAll(async () => {
  await pool.end();
});

describe("PUT /v1/me/photo", () => {
  let token: string;
  let userId: string;

  beforeAll(async () => {
    const session = await loginAs("parent");
    token = session.token;
    userId = session.user.id;
  });

  it("login session includes photo_url field (nullable)", async () => {
    const session = await loginAs("shikshak");
    expect(session.user).toHaveProperty("photo_url");
    // Seeded users start with no avatar.
    expect(session.user.photo_url == null || typeof session.user.photo_url === "string").toBe(true);
  });

  it("rejects URLs outside user-photos/", async () => {
    const res = await request(app)
      .put("/v1/me/photo")
      .set(auth(token))
      .send({ photo_url: "http://localhost/uploads/student-photos/not-allowed.jpg" });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("ERR_VALIDATION_FAILED");
  });

  it("sets and clears a user-photos upload", async () => {
    const buf = fs.readFileSync(path.join(fixturesDir, "sample.jpg"));
    const up = await request(app)
      .post("/v1/uploads")
      .set(auth(token))
      .field("folder", "user-photos")
      .attach("file", buf, { filename: "avatar.jpg", contentType: "image/jpeg" });
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    expect(up.body.data.key).toMatch(/^user-photos\//);

    const set = await request(app)
      .put("/v1/me/photo")
      .set(auth(token))
      .send({ photo_url: up.body.data.url });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body.data.user.id).toBe(userId);
    expect(typeof set.body.data.user.photo_url).toBe("string");
    expect(set.body.data.user.photo_url).toContain("/uploads/");

    const [row] = await db
      .select({ photo_url: users.photo_url })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    expect(row?.photo_url).toBe(up.body.data.url);

    const clear = await request(app)
      .put("/v1/me/photo")
      .set(auth(token))
      .send({ photo_url: null });
    expect(clear.status).toBe(200);
    expect(clear.body.data.user.photo_url).toBeNull();

    const [after] = await db
      .select({ photo_url: users.photo_url })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    expect(after?.photo_url).toBeNull();
  });
});
