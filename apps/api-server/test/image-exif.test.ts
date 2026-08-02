/**
 * EXIF/GPS stripping on image upload + gallery must not publish video.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import exifr from "exifr";
import sharp from "sharp";
import app from "../src/app";
import { pool, db, gallery_items } from "@workspace/db";
import { eq } from "drizzle-orm";
import { loginAs, auth } from "./helpers";
import { signUploadUrl, uploadKeyFromUrl } from "../src/lib/file-tokens";
import { UPLOADS_DIR } from "../src/lib/storage";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures");

function todayIst(): string {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}
function daysAgoIst(n: number): string {
  const d = new Date(`${todayIst()}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

afterAll(async () => {
  await pool.end();
});

describe("image EXIF normalisation on upload", () => {
  let token: string;

  beforeAll(async () => {
    ({ token } = await loginAs("parent"));
  });

  it("strips GPS EXIF from JPEG and applies Orientation=6 (dims swapped)", async () => {
    const raw = fs.readFileSync(path.join(fixturesDir, "jpeg-with-gps-orientation6.jpg"));
    const beforeGps = await exifr.gps(raw);
    expect(beforeGps?.latitude).toBeTruthy();
    expect(beforeGps?.longitude).toBeTruthy();
    const beforeMeta = await sharp(raw).metadata();
    expect(beforeMeta.width).toBe(80);
    expect(beforeMeta.height).toBe(40);
    expect(beforeMeta.orientation).toBe(6);

    const res = await request(app)
      .post("/v1/uploads")
      .set(auth(token))
      .field("folder", "niyam-proof")
      .attach("file", raw, {
        filename: "proof.jpg",
        contentType: "image/jpeg",
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.content_type).toBe("image/jpeg");

    const key = uploadKeyFromUrl(res.body.data.url as string);
    expect(key).toBeTruthy();
    const storedPath = path.join(UPLOADS_DIR, key!);
    expect(fs.existsSync(storedPath)).toBe(true);
    const stored = fs.readFileSync(storedPath);

    const afterGps = await exifr.gps(stored);
    expect(afterGps).toBeUndefined();
    const afterFull = await exifr.parse(stored, true);
    expect(afterFull).toBeUndefined();
    // No APP1 EXIF segment (FF E1) after strip — JPEG may still have APP0 JFIF.
    const app1 = stored.indexOf(Buffer.from([0xff, 0xe1]));
    expect(app1).toBe(-1);

    const afterMeta = await sharp(stored).metadata();
    // Orientation 6 = 90° CW → stored pixels are 40×80 and Orientation tag gone.
    expect(afterMeta.width).toBe(40);
    expect(afterMeta.height).toBe(80);
    expect(afterMeta.orientation).toBeUndefined();

    const signed = new URL(signUploadUrl(res.body.data.url as string));
    const get = await request(app)
      .get(signed.pathname + signed.search)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(get.status).toBe(200);
    expect(await exifr.gps(get.body as Buffer)).toBeUndefined();
  });

  it("rejects a corrupt JPEG (valid magic, bad payload) with 422 and writes nothing", async () => {
    const corrupt = fs.readFileSync(path.join(fixturesDir, "jpeg-corrupt-magic-only.jpg"));
    const proofDir = path.join(UPLOADS_DIR, "niyam-proof");
    const beforeCount = fs.existsSync(proofDir)
      ? fs.readdirSync(proofDir).length
      : 0;

    const res = await request(app)
      .post("/v1/uploads")
      .set(auth(token))
      .field("folder", "niyam-proof")
      .attach("file", corrupt, {
        filename: "bad.jpg",
        contentType: "image/jpeg",
      });
    expect(res.status).toBe(422);
    expect(res.body.error?.code).toBe("ERR_VALIDATION_FAILED");

    const afterCount = fs.existsSync(proofDir) ? fs.readdirSync(proofDir).length : 0;
    expect(afterCount).toBe(beforeCount);
  });
});

describe("gallery never publishes video proofs", () => {
  let parentToken: string;
  let adminToken: string;
  let studentId: string;

  beforeAll(async () => {
    const parent = await loginAs("parent");
    parentToken = parent.token;
    adminToken = (await loginAs("super_admin")).token;
    const children = await request(app).get("/v1/me/children").set(auth(parentToken));
    studentId = children.body.data.items[0].id;
  });

  it("auto-approved submission with video media creates no gallery_items row", async () => {
    const niyam = await request(app)
      .post("/v1/admin/niyams")
      .set(auth(adminToken))
      .send({
        title_en: `Video gallery guard ${Date.now()}`,
        niyam_type: "daily",
        proof_type: "either",
        approval_mode: "auto",
        proof_required: true,
        max_uploads: 1,
        points: 3,
        start_date: daysAgoIst(30),
      });
    expect([200, 201]).toContain(niyam.status);
    const niyamId = niyam.body.data.id as string;

    const mov = fs.readFileSync(path.join(fixturesDir, "sample.mov"));
    const upload = await request(app)
      .post("/v1/uploads")
      .set(auth(parentToken))
      .field("folder", "niyam-proof")
      .attach("file", mov, { filename: "clip.mov", contentType: "video/quicktime" });
    expect(upload.status, JSON.stringify(upload.body)).toBe(200);

    // Even if the client mis-labels kind as photo, extension/MIME must block gallery.
    const submit = await request(app)
      .post("/v1/niyam-submissions")
      .set(auth(parentToken))
      .send({
        niyam_id: niyamId,
        student_id: studentId,
        submission_date: todayIst(),
        media: [
          {
            url: upload.body.data.url,
            kind: "photo",
            mime: "video/quicktime",
          },
        ],
      });
    expect(submit.status, JSON.stringify(submit.body)).toBe(200);
    expect(submit.body.data.status).toBe("auto_approved");
    const submissionId = submit.body.data.id as string;

    const rows = await db
      .select({ id: gallery_items.id })
      .from(gallery_items)
      .where(eq(gallery_items.submission_id, submissionId));
    expect(rows).toHaveLength(0);
  });
});
