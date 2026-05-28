import { Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, type HealthIndicatorResult } from '@nestjs/terminus';

import { type RedisService } from '../redis/redis.service';

/** Redis cache client `PING` readiness per SPEC §18.6. */
@Injectable()
export class RedisIndicator extends HealthIndicator {
  constructor(private readonly redis: RedisService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const ok = await this.redis.ping();
    if (ok) return this.getStatus(key, true);
    throw new HealthCheckError(`${key} unreachable`, this.getStatus(key, false));
  }
}
