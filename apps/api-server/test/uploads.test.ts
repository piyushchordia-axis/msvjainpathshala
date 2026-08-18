/**
 * Upload MIME ↔ extension single-source + round-trip Content-Type regression tests.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import app from "../src/app";
import { pool, db, upload_objects } from "@workspace/db";
import { eq } from "drizzle-orm";
import { loginAs, auth } from "./helpers";
import { signUploadUrl } from "../src/lib/file-tokens";
import {
  ALLOWED_MIME_TYPES,
  EXT_BY_MIME,
  MIME_BY_EXT,
  MAX_UPLOAD_BYTES,
  UPLOAD_TEMP_PREFIX,
} from "../src/lib/upload";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures");

function listUploadTemps(): string[] {
  return fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(UPLOAD_TEMP_PREFIX));
}

afterAll(async () => {
  await pool.end();
});

describe("upload MIME table integrity", () => {
  it("every ALLOWED_MIME_TYPES entry round-trips through EXT_BY_MIME ↔ MIME_BY_EXT", () => {
    expect(ALLOWED_MIME_TYPES.size).toBeGreaterThan(0);
    for (const mime of ALLOWED_MIME_TYPES) {
      const ext = EXT_BY_MIME[mime];
      expect(ext, `EXT_BY_MIME missing for ${mime}`).toBeTruthy();
      expect(MIME_BY_EXT[ext!], `MIME_BY_EXT missing for ext ${ext}`).toBe(mime);
    }
  });
});

/** Formats that must never be served as application/octet-stream. */
const ROUND_TRIP: Array<{
  file: string;
  declareAs: string;
  expectMime: string;
  expectExt: string;
}> = [
  { file: "sample.jpg", declareAs: "image/jpeg", expectMime: "image/jpeg", expectExt: "jpg" },
  { file: "sample.png", declareAs: "image/png", expectMime: "image/png", expectExt: "png" },
  { file: "sample.gif", declareAs: "image/gif", expectMime: "image/gif", expectExt: "gif" },
  { file: "sample.webp", declareAs: "image/webp", expectMime: "image/webp", expectExt: "webp" },
  { file: "sample.pdf", declareAs: "application/pdf", expectMime: "application/pdf", expectExt: "pdf" },
  { file: "sample.mp4", declareAs: "video/mp4", expectMime: "video/mp4", expectExt: "mp4" },
  { file: "sample.mov", declareAs: "video/quicktime", expectMime: "video/quicktime", expectExt: "mov" },
  { file: "sample.webm", declareAs: "video/webm", expectMime: "video/webm", expectExt: "webm" },
  { file: "sample.mp3", declareAs: "audio/mpeg", expectMime: "audio/mpeg", expectExt: "mp3" },
  { file: "sample.m4a", declareAs: "audio/mp4", expectMime: "audio/mp4", expectExt: "m4a" },
  { file: "sample.wav", declareAs: "audio/wav", expectMime: "audio/wav", expectExt: "wav" },
  { file: "sample.weba", declareAs: "audio/webm", expectMime: "audio/webm", expectExt: "weba" },
  { file: "sample.ogg", declareAs: "audio/ogg", expectMime: "audio/ogg", expectExt: "ogg" },
];

describe("upload Content-Type round-trip", () => {
  let token: string;

  beforeAll(async () => {
    ({ token } = await loginAs("parent"));
  });

  it.each(ROUND_TRIP)(
    "$declareAs → stored .$expectExt served as $expectMime",
    async ({ file, declareAs, expectMime, expectExt }) => {
      const buf = fs.readFileSync(path.join(fixturesDir, file));
      const res = await request(app)
        .post("/v1/uploads")
        .set(auth(token))
        .field("folder", "niyam-proof")
        .attach("file", buf, { filename: file, contentType: declareAs });

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.content_type).toBe(expectMime);
      expect(res.body.data.key).toMatch(new RegExp(`\\.${expectExt}$`));
      expect(res.body.data.url).toContain(`/uploads/`);

      const signed = new URL(signUploadUrl(res.body.data.url as string));
      const get = await request(app).get(signed.pathname + signed.search);
      expect(get.status).toBe(200);
      expect(get.headers["content-type"]).toBe(expectMime);
      expect(get.headers["content-type"]).not.toBe("application/octet-stream");

      const [row] = await db
        .select({ content_type: upload_objects.content_type })
        .from(upload_objects)
        .where(eq(upload_objects.key, res.body.data.key as string))
        .limit(1);
      expect(row?.content_type).toBe(expectMime);
    },
  );

  it("stores Android MediaRecorder mpeg4 (ftyp mp42) as audio/mp4 when declared audio", async () => {
    // file-type reports video/mp4 for mp42/isom — same collision as audio/webm.
    const size = 8 + 8 + 8; // ftyp + brand + minor + one compatible
    const buf = Buffer.alloc(size);
    buf.writeUInt32BE(size, 0);
    buf.write("ftyp", 4);
    buf.write("mp42", 8);
    buf.writeUInt32BE(0, 12);
    buf.write("mp42", 16);

    const res = await request(app)
      .post("/v1/uploads")
      .set(auth(token))
      .field("folder", "niyam-proof")
      .attach("file", buf, { filename: "recording.m4a", contentType: "audio/mp4" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.content_type).toBe("audio/mp4");
    expect(res.body.data.key).toMatch(/\.m4a$/);
  });

  it.each([
    { file: "sample.heic", declareAs: "image/heic" },
    { file: "sample.heif", declareAs: "image/heif" },
  ])(
    "$declareAs either converts to JPEG or rejects 422 (never stores raw HEIC)",
    async ({ file, declareAs }) => {
      const buf = fs.readFileSync(path.join(fixturesDir, file));
      const res = await request(app)
        .post("/v1/uploads")
        .set(auth(token))
        .field("folder", "niyam-proof")
        .attach("file", buf, { filename: file, contentType: declareAs });

      if (res.status === 200) {
        expect(res.body.data.content_type).toBe("image/jpeg");
        expect(res.body.data.key).toMatch(/\.jpg$/);
        const signed = new URL(signUploadUrl(res.body.data.url as string));
        const get = await request(app).get(signed.pathname + signed.search);
        expect(get.headers["content-type"]).toBe("image/jpeg");
      } else {
        // This build cannot decode HEVC-coded HEIC (sharp's prebuilt libvips
        // links libheif with AV1 only), so the refusal must name the format
        // and its own code. NOT ERR_VALIDATION_FAILED: screens override that
        // with "choose a clear image", which is wrong advice here.
        expect(res.status).toBe(422);
        expect(res.body.error?.code).toBe("ERR_UPLOAD_FORMAT_UNSUPPORTED");
        expect(res.body.error?.message).toMatch(/HEIC|HEIF|JPEG/i);
      }
    },
  );

  it("rejects when magic bytes do not match an allowed type (zip labeled as png)", async () => {
    // PK\x03\x04 — ZIP local file header; file-type → application/zip (not allowlisted).
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
    const res = await request(app)
      .post("/v1/uploads")
      .set(auth(token))
      .field("folder", "niyam-proof")
      .attach("file", zip, { filename: "x.png", contentType: "image/png" });
    expect(res.status).toBe(422);
    expect(res.body.error?.code).toBe("ERR_VALIDATION_FAILED");
  });

  it("rejects files over MAX_UPLOAD_BYTES with 413 ERR_FILE_TOO_LARGE (not 500)", async () => {
    const oversized = Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0x00);
    const res = await request(app)
      .post("/v1/uploads")
      .set(auth(token))
      .field("folder", "niyam-proof")
      .attach("file", oversized, { filename: "big.mp4", contentType: "video/mp4" });

    expect(res.status).toBe(413);
    expect(res.body.error?.code).toBe("ERR_FILE_TOO_LARGE");
    expect(res.body.error?.message).toMatch(/50 MB/);
    expect(res.status).not.toBe(500);
  });

  it("unlinks disk temp after a successful upload", async () => {
    const before = new Set(listUploadTemps());
    const buf = fs.readFileSync(path.join(fixturesDir, "sample.jpg"));
    const res = await request(app)
      .post("/v1/uploads")
      .set(auth(token))
      .field("folder", "niyam-proof")
      .attach("file", buf, { filename: "sample.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(200);

    const leftover = listUploadTemps().filter((name) => !before.has(name));
    expect(leftover).toEqual([]);
  });

  it("unlinks disk temp after an oversized upload rejection", async () => {
    const before = new Set(listUploadTemps());
    const oversized = Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0x00);
    const res = await request(app)
      .post("/v1/uploads")
      .set(auth(token))
      .field("folder", "niyam-proof")
      .attach("file", oversized, { filename: "big.mp4", contentType: "video/mp4" });
    expect(res.status).toBe(413);

    const leftover = listUploadTemps().filter((name) => !before.has(name));
    expect(leftover).toEqual([]);
  });
});

describe("upload folder validation", () => {
  let token: string;

  beforeAll(async () => {
    ({ token } = await loginAs("parent"));
  });

  it("accepts folder=homework and stores under homework/", async () => {
    const buf = fs.readFileSync(path.join(fixturesDir, "sample.jpg"));
    const res = await request(app)
      .post("/v1/uploads")
      .set(auth(token))
      .field("folder", "homework")
      .attach("file", buf, { filename: "worksheet.jpg", contentType: "image/jpeg" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.key).toMatch(/^homework\//);
  });

  it("rejects unknown folder homework-proof with 422 (no silent misc fallback)", async () => {
    const buf = fs.readFileSync(path.join(fixturesDir, "sample.jpg"));
    const res = await request(app)
      .post("/v1/uploads")
      .set(auth(token))
      .field("folder", "homework-proof")
      .attach("file", buf, { filename: "proof.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(422);
    expect(res.body.error?.code).toBe("ERR_VALIDATION_FAILED");
    expect(res.body.error?.message).toMatch(/homework-proof/);
  });

  it("defaults missing folder to misc/", async () => {
    const buf = fs.readFileSync(path.join(fixturesDir, "sample.jpg"));
    const res = await request(app)
      .post("/v1/uploads")
      .set(auth(token))
      .attach("file", buf, { filename: "loose.jpg", contentType: "image/jpeg" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.key).toMatch(/^misc\//);
  });
});
