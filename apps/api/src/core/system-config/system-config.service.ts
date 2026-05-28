/**
 * SystemConfigService — runtime-tunable knobs (OTP TTL, rate limits, session
 * caps, etc.).
 *
 * Read path (cheap):
 *   1. Redis cache `cfg:{key}` (60s TTL, set-on-miss)
 *   2. system_config row
 *   3. Env-default fallback (defined in `DEFAULTS`)
 *
 * Writes (super_admin endpoint, Step 6+) invalidate the Redis key.
 *
 * The cache TTL is 60s so admin edits propagate to all instances within a
 * minute without an explicit pub/sub notification. If we ever need faster
 * propagation we can add a `cache.invalidate` pub/sub channel (already in
 * the SPEC §17.2 plan).
 */

import { Injectable, Logger } from '@nestjs/common';

import { SystemConfigRepository } from '../../db/repositories/system-config.repository';
import { RedisService } from '../redis/redis.service';

/**
 * Compile-time list of every key we expose + its default. Adding a key here
 * (and to the 0005 migration's seed) is enough to make it configurable —
 * the typed `get(key)` method picks up the type from this object.
 */
export const SYSTEM_CONFIG_DEFAULTS = {
  'otp.ttl_seconds': 300,
  'otp.send.per_minute_per_phone': 3,
  'otp.send.per_hour_per_phone': 10,
  'otp.send.per_hour_per_ip': 30,
  'otp.verify.max_attempts': 3,
  'session.max_active_per_user': 5,
  'jwt.access_ttl_seconds': 900,
  'jwt.refresh_ttl_seconds': 2_592_000,
  'impersonation.ttl_minutes': 30,
  'student_view.min_age_years': 13,
  'audit.async_enabled': false,
} as const;

export type SystemConfigKey = keyof typeof SYSTEM_CONFIG_DEFAULTS;
export type SystemConfigValue<K extends SystemConfigKey> = (typeof SYSTEM_CONFIG_DEFAULTS)[K];

const CACHE_TTL_SECONDS = 60;
const cacheKey = (key: string): string => `cfg:${key}`;

@Injectable()
export class SystemConfigService {
  private readonly logger = new Logger(SystemConfigService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly repo: SystemConfigRepository,
  ) {}

  /**
   * Typed read. Returns the configured value, or the compile-time default if
   * the row is missing. Caches the resolved value in Redis for 60s.
   */
  async get<K extends SystemConfigKey>(key: K): Promise<SystemConfigValue<K>> {
    const cached = await this.redis.cacheClient.get(cacheKey(key));
    if (cached !== null) {
      try {
        return JSON.parse(cached) as SystemConfigValue<K>;
      } catch {
        // corrupt cache value — fall through to DB
      }
    }

    const row = await this.repo.findByKey(key);
    const value =
      row !== null
        ? (row.value as SystemConfigValue<K>)
        : (SYSTEM_CONFIG_DEFAULTS[key] as SystemConfigValue<K>);

    // Cache the resolved value (including misses → defaults) so we don't hit
    // the DB twice for a missing row.
    await this.redis.cacheClient.set(cacheKey(key), JSON.stringify(value), 'EX', CACHE_TTL_SECONDS);

    return value;
  }

  /** Convenience — typed integer read. Throws if the value isn't a number. */
  async getNumber<K extends SystemConfigKey>(key: K): Promise<number> {
    const v = await this.get(key);
    if (typeof v !== 'number') {
      throw new Error(`[SystemConfig] expected number for '${key}', got ${typeof v}`);
    }
    return v;
  }

  /** Convenience — typed boolean read. */
  async getBoolean<K extends SystemConfigKey>(key: K): Promise<boolean> {
    const v = await this.get(key);
    return Boolean(v);
  }

  /** Admin write. Bumps the cache version so other instances refetch. */
  async set<K extends SystemConfigKey>(
    key: K,
    value: SystemConfigValue<K>,
    updatedBy: string | null,
  ): Promise<void> {
    await this.repo.upsert(key, value, updatedBy);
    await this.redis.cacheClient.del(cacheKey(key));
    this.logger.log(`system_config[${key}] updated by ${updatedBy ?? 'system'}`);
  }
}
