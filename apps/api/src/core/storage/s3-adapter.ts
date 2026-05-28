/**
 * S3-compatible adapter — the workhorse implementation.
 *
 * Backs three of the four STORAGE_DRIVER values:
 *   - `minio` — local MinIO container (path-style addressing, plain HTTP)
 *   - `r2`    — Cloudflare R2 (virtual-host style, HTTPS)
 *   - `s3`    — AWS S3 (virtual-host style, HTTPS)
 *
 * The differences are surface-level (`forcePathStyle`, `region`, `endpoint`)
 * so one class handles all three. The factory in `storage.module.ts` picks
 * which driver tag to attach.
 *
 * SPEC §10.1 mandates 300s PUT-URL TTL, Content-Length enforcement, and
 * deterministic keys. SPEC §10.3 lets GET URLs live up to 3600s.
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { AppConfigService } from '../config/app-config.service';

import type {
  GetObjectStreamResult,
  ObjectHead,
  PresignedPutResult,
  PutObjectInput,
  StorageAdapter,
  StorageBucketKind,
} from './storage.types';

async function streamToBuffer(body: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export class S3Adapter implements StorageAdapter {
  readonly driver: 'minio' | 'r2' | 's3';
  private readonly client: S3Client;
  private readonly buckets: { private: string; public: string; exports: string; receipts: string };
  private readonly cdn: { private: string; public: string };
  private readonly endpoint: string;

  constructor(driver: 'minio' | 'r2' | 's3', cfg: AppConfigService) {
    this.driver = driver;
    const storage = cfg.storage;
    this.buckets = storage.buckets;
    this.endpoint = storage.endpoint;
    this.cdn = {
      private: cfg.raw.S3_CDN_PRIVATE || '',
      public: cfg.raw.S3_CDN_PUBLIC || '',
    };

    const opts: S3ClientConfig = {
      region: storage.region || 'us-east-1',
      credentials: {
        accessKeyId: storage.accessKeyId,
        secretAccessKey: storage.secretAccessKey,
      },
      // MinIO needs path-style addressing; AWS S3 and R2 both default to
      // virtual-host style which works fine.
      forcePathStyle: driver === 'minio',
    };
    if (storage.endpoint) opts.endpoint = storage.endpoint;
    this.client = new S3Client(opts);
  }

  bucketName(kind: StorageBucketKind): string {
    return this.buckets[kind];
  }

  async presignPut(
    kind: StorageBucketKind,
    key: string,
    contentType: string,
    sizeBytes: number,
    ttlSeconds: number,
  ): Promise<PresignedPutResult> {
    const command = new PutObjectCommand({
      Bucket: this.bucketName(kind),
      Key: key,
      ContentType: contentType,
      ContentLength: sizeBytes,
    });
    const url = await getSignedUrl(this.client, command, { expiresIn: ttlSeconds });
    return {
      url,
      // The presigner signs Content-Type + Content-Length — the client MUST
      // echo them or the PUT fails with SignatureDoesNotMatch.
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(sizeBytes),
      },
      expires_in_seconds: ttlSeconds,
    };
  }

  async presignGet(kind: StorageBucketKind, key: string, ttlSeconds: number): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName(kind),
      Key: key,
    });
    return getSignedUrl(this.client, command, { expiresIn: ttlSeconds });
  }

  publicUrl(kind: StorageBucketKind, key: string): string {
    // Public CDN base (CloudFront in prod, MinIO endpoint in dev).
    const base =
      kind === 'public' && this.cdn.public
        ? this.cdn.public
        : `${this.endpoint.replace(/\/$/, '')}/${this.bucketName(kind)}`;
    return `${base.replace(/\/$/, '')}/${key.replace(/^\//, '')}`;
  }

  async head(kind: StorageBucketKind, key: string): Promise<ObjectHead | null> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucketName(kind),
          Key: key,
        }),
      );
      return {
        size_bytes: Number(res.ContentLength ?? 0),
        content_type: res.ContentType ?? 'application/octet-stream',
        etag: res.ETag ? res.ETag.replace(/^"|"$/g, '') : '',
        last_modified: res.LastModified ?? new Date(),
      };
    } catch (err: unknown) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async getObject(kind: StorageBucketKind, key: string): Promise<GetObjectStreamResult> {
    const res = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucketName(kind),
        Key: key,
      }),
    );
    const stream = res.Body as AsyncIterable<Uint8Array> | undefined;
    if (!stream) {
      throw new Error(`Empty body for ${this.bucketName(kind)}/${key}`);
    }
    const body = await streamToBuffer(stream);
    return {
      body,
      contentType: res.ContentType ?? 'application/octet-stream',
      size_bytes: body.length,
    };
  }

  async putObject(kind: StorageBucketKind, key: string, input: PutObjectInput): Promise<void> {
    const command: PutObjectCommand = new PutObjectCommand({
      Bucket: this.bucketName(kind),
      Key: key,
      Body: input.body,
      ContentType: input.contentType,
      ...(input.contentDisposition ? { ContentDisposition: input.contentDisposition } : {}),
      ...(input.cacheControl ? { CacheControl: input.cacheControl } : {}),
      ...(input.metadata ? { Metadata: input.metadata } : {}),
    });
    await this.client.send(command);
  }

  async deleteObject(kind: StorageBucketKind, key: string): Promise<void> {
    await this.client
      .send(
        new DeleteObjectCommand({
          Bucket: this.bucketName(kind),
          Key: key,
        }),
      )
      .catch((err: unknown) => {
        const e = err as { $metadata?: { httpStatusCode?: number } };
        if (e.$metadata?.httpStatusCode === 404) return;
        throw err;
      });
  }
}
