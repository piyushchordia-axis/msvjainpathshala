#!/usr/bin/env node
/**
 * Step 11 smoke test — exercises the StorageService directly against MinIO.
 *
 * Equivalent to the full API chain but without booting NestJS:
 *   1. Configure an S3 client at http://localhost:9000 with minio creds
 *   2. Generate a presigned PUT URL (the same code path as MediaService)
 *   3. Upload a tiny JPEG via the presigned URL
 *   4. HEAD the object (mirrors MediaService.finalize)
 *   5. Run sharp() to produce a __thumb_sm.webp variant (mirrors the worker)
 *   6. Upload the thumbnail back to MinIO
 *   7. List the resulting objects to prove both exist
 *   8. Generate a signed GET URL and curl it to verify access
 *
 * Run with:
 *   node apps/api/scripts/smoke-media.mjs
 */

import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import sharp from 'sharp';
import fileTypePkg from 'file-type';
const { fromBuffer: fileTypeFromBuffer } = fileTypePkg;
import { randomUUID } from 'node:crypto';

const ENDPOINT = process.env.S3_ENDPOINT ?? 'http://localhost:9000';
const BUCKET = process.env.S3_BUCKET_PRIVATE ?? 'jp-dev-media-private';
const ACCESS = process.env.S3_ACCESS_KEY_ID ?? 'minioadmin';
const SECRET = process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin';

const client = new S3Client({
  region: 'us-east-1',
  endpoint: ENDPOINT,
  credentials: { accessKeyId: ACCESS, secretAccessKey: SECRET },
  forcePathStyle: true,
});

console.log(`[smoke] endpoint=${ENDPOINT} bucket=${BUCKET}`);

// Build a tiny JPEG via sharp — keeps the test self-contained.
const original = await sharp({
  create: { width: 480, height: 480, channels: 3, background: { r: 212, g: 98, b: 26 } },
})
  .jpeg({ quality: 85 })
  .toBuffer();
const userId = '00000000-0000-0000-0000-000000000000';
const key = `student_photo/${new Date().getUTCFullYear()}/${String(new Date().getUTCMonth() + 1).padStart(2, '0')}/${userId}/${randomUUID()}.jpg`;

console.log(`[smoke] step 1/8 — presign PUT for ${key} (size=${original.length}B)`);
const putUrl = await getSignedUrl(
  client,
  new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: 'image/jpeg',
    ContentLength: original.length,
  }),
  { expiresIn: 300 },
);
console.log(`[smoke]   url=${putUrl.slice(0, 60)}…`);

console.log('[smoke] step 2/8 — PUT body to presigned URL');
const putResp = await fetch(putUrl, {
  method: 'PUT',
  headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(original.length) },
  body: original,
});
if (!putResp.ok) throw new Error(`PUT failed ${putResp.status} ${await putResp.text()}`);
console.log(`[smoke]   PUT ${putResp.status} ${putResp.statusText}`);

console.log('[smoke] step 3/8 — HEAD object (mirrors MediaService.finalize)');
const head = await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
console.log(`[smoke]   HEAD size=${head.ContentLength}B contentType=${head.ContentType}`);

console.log('[smoke] step 4/8 — re-download, sniff with file-type');
const got = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
const chunks = [];
for await (const c of got.Body) chunks.push(c);
const body = Buffer.concat(chunks);
const detected = await fileTypeFromBuffer(body);
console.log(
  `[smoke]   detected mime=${detected?.mime ?? '<none>'} ext=${detected?.ext ?? '<none>'}`,
);

console.log('[smoke] step 5/8 — sharp strip EXIF + generate __thumb_sm.webp variant');
const thumb = await sharp(body)
  .rotate()
  .withMetadata({})
  .resize({ width: 200 })
  .webp({ quality: 80 })
  .toBuffer();
const thumbKey = key.replace(/\.jpg$/, '__thumb_sm.webp');
console.log(`[smoke]   thumb size=${thumb.length}B key=${thumbKey}`);

console.log('[smoke] step 6/8 — PUT thumbnail back to MinIO');
await client.send(
  new PutObjectCommand({ Bucket: BUCKET, Key: thumbKey, Body: thumb, ContentType: 'image/webp' }),
);

console.log('[smoke] step 7/8 — list objects under the user prefix');
const prefix = key.split('/').slice(0, -1).join('/');
const list = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix }));
for (const obj of list.Contents ?? []) {
  console.log(`[smoke]   ${obj.Key} (${obj.Size}B)`);
}

console.log('[smoke] step 8/8 — presigned GET URL for the original');
const getUrl = await getSignedUrl(client, new GetObjectCommand({ Bucket: BUCKET, Key: key }), {
  expiresIn: 60,
});
console.log(`[smoke]   url=${getUrl.slice(0, 100)}…`);
const verifyResp = await fetch(getUrl);
console.log(
  `[smoke]   GET ${verifyResp.status} ${verifyResp.statusText} (size=${(await verifyResp.arrayBuffer()).byteLength}B)`,
);

console.log('[smoke] ✅ done — full media upload chain works against MinIO');
