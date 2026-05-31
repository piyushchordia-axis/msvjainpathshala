/**
 * Global rate-limiting (Step 23 — SPEC §16.1, §17.7).
 *
 * The OTP endpoints have a dedicated sliding-window limiter in
 * `auth/services/otp.service.ts` (3/min/phone, 10/hr/phone, 30/hr/IP) that
 * pre-dates this module. This module adds a *coarse* per-IP global throttle
 * across every other authenticated endpoint to defend the rest of the API
 * surface against scraping or burst-abuse — 60 requests / minute / IP by
 * default, which is roomy enough that legitimate clients (mobile app + web
 * admin) never see a 429 but tight enough to slow a runaway script.
 *
 * Storage is Redis-backed so the limit is shared across every API task
 * behind the ALB. We reuse `RedisService.cacheClient` rather than creating
 * a sixth connection.
 *
 * Hot paths can opt out per-route with `@SkipThrottle()` — the existing
 * OTP routes do exactly this so their custom limiter remains authoritative.
 */

import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule, type ThrottlerStorage } from '@nestjs/throttler';

import { AppConfigService } from '../config/app-config.service';
import { RedisService } from '../redis/redis.service';

import type { Redis } from 'ioredis';

/**
 * Sliding-window storage backed by a single Redis sorted set per key.
 * We score by timestamp (ms), prune entries older than the window on every
 * hit, then count the survivors. Same shape that `otp.service.ts` uses, just
 * generic.
 */
class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly client: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<{
    totalHits: number;
    timeToExpire: number;
    isBlocked: boolean;
    timeToBlockExpire: number;
  }> {
    const now = Date.now();
    const windowMs = ttl; // @nestjs/throttler@6 already passes ms
    const windowKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `${windowKey}:blocked`;

    // Already blocked? Short-circuit.
    const blockExpiry = await this.client.pttl(blockKey);
    if (blockExpiry > 0) {
      return {
        totalHits: limit + 1,
        timeToExpire: Math.ceil(blockExpiry / 1000),
        isBlocked: true,
        timeToBlockExpire: Math.ceil(blockExpiry / 1000),
      };
    }

    // Slide the window, add the new hit, count, expire.
    const pipeline = this.client.multi();
    pipeline.zremrangebyscore(windowKey, 0, now - windowMs);
    pipeline.zadd(windowKey, now, `${now}-${Math.random()}`);
    pipeline.zcard(windowKey);
    pipeline.pexpire(windowKey, windowMs);
    const replies = await pipeline.exec();
    const totalHits = Number((replies?.[2]?.[1] as number) ?? 0);

    if (totalHits > limit && blockDuration > 0) {
      await this.client.psetex(blockKey, blockDuration, '1');
      return {
        totalHits,
        timeToExpire: Math.ceil(blockDuration / 1000),
        isBlocked: true,
        timeToBlockExpire: Math.ceil(blockDuration / 1000),
      };
    }

    return {
      totalHits,
      timeToExpire: Math.ceil(windowMs / 1000),
      isBlocked: false,
      timeToBlockExpire: 0,
    };
  }
}

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [RedisService, AppConfigService],
      useFactory: (redis: RedisService, config: AppConfigService) => ({
        // 60 requests / 60 s window in production. Burstable by design —
        // the per-route rate limits (OTP, donation order create, etc.)
        // handle tight cases. Dev/test bumps the limit dramatically so
        // integration suites firing many sequential requests from
        // 127.0.0.1 don't hit the cap; the real defence in those envs
        // is the OTP sliding-window limiter in `auth/services/otp.service.ts`.
        throttlers: [
          {
            name: 'default',
            ttl: 60_000,
            limit: config.isProduction ? 60 : 100_000,
          },
        ],
        storage: new RedisThrottlerStorage(redis.cacheClient),
        // Trust the proxy so the throttle key is the real client IP, not
        // the ALB private IP. main.ts already sets `trust proxy`.
        ignoreUserAgents: [/^kube-probe\//, /^ELB-HealthChecker\//],
      }),
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class GlobalThrottlerModule {}
