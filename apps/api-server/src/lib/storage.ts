/**
 * Pluggable file storage. LocalDiskProvider (dev default) or S3StorageProvider
 * in production — both implement the same StorageProvider interface, so no
 * call-site changes are needed to switch.
 *
 * LocalDisk: files are written under UPLOADS_DIR (default <cwd>/uploads) and
 * served by Express static at `${PUBLIC_API_URL}/uploads/<key>`. S3: objects
 * live in S3_BUCKET; url() returns the same gated `/uploads/<key>` URL and
 * presignedUrl() returns a direct, time-limited S3 link when needed.
 */
import { createReadStream, type ReadStream } from "node:fs";
import { Readable, PassThrough } from "node:stream";
import { mkdir, writeFile, copyFile, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface StoredObject {
  key: string;
  url: string;
  content_type: string;
  size: number;
}

export interface StorageProvider {
  /**
   * Persist bytes (Buffer) or stream from a filesystem path, and return key + URL.
   * Path form is preferred for large uploads so the heap never holds the whole file.
   */
  put(key: string, body: Buffer | string, contentType: string): Promise<StoredObject>;
  /** Absolute URL for a stored key. */
  url(key: string): string;
  /** Open a read stream for a stored key (used for streaming downloads). */
  getStream(key: string): ReadStream;
  /** Best-effort delete; never throws on a missing key. */
  remove(key: string): Promise<void>;
  /**
   * Direct, time-limited object URL (S3). When present, the /uploads gate
   * verifies HMAC then 302s here so Node never proxies media bytes (PERF #18).
   */
  presignedUrl?(key: string, expiresInSeconds?: number): Promise<string>;
}

/** Build a safe, collision-free storage key: <folder>/<yyyy>/<mm>/<uuid><ext>. */
export function makeKey(folder: string, originalName?: string): string {
  const ext = originalName ? path.extname(originalName).toLowerCase().replace(/[^.a-z0-9]/g, "") : "";
  const safeFolder = folder.replace(/[^a-z0-9/_-]/gi, "").replace(/^\/+|\/+$/g, "") || "misc";
  return `${safeFolder}/${randomUUID()}${ext}`;
}

const PUBLIC_API_URL = (process.env["PUBLIC_API_URL"] ?? `http://localhost:${process.env["PORT"] ?? "8080"}`).replace(/\/+$/, "");

class LocalDiskProvider implements StorageProvider {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  private resolve(key: string): string {
    // Prevent path traversal: resolved path must stay under baseDir.
    const target = path.resolve(this.baseDir, key);
    if (!target.startsWith(path.resolve(this.baseDir) + path.sep)) {
      throw new Error("Invalid storage key");
    }
    return target;
  }

  async put(key: string, body: Buffer | string, contentType: string): Promise<StoredObject> {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    if (typeof body === "string") {
      await copyFile(body, target);
    } else {
      await writeFile(target, body);
    }
    const info = await stat(target);
    return { key, url: this.url(key), content_type: contentType, size: info.size };
  }

  url(key: string): string {
    return `${PUBLIC_API_URL}/uploads/${key.split("/").map(encodeURIComponent).join("/")}`;
  }

  getStream(key: string): ReadStream {
    return createReadStream(this.resolve(key));
  }

  async remove(key: string): Promise<void> {
    try {
      await unlink(this.resolve(key));
    } catch {
      /* ignore missing */
    }
  }
}

// ---------------------------------------------------------------------------
// S3 provider
// ---------------------------------------------------------------------------
/**
 * Stores objects in an S3 bucket. The AWS SDK is imported lazily (dynamic
 * import inside getClient / per call) so dev/test — which use LocalDiskProvider
 * — never load it. url() is synchronous and returns the through-app
 * `/uploads/<key>` URL (same shape LocalDisk returns); getStream() streams the
 * object body straight out of S3. Keys come from the shared makeKey() and are
 * already traversal-safe. The SDK is typed structurally (cast through unknown,
 * like the Razorpay adapter in payments.ts) so the typecheck never hard-couples
 * to the AWS type surface.
 */
type S3Client = { send(command: unknown): Promise<{ Body?: unknown }> };
type S3Module = {
  S3Client: new (opts: { region: string; endpoint?: string; forcePathStyle?: boolean }) => S3Client;
  PutObjectCommand: new (opts: Record<string, unknown>) => unknown;
  GetObjectCommand: new (opts: Record<string, unknown>) => unknown;
  DeleteObjectCommand: new (opts: Record<string, unknown>) => unknown;
};
type PresignerModule = {
  getSignedUrl(client: S3Client, command: unknown, opts: { expiresIn: number }): Promise<string>;
};

class S3StorageProvider implements StorageProvider {
  private readonly bucket: string;
  private readonly region: string;
  private readonly endpoint: string | undefined;
  private readonly urlTtl: number;
  // Lazily-constructed S3 client (dynamic import keeps the SDK out of dev/test).
  private client: S3Client | undefined;
  private sdk: S3Module | undefined;

  constructor(opts: { bucket: string; region: string; endpoint?: string; urlTtl?: number }) {
    this.bucket = opts.bucket;
    this.region = opts.region;
    this.endpoint = opts.endpoint;
    this.urlTtl = opts.urlTtl ?? 3600;
  }

  private async getSdk(): Promise<S3Module> {
    if (!this.sdk) {
      this.sdk = (await import("@aws-sdk/client-s3")) as unknown as S3Module;
    }
    return this.sdk;
  }

  private async getClient(): Promise<S3Client> {
    if (!this.client) {
      const { S3Client } = await this.getSdk();
      this.client = new S3Client({
        region: this.region,
        ...(this.endpoint ? { endpoint: this.endpoint, forcePathStyle: true } : {}),
      });
    }
    return this.client;
  }

  async put(key: string, body: Buffer | string, contentType: string): Promise<StoredObject> {
    const client = await this.getClient();
    const { PutObjectCommand } = await this.getSdk();
    if (typeof body === "string") {
      const info = await stat(body);
      const stream = createReadStream(body);
      await client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: stream,
          ContentType: contentType,
          ContentLength: info.size,
        }),
      );
      return { key, url: this.url(key), content_type: contentType, size: info.size };
    }
    await client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
    return { key, url: this.url(key), content_type: contentType, size: body.length };
  }

  /**
   * Synchronous, like the interface requires: returns the through-app
   * `/uploads/<key>` URL (the same shape LocalDisk returns). The /uploads route
   * gates access and pipes getStream(), so S3 objects need no public bucket
   * policy. Use presignedUrl() when a direct, time-limited S3 link is wanted.
   */
  url(key: string): string {
    return `${PUBLIC_API_URL}/uploads/${key.split("/").map(encodeURIComponent).join("/")}`;
  }

  /** Presigned GET URL valid for expiresInSeconds (direct S3 access). */
  async presignedUrl(key: string, expiresInSeconds?: number): Promise<string> {
    const client = await this.getClient();
    const { GetObjectCommand } = await this.getSdk();
    const { getSignedUrl } = (await import("@aws-sdk/s3-request-presigner")) as unknown as PresignerModule;
    const ttl = Math.min(
      Math.max(expiresInSeconds ?? this.urlTtl, 60),
      this.urlTtl,
    );
    return getSignedUrl(client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: ttl,
    });
  }

  getStream(key: string): ReadStream {
    // S3 GetObject is async, but the interface is synchronous: return a Readable
    // immediately and pipe the S3 body once the request resolves. PassThrough
    // honours backpressure so a slow client does not buffer the whole object
    // in heap (PERF #18).
    const passthrough = new PassThrough({ highWaterMark: 64 * 1024 });
    void (async () => {
      try {
        const client = await this.getClient();
        const { GetObjectCommand } = await this.getSdk();
        const out = await client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
        const body = out.Body as Readable | undefined;
        if (!body) {
          passthrough.destroy(new Error("Empty S3 body"));
          return;
        }
        body.pipe(passthrough);
      } catch (err) {
        passthrough.destroy(err instanceof Error ? err : new Error(String(err)));
      }
    })();
    return passthrough as unknown as ReadStream;
  }

  async remove(key: string): Promise<void> {
    try {
      const client = await this.getClient();
      const { DeleteObjectCommand } = await this.getSdk();
      await client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch {
      /* best-effort; ignore */
    }
  }
}

/** Absolute path to the on-disk uploads directory (also served by Express static). */
export const UPLOADS_DIR = process.env["UPLOADS_DIR"]
  ? path.resolve(process.env["UPLOADS_DIR"])
  : path.resolve(process.cwd(), "uploads");

// ---------------------------------------------------------------------------
// Factory (singleton)
// ---------------------------------------------------------------------------
/**
 * S3 in production (STORAGE_PROVIDER=s3 or an S3_BUCKET present), LocalDisk in
 * dev — mirrors the payments/sms provider-selection pattern.
 */
function build(): StorageProvider {
  const bucket = process.env["S3_BUCKET"];
  const useS3 = process.env["STORAGE_PROVIDER"] === "s3" || !!bucket;
  if (useS3) {
    if (!bucket) {
      throw new Error("STORAGE_PROVIDER=s3 requires S3_BUCKET to be set.");
    }
    return new S3StorageProvider({
      bucket,
      region: process.env["AWS_REGION"] ?? "us-east-1",
      ...(process.env["S3_ENDPOINT"] ? { endpoint: process.env["S3_ENDPOINT"] } : {}),
    });
  }
  return new LocalDiskProvider(UPLOADS_DIR);
}

/** Singleton storage provider for the whole server. */
export const storage: StorageProvider = build();
