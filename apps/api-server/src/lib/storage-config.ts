/**
 * Resolve file-storage backend from env. R2 and AWS S3 share one S3-compatible
 * client — switch providers by changing STORAGE_PROVIDER and credentials only.
 */
import path from "node:path";
import { logger } from "./logger";

export type StorageProviderKind = "local" | "r2" | "s3";

export interface LocalStorageConfig {
  kind: "local";
  uploadsDir: string;
}

export interface RemoteStorageConfig {
  kind: "r2" | "s3";
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl?: string;
  urlTtl: number;
}

export type ResolvedStorageConfig = LocalStorageConfig | RemoteStorageConfig;

let _config: ResolvedStorageConfig | undefined;
let _warnedLegacy = false;

function pickEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const raw = process.env[name];
    if (raw !== undefined && raw.trim() !== "") return raw.trim();
  }
  return undefined;
}

function parseUrlTtl(): number {
  const raw = pickEnv("UPLOAD_URL_TTL_SECONDS");
  if (!raw) return 3600;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 60 ? n : 3600;
}

function resolveR2Endpoint(): string | undefined {
  const explicit = pickEnv("STORAGE_ENDPOINT", "S3_ENDPOINT");
  if (explicit) return explicit;
  const accountId = pickEnv("R2_ACCOUNT_ID");
  if (accountId) return `https://${accountId}.r2.cloudflarestorage.com`;
  return undefined;
}

function parseProviderKind(): StorageProviderKind {
  const raw = pickEnv("STORAGE_PROVIDER", "STORAGE_DRIVER")?.toLowerCase();
  if (raw === "local" || raw === "disk") return "local";
  if (raw === "r2" || raw === "cloudflare") return "r2";
  if (raw === "s3" || raw === "aws" || raw === "minio") return "s3";

  // Legacy: remote bucket vars without an explicit provider.
  if (pickEnv("R2_ACCOUNT_ID", "R2_BUCKET")) return "r2";
  if (pickEnv("S3_BUCKET", "STORAGE_BUCKET", "STORAGE_BUCKET_PRIVATE")) return "s3";
  return "local";
}

function resolveRemote(kind: "r2" | "s3"): RemoteStorageConfig {
  const bucket =
    kind === "r2"
      ? pickEnv("STORAGE_BUCKET", "R2_BUCKET", "S3_BUCKET", "STORAGE_BUCKET_PRIVATE")
      : pickEnv("STORAGE_BUCKET", "S3_BUCKET", "STORAGE_BUCKET_PRIVATE", "R2_BUCKET");

  const accessKeyId =
    kind === "r2"
      ? pickEnv("STORAGE_ACCESS_KEY_ID", "R2_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID")
      : pickEnv("STORAGE_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID", "R2_ACCESS_KEY_ID");

  const secretAccessKey =
    kind === "r2"
      ? pickEnv("STORAGE_SECRET_ACCESS_KEY", "R2_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY")
      : pickEnv("STORAGE_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY", "R2_SECRET_ACCESS_KEY");

  const endpoint =
    kind === "r2" ? resolveR2Endpoint() : pickEnv("STORAGE_ENDPOINT", "S3_ENDPOINT");

  const region =
    pickEnv("STORAGE_REGION", "AWS_REGION") ?? (kind === "r2" ? "auto" : "us-east-1");

  const publicBaseUrl = pickEnv("STORAGE_PUBLIC_BASE_URL", "R2_PUBLIC_BASE_URL");

  if (!bucket) {
    throw new Error(
      `STORAGE_PROVIDER=${kind} requires a bucket — set STORAGE_BUCKET` +
        (kind === "r2" ? " or R2_BUCKET." : " or S3_BUCKET."),
    );
  }
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      `STORAGE_PROVIDER=${kind} requires access credentials — set STORAGE_ACCESS_KEY_ID and ` +
        `STORAGE_SECRET_ACCESS_KEY` +
        (kind === "r2" ? " (or R2_* / AWS_* aliases)." : " (or AWS_* aliases)."),
    );
  }
  if (kind === "r2" && !endpoint) {
    throw new Error(
      "STORAGE_PROVIDER=r2 requires R2_ACCOUNT_ID or STORAGE_ENDPOINT / S3_ENDPOINT.",
    );
  }

  const driver = pickEnv("STORAGE_PROVIDER", "STORAGE_DRIVER")?.toLowerCase();
  if (
    kind === "s3" &&
    driver === "minio" &&
    !endpoint
  ) {
    throw new Error("STORAGE_PROVIDER=minio requires STORAGE_ENDPOINT or S3_ENDPOINT.");
  }

  if (
    !_warnedLegacy &&
    kind === "r2" &&
    pickEnv("STORAGE_PROVIDER", "STORAGE_DRIVER")?.toLowerCase() === "s3"
  ) {
    _warnedLegacy = true;
    logger.warn(
      "[storage] STORAGE_PROVIDER=s3 with R2 endpoint/credentials — prefer STORAGE_PROVIDER=r2 for clarity.",
    );
  }

  return {
    kind,
    bucket,
    region,
    endpoint,
    forcePathStyle: !!endpoint,
    accessKeyId,
    secretAccessKey,
    publicBaseUrl,
    urlTtl: parseUrlTtl(),
  };
}

function resolveLocal(): LocalStorageConfig {
  const uploadsDir = process.env["UPLOADS_DIR"]
    ? path.resolve(process.env["UPLOADS_DIR"])
    : path.resolve(process.cwd(), "uploads");
  return { kind: "local", uploadsDir };
}

function load(): ResolvedStorageConfig {
  if (_config) return _config;

  const kind = parseProviderKind();
  if (kind === "local") {
    _config = resolveLocal();
    return _config;
  }
  _config = resolveRemote(kind);
  return _config;
}

/** Resolved storage config (cached). Throws on invalid remote env. */
export function getStorageConfig(): ResolvedStorageConfig {
  return load();
}

/** Log chosen backend once at startup (no secrets). */
export function warmStorageConfig(): void {
  const cfg = getStorageConfig();
  if (cfg.kind === "local") {
    logger.info({ uploadsDir: cfg.uploadsDir }, "[storage] using local disk");
    return;
  }
  logger.info(
    {
      provider: cfg.kind,
      bucket: cfg.bucket,
      region: cfg.region,
      endpoint: cfg.endpoint ? "<set>" : undefined,
      publicBaseUrl: cfg.publicBaseUrl ? "<set>" : undefined,
    },
    `[storage] using ${cfg.kind} (S3-compatible)`,
  );
}

/** Test hook — reset cached config after env changes. */
export function _resetStorageConfig(): void {
  _config = undefined;
  _warnedLegacy = false;
}
