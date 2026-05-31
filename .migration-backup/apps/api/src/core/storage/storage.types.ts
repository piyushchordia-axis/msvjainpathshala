/**
 * StorageService — shared types + interface (SPEC §2.6, §10).
 *
 * The same surface is implemented by:
 *   - `MinioAdapter`  (dev — local `infra/docker` MinIO container)
 *   - `S3Adapter`     (prod — AWS S3 or Cloudflare R2; same API)
 *   - `NoopAdapter`   (no STORAGE_DRIVER configured; throws on any I/O)
 *
 * The driver is selected at boot from `AppConfigService.storage.driver`.
 *
 * Buckets (per SPEC §10.4):
 *   - private  — user-uploaded media; CloudFront signed access only
 *   - public   — library content; CloudFront public access
 *   - exports  — ephemeral PDFs / ZIPs (lifecycle ≤ 30 days)
 *   - receipts — donation receipts + 80G certs (lifecycle ≥ 7 years)
 */

export type StorageBucketKind = 'private' | 'public' | 'exports' | 'receipts';

export interface PresignedPutResult {
  /** Pre-signed PUT URL the client uploads to. */
  url: string;
  /** Headers the client MUST send with the PUT for the signature to verify. */
  headers: Record<string, string>;
  /** Seconds until `url` stops working. */
  expires_in_seconds: number;
}

export interface ObjectHead {
  size_bytes: number;
  content_type: string;
  /** ETag without surrounding quotes. */
  etag?: string;
  last_modified?: Date;
}

export interface PutObjectInput {
  body: Buffer | Uint8Array;
  contentType: string;
  /** Defaults to 'inline'. Use 'attachment; filename=...' for downloads. */
  contentDisposition?: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
}

export interface GetObjectStreamResult {
  body: Buffer;
  contentType: string;
  size_bytes: number;
}

export interface StorageAdapter {
  /** Driver tag — exposed for logging / `/readyz`. */
  readonly driver: 'minio' | 'r2' | 's3' | 'noop';

  /** Resolve a bucket kind to its concrete name (eg. `jp-dev-media-private`). */
  bucketName(kind: StorageBucketKind): string;

  /** Generate a presigned PUT URL (TTL ≤ 300s per SPEC §10.1). */
  presignPut(
    kind: StorageBucketKind,
    key: string,
    contentType: string,
    sizeBytes: number,
    ttlSeconds: number,
  ): Promise<PresignedPutResult>;

  /** Generate a presigned GET URL (TTL up to SIGNED_URL_TTL_SECONDS). */
  presignGet(kind: StorageBucketKind, key: string, ttlSeconds: number): Promise<string>;

  /** Public CDN URL for a public-bucket object (no signing required). */
  publicUrl(kind: StorageBucketKind, key: string): string;

  /** HEAD an object — returns null if missing. */
  head(kind: StorageBucketKind, key: string): Promise<ObjectHead | null>;

  /** Download object bytes (streamed to a Buffer). */
  getObject(kind: StorageBucketKind, key: string): Promise<GetObjectStreamResult>;

  /** Upload an object directly (used by processors uploading derived assets). */
  putObject(kind: StorageBucketKind, key: string, input: PutObjectInput): Promise<void>;

  /** Delete a single object. No-op if missing. */
  deleteObject(kind: StorageBucketKind, key: string): Promise<void>;
}
