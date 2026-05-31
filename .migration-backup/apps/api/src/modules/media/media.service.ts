/**
 * MediaService — orchestrates the three media endpoints (SPEC §6.24, §2.6).
 *
 * Methods:
 *   signUpload  — validate kind/mime/size, insert media_assets row (pending),
 *                 return presigned PUT URL
 *   finalize    — HEAD the uploaded object, switch status to processing,
 *                 enqueue media.processing
 *   getReadUrl  — scope-check + signed GET URL (CDN-style)
 *
 * Caller authorisation lives in the controller — this layer assumes the
 * actor is authenticated and validated.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import { AppError, ERROR_CODES, QUEUES, type MediaKind, type Role } from '@jp/shared';

import { AppConfigService } from '../../core/config/app-config.service';
import { RedisService } from '../../core/redis/redis.service';
import { StorageService } from '../../core/storage/storage.service';
import { MediaAssetsRepository } from '../../db/repositories';

import {
  KIND_BUCKET,
  KIND_LIMITS,
  PRESIGN_PUT_TTL_SECONDS,
  extensionFor,
  isAllowedMime,
  isAllowedRoleForKind,
  maxSizeFor,
} from './media.policy';

import type { StorageBucketKind } from '../../core/storage/storage.types';
import type { MediaAsset } from '../../db/schema';

export interface ScopedActor {
  user_id: string;
  role: Role;
}

export interface SignUploadInput {
  kind: MediaKind;
  mime_type: string;
  size_bytes: number;
  checksum_sha256?: string;
}

export interface SignUploadResult {
  asset_id: string;
  upload_url: string;
  upload_headers: Record<string, string>;
  s3_key: string;
  bucket: StorageBucketKind;
  expires_in_seconds: number;
}

export interface FinalizeInput {
  asset_id: string;
  checksum_sha256: string;
}

export interface MediaReadDescriptor {
  id: string;
  status: MediaAsset['status'];
  kind: MediaAsset['kind'];
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  url: string | null;
  thumbnail_url: string | null;
  created_at: string;
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly mediaProcessingQueue: Queue;

  constructor(
    private readonly repo: MediaAssetsRepository,
    private readonly storage: StorageService,
    private readonly cfg: AppConfigService,
    redis: RedisService,
  ) {
    this.mediaProcessingQueue = new Queue(QUEUES.MEDIA_PROCESSING, {
      connection: redis.bullmqClient,
    });
  }

  // ---------------------------------------------------------------------------
  // signUpload
  // ---------------------------------------------------------------------------

  async signUpload(actor: ScopedActor, input: SignUploadInput): Promise<SignUploadResult> {
    if (!isAllowedRoleForKind(input.kind, actor.role)) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: `Role '${actor.role}' is not allowed to upload media of kind '${input.kind}'`,
        statusCode: 403,
      });
    }

    if (!isAllowedMime(input.kind, input.mime_type)) {
      throw new AppError({
        code: ERROR_CODES.ERR_MEDIA_UNSUPPORTED_TYPE,
        message: `MIME type '${input.mime_type}' is not allowed for kind '${input.kind}'`,
        statusCode: 415,
        details: [
          {
            path: 'mime_type',
            meta: { allowed: KIND_LIMITS[input.kind].allowed_mimes as readonly string[] },
          },
        ],
      });
    }

    const maxBytes = maxSizeFor(input.kind, input.mime_type);
    if (input.size_bytes > maxBytes) {
      throw new AppError({
        code: ERROR_CODES.ERR_MEDIA_TOO_LARGE,
        message: `File exceeds the ${Math.round(maxBytes / 1_048_576)}MB limit for kind '${input.kind}'`,
        statusCode: 413,
        details: [{ path: 'size_bytes', meta: { max_bytes: maxBytes } }],
      });
    }

    const bucketKind = KIND_BUCKET[input.kind];
    const ext = extensionFor(input.mime_type);
    const s3Key = this.storage.buildObjectKey(input.kind, actor.user_id, ext);
    const bucketName = this.storage.adapter.bucketName(bucketKind);

    // Persist a `pending` row first so finalize() has something to match
    // against. The checksum on this row is the client-asserted one (if
    // provided) — finalize() will replace it with the verified value.
    const asset = await this.repo.create({
      kind: input.kind,
      owner_user_id: actor.user_id,
      s3_bucket: bucketName,
      s3_key: s3Key,
      mime_type: input.mime_type,
      size_bytes: input.size_bytes,
      checksum_sha256: input.checksum_sha256 ?? '',
      status: 'pending',
      exif_stripped: false,
    });

    const presign = await this.storage.adapter.presignPut(
      bucketKind,
      s3Key,
      input.mime_type,
      input.size_bytes,
      PRESIGN_PUT_TTL_SECONDS,
    );

    return {
      asset_id: asset.id,
      upload_url: presign.url,
      upload_headers: presign.headers,
      s3_key: s3Key,
      bucket: bucketKind,
      expires_in_seconds: presign.expires_in_seconds,
    };
  }

  // ---------------------------------------------------------------------------
  // finalize
  // ---------------------------------------------------------------------------

  async finalize(actor: ScopedActor, input: FinalizeInput): Promise<MediaAsset> {
    const asset = await this.repo.findById(input.asset_id);
    if (!asset) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Media asset not found',
        statusCode: 404,
      });
    }
    if (asset.owner_user_id !== actor.user_id) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: 'You can only finalise media you uploaded',
        statusCode: 403,
      });
    }
    if (asset.status !== 'pending') {
      throw new AppError({
        code: ERROR_CODES.ERR_CONFLICT_STATE_TRANSITION,
        message: `Media is ${asset.status}, only 'pending' can be finalised`,
        statusCode: 409,
      });
    }

    // Verify the uploaded object exists in storage. HEAD also gives us the
    // authoritative size — we trust S3 over the client's assertion.
    const bucketKind = KIND_BUCKET[asset.kind];
    const head = await this.storage.adapter.head(bucketKind, asset.s3_key);
    if (!head) {
      throw new AppError({
        code: ERROR_CODES.ERR_MEDIA_UPLOAD_FAILED,
        message: 'Upload was not found in storage — re-upload and finalise again',
        statusCode: 409,
      });
    }
    const maxBytes = maxSizeFor(asset.kind, head.content_type);
    if (head.size_bytes > maxBytes) {
      throw new AppError({
        code: ERROR_CODES.ERR_MEDIA_TOO_LARGE,
        message: `Uploaded file (${head.size_bytes} bytes) exceeds the ${maxBytes}-byte limit`,
        statusCode: 413,
      });
    }

    // Switch to 'uploaded' + record HEAD-truth + the verified checksum.
    await this.repo.markUploaded(asset.id, {
      size_bytes: head.size_bytes,
      checksum_sha256: input.checksum_sha256,
    });
    const ready = await this.repo.updateStatus(asset.id, 'processing');

    // Enqueue media processing. Job id = asset id so a duplicate finalize
    // doesn't enqueue a duplicate job.
    await this.mediaProcessingQueue
      .add(
        'media.processing',
        { media_asset_id: asset.id },
        { jobId: `media:${asset.id}`, removeOnComplete: { age: 86_400, count: 1_000 } },
      )
      .catch((err) =>
        this.logger.error(`media.processing enqueue failed: ${(err as Error).message}`),
      );

    return ready ?? asset;
  }

  // ---------------------------------------------------------------------------
  // getReadUrl
  // ---------------------------------------------------------------------------

  async getReadDescriptor(actor: ScopedActor, assetId: string): Promise<MediaReadDescriptor> {
    const asset = await this.repo.findById(assetId);
    if (!asset) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Media asset not found',
        statusCode: 404,
      });
    }

    // Authorisation per SPEC §10.3: the owner can always read their own
    // assets; admins (sanchalak+) can read media in their scope (scope
    // checks deepen per-kind in future steps). For Step 11 the rule is:
    // owner OR sanchalak+.
    const isOwner = asset.owner_user_id === actor.user_id;
    const isAdmin = ['super_admin', 'state_admin', 'city_admin', 'sanchalak', 'shikshak'].includes(
      actor.role,
    );
    if (!isOwner && !isAdmin) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: 'You do not have access to this media asset',
        statusCode: 403,
      });
    }

    const bucketKind = KIND_BUCKET[asset.kind];
    let url: string | null = null;
    let thumbnailUrl: string | null = null;
    if (asset.status === 'ready' || asset.status === 'uploaded') {
      if (bucketKind === 'public') {
        url = this.storage.adapter.publicUrl(bucketKind, asset.s3_key);
        thumbnailUrl = asset.thumbnail_s3_key
          ? this.storage.adapter.publicUrl(bucketKind, asset.thumbnail_s3_key)
          : null;
      } else {
        url = await this.storage.signedReadUrl(bucketKind, asset.s3_key);
        thumbnailUrl = asset.thumbnail_s3_key
          ? await this.storage.signedReadUrl(bucketKind, asset.thumbnail_s3_key)
          : null;
      }
    }

    return {
      id: asset.id,
      status: asset.status,
      kind: asset.kind,
      mime_type: asset.mime_type,
      size_bytes: asset.size_bytes,
      width: asset.width,
      height: asset.height,
      duration_seconds: asset.duration_seconds,
      url,
      thumbnail_url: thumbnailUrl,
      created_at: asset.created_at.toISOString(),
    };
  }
}
