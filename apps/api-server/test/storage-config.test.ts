import { describe, it, expect, afterEach } from "vitest";
import { _resetStorageConfig, getStorageConfig } from "../src/lib/storage-config";

const STORAGE_KEYS = [
  "STORAGE_PROVIDER",
  "STORAGE_DRIVER",
  "STORAGE_BUCKET",
  "STORAGE_ACCESS_KEY_ID",
  "STORAGE_SECRET_ACCESS_KEY",
  "STORAGE_ENDPOINT",
  "STORAGE_REGION",
  "STORAGE_PUBLIC_BASE_URL",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_PUBLIC_BASE_URL",
  "S3_BUCKET",
  "S3_ENDPOINT",
  "AWS_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "UPLOADS_DIR",
  "UPLOAD_URL_TTL_SECONDS",
] as const;

function clearStorageEnv(): void {
  for (const key of STORAGE_KEYS) delete process.env[key];
  _resetStorageConfig();
}

afterEach(clearStorageEnv);

describe("storage-config", () => {
  it("defaults to local disk when no remote vars are set", () => {
    const cfg = getStorageConfig();
    expect(cfg.kind).toBe("local");
    if (cfg.kind === "local") {
      expect(cfg.uploadsDir).toMatch(/uploads$/);
    }
  });

  it("resolves R2 from R2_* vars and derived endpoint", () => {
    process.env.STORAGE_PROVIDER = "r2";
    process.env.R2_ACCOUNT_ID = "acct123";
    process.env.R2_ACCESS_KEY_ID = "key";
    process.env.R2_SECRET_ACCESS_KEY = "secret";
    process.env.R2_BUCKET = "my-bucket";
    _resetStorageConfig();

    const cfg = getStorageConfig();
    expect(cfg).toMatchObject({
      kind: "r2",
      bucket: "my-bucket",
      region: "auto",
      endpoint: "https://acct123.r2.cloudflarestorage.com",
      forcePathStyle: true,
      accessKeyId: "key",
      secretAccessKey: "secret",
    });
  });

  it("resolves AWS S3 from unified STORAGE_* vars", () => {
    process.env.STORAGE_PROVIDER = "s3";
    process.env.STORAGE_BUCKET = "prod-uploads";
    process.env.STORAGE_ACCESS_KEY_ID = "AKIA";
    process.env.STORAGE_SECRET_ACCESS_KEY = "shhh";
    process.env.STORAGE_REGION = "ap-south-1";
    _resetStorageConfig();

    const cfg = getStorageConfig();
    expect(cfg).toMatchObject({
      kind: "s3",
      bucket: "prod-uploads",
      region: "ap-south-1",
      endpoint: undefined,
      forcePathStyle: false,
      accessKeyId: "AKIA",
      secretAccessKey: "shhh",
    });
  });

  it("accepts MinIO as s3 with a custom endpoint", () => {
    process.env.STORAGE_PROVIDER = "minio";
    process.env.STORAGE_BUCKET = "dev";
    process.env.STORAGE_ACCESS_KEY_ID = "minio";
    process.env.STORAGE_SECRET_ACCESS_KEY = "minio123";
    process.env.STORAGE_ENDPOINT = "http://127.0.0.1:9000";
    _resetStorageConfig();

    const cfg = getStorageConfig();
    expect(cfg.kind).toBe("s3");
    if (cfg.kind !== "local") {
      expect(cfg.endpoint).toBe("http://127.0.0.1:9000");
      expect(cfg.forcePathStyle).toBe(true);
    }
  });

  it("throws when r2 is selected without credentials", () => {
    process.env.STORAGE_PROVIDER = "r2";
    process.env.R2_ACCOUNT_ID = "acct";
    process.env.R2_BUCKET = "b";
    _resetStorageConfig();

    expect(() => getStorageConfig()).toThrow(/credentials/i);
  });

  it("legacy: infers r2 when only R2_BUCKET is set", () => {
    process.env.R2_ACCOUNT_ID = "legacy-acct";
    process.env.R2_BUCKET = "legacy-bucket";
    process.env.R2_ACCESS_KEY_ID = "k";
    process.env.R2_SECRET_ACCESS_KEY = "s";
    _resetStorageConfig();

    const cfg = getStorageConfig();
    expect(cfg.kind).toBe("r2");
  });
});
