/**
 * StorageService — DI wrapper that delegates to the active StorageAdapter.
 *
 * Code that needs storage injects this rather than the adapter directly so
 * tests can swap the adapter without re-wiring the module graph. The adapter
 * is selected once at boot from `AppConfigService.storage.driver`.
 *
 * Public helpers above the adapter surface:
 *   - `signedReadUrl(assetId|key, ttl?)` for media GET (SPEC §10.3)
 *   - `objectKey(kind, userId, ext)` for SPEC §10.1 step 4 deterministic keys
 *
 * The adapter is reached via `this.adapter` for direct calls (presignPut,
 * head, putObject, etc.).
 */

import { randomUUID } from 'node:crypto';

import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { AppConfigService } from '../config/app-config.service';

import { NoopAdapter } from './noop-adapter';
import { S3Adapter } from './s3-adapter';

import type { StorageAdapter, StorageBucketKind } from './storage.types';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  readonly adapter: StorageAdapter;

  constructor(private readonly cfg: AppConfigService) {
    const driver = cfg.storage.driver;
    if (driver === 'noop') {
      this.adapter = new NoopAdapter();
    } else {
      this.adapter = new S3Adapter(driver, cfg);
    }
  }

  onModuleInit(): void {
    this.logger.log(
      `StorageService initialised — driver=${this.adapter.driver} ` +
        `private=${this.adapter.bucketName('private')} public=${this.adapter.bucketName('public')}`,
    );
  }

  /**
   * SPEC §10.1 step 4 — deterministic S3 key:
   *   {kind}/{yyyy}/{mm}/{user_id}/{uuid}.{ext}
   *
   * The {uuid} guarantees no collisions even for the same user uploading
   * the same file twice. The yyyy/mm prefix gives lifecycle rules a useful
   * partition.
   */
  buildObjectKey(kind: string, userId: string, extension: string): string {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const ext = (extension || 'bin').replace(/^\./, '').toLowerCase();
    return `${kind}/${yyyy}/${mm}/${userId}/${randomUUID()}.${ext}`;
  }

  /**
   * Convenience: signed GET URL for the active SIGNED_URL_TTL_SECONDS.
   */
  async signedReadUrl(
    bucket: StorageBucketKind,
    key: string,
    ttlSeconds?: number,
  ): Promise<string> {
    const ttl = ttlSeconds ?? this.cfg.storage.signedUrlTtlSeconds;
    return this.adapter.presignGet(bucket, key, ttl);
  }
}
