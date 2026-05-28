/**
 * S3 / R2 / MinIO storage reachability (SPEC §18.6).
 *
 * In production this performs a HEAD against a probe object. In dev with
 * `STORAGE_DRIVER=noop` we skip the check and report healthy with a
 * `skipped: true` flag — the readiness page still tells operators what is
 * being checked vs. waived.
 *
 * Step 11 (media module) replaces the placeholder probe with a real HEAD
 * against the private bucket; this indicator's interface stays stable so we
 * don't need to touch the health module again.
 */

import { Injectable } from '@nestjs/common';
import { HealthIndicator, type HealthIndicatorResult } from '@nestjs/terminus';

import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class StorageIndicator extends HealthIndicator {
  constructor(private readonly config: AppConfigService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    if (this.config.storage.driver === 'noop') {
      return this.getStatus(key, true, { skipped: true, reason: 'STORAGE_DRIVER=noop' });
    }

    // Step 3 stub — Step 11 swaps this for a real HEAD probe. For now any
    // configured driver is reported as healthy if endpoint + access key look
    // populated; otherwise it's reported as unhealthy.
    const ok = Boolean(
      this.config.storage.endpoint &&
      this.config.storage.accessKeyId &&
      this.config.storage.secretAccessKey,
    );
    return this.getStatus(key, ok, ok ? {} : { reason: 'Storage env vars missing' });
  }
}
