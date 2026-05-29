/**
 * Health + metrics endpoints (SPEC §18.6).
 *
 *   GET /healthz   — liveness; 200 immediately, no dependency checks.
 *   GET /readyz    — readiness; Postgres write + read, Redis, S3 (skippable).
 *   GET /metrics   — Prometheus exposition; restricted to loopback or to
 *                    callers carrying the internal scrape key.
 *
 * All three set the `BYPASS_ENVELOPE` flag on the response so the global
 * `TransformInterceptor` leaves the body untouched (ALB / Prometheus expect
 * a specific format, not our `{ data, meta }` envelope).
 */

import { Controller, ForbiddenException, Get, Header, Req, Res } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';

import { BYPASS_ENVELOPE } from '../../common/interceptors/transform.interceptor';
import { Public } from '../../modules/auth/decorators/public.decorator';
import { AppConfigService } from '../config/app-config.service';

import { DbReadIndicator } from './db-read.indicator';
import { DbWriteIndicator } from './db-write.indicator';
import { MetricsService } from './metrics.service';
import { RedisIndicator } from './redis.indicator';
import { StorageIndicator } from './storage.indicator';

import type { Request, Response } from 'express';

const LOOPBACKS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

// ALB / k8s probes hit /healthz every 5–10s and Prometheus scrapes /metrics
// every 15s — neither should ever burn a global throttle quota.
@SkipThrottle()
@Controller()
@Public()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly dbWrite: DbWriteIndicator,
    private readonly dbRead: DbReadIndicator,
    private readonly redis: RedisIndicator,
    private readonly storage: StorageIndicator,
    private readonly metrics: MetricsService,
    private readonly config: AppConfigService,
  ) {}

  // -- /healthz ----------------------------------------------------------
  @Get('/healthz')
  liveness(@Res({ passthrough: true }) res: Response): { status: 'ok' } {
    (res as { [BYPASS_ENVELOPE]?: boolean })[BYPASS_ENVELOPE] = true;
    return { status: 'ok' };
  }

  // -- /readyz -----------------------------------------------------------
  @Get('/readyz')
  @HealthCheck()
  async readiness(@Res({ passthrough: true }) res: Response) {
    (res as { [BYPASS_ENVELOPE]?: boolean })[BYPASS_ENVELOPE] = true;
    return this.health.check([
      () => this.dbWrite.isHealthy('postgres_write'),
      () => this.dbRead.isHealthy('postgres_read'),
      () => this.redis.isHealthy('redis'),
      () => this.storage.isHealthy('storage'),
    ]);
  }

  // -- /metrics ----------------------------------------------------------
  @Get('/metrics')
  @Header('Cache-Control', 'no-store')
  async getMetrics(@Req() req: Request, @Res({ passthrough: false }) res: Response): Promise<void> {
    if (!this.isMetricsCallerAllowed(req)) {
      throw new ForbiddenException('Metrics access denied');
    }
    (res as { [BYPASS_ENVELOPE]?: boolean })[BYPASS_ENVELOPE] = true;
    res.setHeader('Content-Type', this.metrics.contentType);
    res.status(200).send(await this.metrics.render());
  }

  /** Loopback always; otherwise require the configured internal scrape key. */
  private isMetricsCallerAllowed(req: Request): boolean {
    const ip = (req.ip ?? '').replace(/^::ffff:/, '');
    if (LOOPBACKS.has(req.ip ?? '') || LOOPBACKS.has(ip)) return true;
    const requiredKey = this.config.metricsInternalKey;
    if (!requiredKey) return false;
    const provided = req.header('x-metrics-key');
    return provided === requiredKey;
  }
}
