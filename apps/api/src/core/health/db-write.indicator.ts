import { Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, type HealthIndicatorResult } from '@nestjs/terminus';

import { type DrizzleService } from '../database/drizzle.service';

/** Postgres write pool readiness — `SELECT 1` per SPEC §18.6. */
@Injectable()
export class DbWriteIndicator extends HealthIndicator {
  constructor(private readonly drizzle: DrizzleService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const { write } = await this.drizzle.ping();
    if (write) return this.getStatus(key, true);
    throw new HealthCheckError(`${key} unreachable`, this.getStatus(key, false));
  }
}
