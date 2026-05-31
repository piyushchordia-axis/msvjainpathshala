/**
 * `media.processing` worker (SPEC §10.2, Step 11).
 *
 * Pulls a media asset from storage and runs the per-type pipeline:
 *
 *   images (jpeg/png/webp/heic):
 *     - sniff actual type via file-type (defence vs spoofed MIME)
 *     - sharp().rotate()  — apply EXIF orientation
 *     - sharp().withMetadata({})  — strip ALL EXIF (privacy, GPS)
 *     - emit thumb_sm (200px), thumb_md (600px), thumb_lg (1200px) — all WebP q80
 *     - upload the same `{key}__thumb_sm.webp` etc. siblings to the same bucket
 *
 *   videos (mp4/mov/webm):
 *     - generate frame-at-1s thumbnail when ffmpeg is available; otherwise
 *       skip (the worker stays soft-failure tolerant — videos still go ready
 *       without a thumb)
 *
 *   PDFs:
 *     - currently no cover thumbnail (pdf2pic requires GraphicsMagick on the
 *       host; we keep it pluggable but skip in v1)
 *
 * On success: `markReady(asset, { width, height, thumbnail_s3_key, exif_stripped })`.
 * On unrecoverable failure: BaseProcessor re-throws → DLQ. The status is
 * also flipped to 'failed' so the GET endpoint surfaces it correctly.
 */

import { Processor } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { fromBuffer as fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';

import { QUEUES } from '@jp/shared';

import { RedisService } from '../../core/redis/redis.service';
import { StorageService } from '../../core/storage/storage.service';
import { MediaAssetsRepository } from '../../db/repositories';
import { KIND_BUCKET } from '../../modules/media/media.policy';

import { BaseProcessor } from './base.processor';

import type { StorageBucketKind } from '../../core/storage/storage.types';
import type { ProcessingResultMetadata } from '../../db/repositories/media-assets.repository';
import type { Job } from 'bullmq';

export interface MediaProcessingPayload {
  media_asset_id: string;
}

export interface MediaProcessingResult {
  status: 'ready' | 'failed';
  thumbnail_s3_key?: string;
  variants_generated?: string[];
}

interface SharpVariant {
  suffix: string; // appended to the original key (sans extension)
  width: number;
}

const IMAGE_VARIANTS: SharpVariant[] = [
  { suffix: '__thumb_sm', width: 200 },
  { suffix: '__thumb_md', width: 600 },
  { suffix: '__thumb_lg', width: 1200 },
];

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const VIDEO_MIMES = new Set(['video/mp4', 'video/quicktime', 'video/webm']);

function stripExtension(key: string): { base: string; ext: string } {
  const dot = key.lastIndexOf('.');
  if (dot < 0) return { base: key, ext: '' };
  return { base: key.slice(0, dot), ext: key.slice(dot) };
}

@Injectable()
@Processor(QUEUES.MEDIA_PROCESSING, { concurrency: 4 })
export class MediaProcessingProcessor extends BaseProcessor<
  MediaProcessingPayload,
  MediaProcessingResult
> {
  private readonly localLogger = new Logger('media-processing');

  constructor(
    redis: RedisService,
    private readonly storage: StorageService,
    private readonly repo: MediaAssetsRepository,
  ) {
    super(QUEUES.MEDIA_PROCESSING, redis);
  }

  async handle(
    job: Job<MediaProcessingPayload, MediaProcessingResult>,
  ): Promise<MediaProcessingResult> {
    const { media_asset_id } = job.data;
    const asset = await this.repo.findById(media_asset_id);
    if (!asset) {
      throw new Error(`media_asset ${media_asset_id} not found`);
    }

    const bucketKind: StorageBucketKind = KIND_BUCKET[asset.kind];
    const original = await this.storage.adapter.getObject(bucketKind, asset.s3_key);
    const declaredMime = asset.mime_type.toLowerCase();

    try {
      // ---- Image pipeline ---------------------------------------------------
      if (IMAGE_MIMES.has(declaredMime)) {
        const meta = await this.processImage(asset.s3_key, original.body, bucketKind);
        await this.repo.markReady(asset.id, meta);
        return {
          status: 'ready',
          ...(meta.thumbnail_s3_key ? { thumbnail_s3_key: meta.thumbnail_s3_key } : {}),
          variants_generated: IMAGE_VARIANTS.map((v) => v.suffix),
        };
      }

      // ---- Video pipeline (frame-at-1s thumbnail) --------------------------
      if (VIDEO_MIMES.has(declaredMime)) {
        const meta: ProcessingResultMetadata = {
          exif_stripped: false,
          virus_scan_status: 'skipped',
          size_bytes: original.size_bytes,
        };
        const thumb = await this.tryFfmpegThumbnail(original.body);
        if (thumb) {
          const { base } = stripExtension(asset.s3_key);
          const thumbKey = `${base}__thumb_md.webp`;
          await this.storage.adapter.putObject(bucketKind, thumbKey, {
            body: thumb,
            contentType: 'image/webp',
            cacheControl: 'public,max-age=31536000,immutable',
          });
          meta.thumbnail_s3_key = thumbKey;
        }
        await this.repo.markReady(asset.id, meta);
        return {
          status: 'ready',
          ...(meta.thumbnail_s3_key ? { thumbnail_s3_key: meta.thumbnail_s3_key } : {}),
        };
      }

      // ---- PDF / other ---------------------------------------------------
      await this.repo.markReady(asset.id, {
        exif_stripped: false,
        virus_scan_status: 'skipped',
        size_bytes: original.size_bytes,
      });
      return { status: 'ready' };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await this.repo.markFailed(asset.id, reason).catch(() => undefined);
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Image pipeline
  // ---------------------------------------------------------------------------

  private async processImage(
    s3Key: string,
    buffer: Buffer,
    bucketKind: StorageBucketKind,
  ): Promise<ProcessingResultMetadata> {
    // Defence-in-depth: validate the actual file type, not just the
    // client-declared MIME (CLAUDE.md "Common pitfalls").
    const detected = await fileTypeFromBuffer(buffer);
    if (!detected || !detected.mime.startsWith('image/')) {
      throw new Error(`Detected MIME '${detected?.mime ?? 'unknown'}' is not an image`);
    }

    // Re-encode the original WITHOUT EXIF — `.rotate()` bakes any
    // orientation tag into the pixels, and sharp's default for `.toBuffer()`
    // is to drop ALL metadata (EXIF/IPTC/XMP/ICC) unless you opt back in
    // via `.withMetadata()` / `.keepExif()`. We deliberately omit those
    // calls so the GPS sub-IFD and any other PII tags never make it back
    // out of the pipeline.
    const stripped = await sharp(buffer).rotate().toBuffer();
    const meta = await sharp(stripped).metadata();

    // Overwrite the original with the EXIF-stripped bytes. Same key, same
    // bucket, same MIME so signed URLs and content-type negotiation still
    // work the same.
    await this.storage.adapter.putObject(bucketKind, s3Key, {
      body: stripped,
      contentType: detected.mime,
      cacheControl: 'public,max-age=31536000,immutable',
    });

    // Generate WebP variants from the stripped buffer.
    const { base } = stripExtension(s3Key);
    let mediumThumbKey: string | undefined;
    const generated: string[] = [];
    for (const variant of IMAGE_VARIANTS) {
      const out = await sharp(stripped)
        .resize({ width: variant.width, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      const key = `${base}${variant.suffix}.webp`;
      await this.storage.adapter.putObject(bucketKind, key, {
        body: out,
        contentType: 'image/webp',
        cacheControl: 'public,max-age=31536000,immutable',
      });
      generated.push(key);
      if (variant.suffix === '__thumb_md') mediumThumbKey = key;
    }

    this.localLogger.debug(`generated ${generated.length} variants for ${s3Key}`);

    return {
      width: meta.width ?? null,
      height: meta.height ?? null,
      exif_stripped: true,
      virus_scan_status: 'skipped',
      size_bytes: stripped.length,
      thumbnail_s3_key: mediumThumbKey ?? null,
    };
  }

  // ---------------------------------------------------------------------------
  // Video pipeline (best-effort ffmpeg)
  // ---------------------------------------------------------------------------

  /**
   * Generate a single thumbnail at t=1s using ffmpeg if the binary is on the
   * PATH. We deliberately avoid the `fluent-ffmpeg` npm package here so we
   * don't add a heavy native dep — fully optional, no-op when ffmpeg is
   * absent. Returns null on any failure.
   */
  private async tryFfmpegThumbnail(buffer: Buffer): Promise<Buffer | null> {
    try {
      const { spawn } = await import('node:child_process');
      return await new Promise<Buffer | null>((resolve) => {
        const proc = spawn('ffmpeg', [
          '-loglevel',
          'error',
          '-i',
          'pipe:0',
          '-ss',
          '1',
          '-vframes',
          '1',
          '-vf',
          'scale=600:-1',
          '-f',
          'image2pipe',
          '-vcodec',
          'png',
          'pipe:1',
        ]);
        const out: Buffer[] = [];
        proc.stdout.on('data', (c: Buffer) => out.push(c));
        proc.on('error', () => resolve(null));
        proc.on('close', async (code) => {
          if (code !== 0) return resolve(null);
          try {
            const raw = Buffer.concat(out);
            const webp = await sharp(raw).webp({ quality: 80 }).toBuffer();
            resolve(webp);
          } catch {
            resolve(null);
          }
        });
        proc.stdin.write(buffer);
        proc.stdin.end();
      });
    } catch {
      return null;
    }
  }
}
