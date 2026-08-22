/**
 * Copy every file under local UPLOADS_DIR into the configured remote bucket (R2/S3).
 * Keys match the relative path (e.g. niyam-proof/<uuid>.jpg) — same as LocalDisk.
 *
 * Idempotent: skips objects that already exist with the same byte size unless --force.
 *
 * Usage (PowerShell):
 *   # .env must have STORAGE_PROVIDER=r2 (or s3) + credentials
 *   pnpm --filter @workspace/api-server run migrate:uploads-to-r2
 *   pnpm --filter @workspace/api-server run migrate:uploads-to-r2 -- --dry-run
 *   pnpm --filter @workspace/api-server run migrate:uploads-to-r2 -- --force
 */
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RemoteStorageConfig } from "../src/lib/storage-config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONCURRENCY = 12;

async function loadDotEnv(): Promise<void> {
  const envPath = path.resolve(__dirname, "../.env");
  const { readFile } = await import("node:fs/promises");
  try {
    const text = await readFile(envPath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 0) continue;
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim();
      if (k && process.env[k] === undefined) process.env[k] = v;
    }
  } catch {
    /* optional */
  }
}

function contentTypeForKey(key: string, mimeByExt: Record<string, string>): string {
  const dot = key.lastIndexOf(".");
  const ext = dot >= 0 ? key.slice(dot + 1).toLowerCase() : "";
  return mimeByExt[ext] ?? "application/octet-stream";
}

type FileJob = { absPath: string; key: string; size: number };

async function collectFiles(dir: string, uploadsDir: string, out: FileJob[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      await collectFiles(abs, uploadsDir, out);
      continue;
    }
    const key = path.relative(uploadsDir, abs).split(path.sep).join("/");
    const info = await stat(abs);
    out.push({ absPath: abs, key, size: info.size });
  }
}

async function main(): Promise<void> {
  await loadDotEnv();

  const force = process.argv.includes("--force");
  const dryRun = process.argv.includes("--dry-run");

  const { getStorageConfig } = await import("../src/lib/storage-config");
  const { MIME_BY_EXT } = await import("../src/lib/upload");

  const cfg = getStorageConfig();
  if (cfg.kind === "local") {
    console.error(
      "[migrate-uploads] STORAGE_PROVIDER is local — set STORAGE_PROVIDER=r2 (or s3) in .env first.",
    );
    process.exit(1);
  }
  const remote = cfg as RemoteStorageConfig;

  const uploadsDir = process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.resolve(__dirname, "../uploads");

  const jobs: FileJob[] = [];
  await collectFiles(uploadsDir, uploadsDir, jobs);
  jobs.sort((a, b) => a.key.localeCompare(b.key));

  console.log(
    `[migrate-uploads] source=${uploadsDir} bucket=${remote.bucket} provider=${remote.kind} files=${jobs.length} force=${force} dryRun=${dryRun}`,
  );

  if (dryRun) {
    const totalBytes = jobs.reduce((n, j) => n + j.size, 0);
    console.log(
      `[migrate-uploads] dry-run: would upload ${jobs.length} files (${(totalBytes / 1024 / 1024).toFixed(1)} MB)`,
    );
    return;
  }

  const { S3Client, PutObjectCommand, HeadObjectCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region: remote.region,
    endpoint: remote.endpoint,
    forcePathStyle: remote.forcePathStyle,
    credentials: {
      accessKeyId: remote.accessKeyId,
      secretAccessKey: remote.secretAccessKey,
    },
  });

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  let done = 0;
  const started = Date.now();

  async function uploadOne(job: FileJob): Promise<void> {
    const contentType = contentTypeForKey(job.key, MIME_BY_EXT);

    if (!force) {
      try {
        const head = await client.send(
          new HeadObjectCommand({ Bucket: remote.bucket, Key: job.key }),
        );
        if (head.ContentLength === job.size) {
          skipped++;
          return;
        }
        console.warn(`[migrate-uploads] size mismatch for ${job.key} — re-uploading`);
      } catch (err: unknown) {
        const code = (err as { name?: string })?.name;
        const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
          ?.httpStatusCode;
        if (code !== "NotFound" && status !== 404) throw err;
      }
    }

    await client.send(
      new PutObjectCommand({
        Bucket: remote.bucket,
        Key: job.key,
        Body: createReadStream(job.absPath),
        ContentType: contentType,
        ContentLength: job.size,
      }),
    );
    uploaded++;
  }

  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < jobs.length) {
      const i = nextIndex++;
      const job = jobs[i]!;
      try {
        await uploadOne(job);
      } catch (err) {
        failed++;
        console.error(`[migrate-uploads] failed ${job.key}:`, err);
      }
      done++;
      if (done % 250 === 0 || done === jobs.length) {
        const elapsed = ((Date.now() - started) / 1000).toFixed(0);
        console.log(
          `[migrate-uploads] progress ${done}/${jobs.length} (${elapsed}s) uploaded=${uploaded} skipped=${skipped} failed=${failed}`,
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const elapsedSec = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `[migrate-uploads] done in ${elapsedSec}s — scanned=${jobs.length} uploaded=${uploaded} skipped=${skipped} failed=${failed}`,
  );
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[migrate-uploads] fatal:", err);
  process.exit(1);
});
