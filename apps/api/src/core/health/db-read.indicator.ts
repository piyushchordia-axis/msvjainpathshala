import { Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, type HealthIndicatorResult } from '@nestjs/terminus';

import { DrizzleService } from '../database/drizzle.service';

/** Postgres read pool readiness (may be the same pool in dev — see SPEC §17.1). */
@Injectable()
export class DbReadIndicator extends HealthIndicator {
  constructor(private readonly drizzle: DrizzleService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const { read } = await this.drizzle.ping();
    if (read) return this.getStatus(key, true);
    throw new HealthCheckError(`${key} unreachable`, this.getStatus(key, false));
  }
}
