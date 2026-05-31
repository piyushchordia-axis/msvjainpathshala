/**
 * MediaAssetsRepository — `media_assets` table (SPEC §5.21).
 *
 * Lifecycle:
 *   create() → status='pending'                (signed-upload phase)
 *   markUploaded() → status='uploaded' + processed_at metadata
 *   markProcessing() / markReady() / markFailed() / markQuarantined()
 *
 * `findById` returns soft-deleted rows so admin tooling can still inspect
 * historical assets. Higher layers filter `deleted_at`.
 */

import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { media_assets } from '../schema';

import type { MediaAsset, NewMediaAsset } from '../schema';
import type { MediaStatus } from '@jp/shared';

export interface ProcessingResultMetadata {
  width?: number | null;
  height?: number | null;
  duration_seconds?: number | null;
  thumbnail_s3_key?: string | null;
  exif_stripped?: boolean;
  virus_scan_status?: string | null;
  size_bytes?: number;
}

@Injectable()
export class MediaAssetsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async create(input: NewMediaAsset): Promise<MediaAsset> {
    const [row] = await this.drizzle.db.insert(media_assets).values(input).returning();
    if (!row) throw new Error('media_assets insert returned no row');
    return row;
  }

  async findById(id: string): Promise<MediaAsset | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(media_assets)
      .where(and(eq(media_assets.id, id), isNull(media_assets.deleted_at)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Returns soft-deleted rows too — only used by admin / GC tooling. */
  async findByIdIncludingDeleted(id: string): Promise<MediaAsset | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(media_assets)
      .where(eq(media_assets.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async updateStatus(id: string, status: MediaStatus): Promise<MediaAsset | null> {
    const [row] = await this.drizzle.db
      .update(media_assets)
      .set({ status, updated_at: new Date() })
      .where(eq(media_assets.id, id))
      .returning();
    return row ?? null;
  }

  async markUploaded(
    id: string,
    patch: { size_bytes: number; checksum_sha256?: string },
  ): Promise<MediaAsset | null> {
    const [row] = await this.drizzle.db
      .update(media_assets)
      .set({
        status: 'uploaded',
        size_bytes: patch.size_bytes,
        ...(patch.checksum_sha256 ? { checksum_sha256: patch.checksum_sha256 } : {}),
        updated_at: new Date(),
      })
      .where(eq(media_assets.id, id))
      .returning();
    return row ?? null;
  }

  async markReady(id: string, meta: ProcessingResultMetadata): Promise<MediaAsset | null> {
    const [row] = await this.drizzle.db
      .update(media_assets)
      .set({
        status: 'ready',
        ...(meta.width !== undefined ? { width: meta.width } : {}),
        ...(meta.height !== undefined ? { height: meta.height } : {}),
        ...(meta.duration_seconds !== undefined ? { duration_seconds: meta.duration_seconds } : {}),
        ...(meta.thumbnail_s3_key !== undefined ? { thumbnail_s3_key: meta.thumbnail_s3_key } : {}),
        ...(meta.exif_stripped !== undefined ? { exif_stripped: meta.exif_stripped } : {}),
        ...(meta.virus_scan_status !== undefined
          ? { virus_scan_status: meta.virus_scan_status }
          : {}),
        ...(meta.size_bytes !== undefined ? { size_bytes: meta.size_bytes } : {}),
        processed_at: new Date(),
        updated_at: new Date(),
      })
      .where(eq(media_assets.id, id))
      .returning();
    return row ?? null;
  }

  async markFailed(id: string, reason: string): Promise<MediaAsset | null> {
    const [row] = await this.drizzle.db
      .update(media_assets)
      .set({
        status: 'failed',
        virus_scan_status: reason.slice(0, 200),
        processed_at: new Date(),
        updated_at: new Date(),
      })
      .where(eq(media_assets.id, id))
      .returning();
    return row ?? null;
  }
}
