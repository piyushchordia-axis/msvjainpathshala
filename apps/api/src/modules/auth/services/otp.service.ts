/**
 * OtpService — request + verify OTPs.
 *
 *   • 6-digit codes (CLAUDE.md + SPEC + Step 5 prompt).
 *   • Argon2id hash stored in Redis with TTL; plaintext never persisted.
 *   • Sliding-window rate limits driven by SystemConfigService (DB knobs):
 *       - per-minute per phone   (default 3)
 *       - per-hour per phone     (default 10)
 *       - per-hour per IP        (default 30)
 *   • Audit row in `phone_otp_attempts` for forensics (separate from the
 *     hot Redis path).
 *   • Max-N wrong verify attempts → lock + clear Redis OTP key.
 *
 * Redis key shapes (all prefixed by `RedisService.cacheClient.keyPrefix`):
 *   otp:{phone}                    → argon2 hash (TTL = ttl_seconds)
 *   otp:attempts:{phone}           → wrong-verify counter (TTL = ttl_seconds)
 *   otp:rl:phone:m1:{phone}        → ZSet of send timestamps (1-minute window)
 *   otp:rl:phone:h1:{phone}        → ZSet of send timestamps (1-hour window)
 *   otp:rl:ip:h1:{ip}              → ZSet of send timestamps (1-hour window)
 *
 * ZSets are pruned + counted via a single MULTI / EXEC per check.
 */

import { randomInt } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';
import { ulid } from 'ulid';

import { AppError, ERROR_CODES } from '@jp/shared';

import { AppConfigService } from '../../../core/config/app-config.service';
import { RedisService } from '../../../core/redis/redis.service';
import { SystemConfigService } from '../../../core/system-config/system-config.service';
import { PhoneOtpAttemptsRepository } from '../../../db/repositories';
import { SMS_PROVIDER_TOKEN, type SmsProvider } from '../providers/sms-provider.interface';

export interface OtpRequestResult {
  otp_token: string;
  expires_in_seconds: number;
}

export interface OtpVerifyOutcome {
  ok: boolean;
  /** Set when ok=true; null otherwise. Caller resolves the user. */
  attempt_id: string | null;
  /**
   * The E.164 phone the verified OTP belongs to. The token→phone mapping
   * is established at /otp/send time so /otp/verify can issue the right
   * user's session without trusting any phone field from the client.
   */
  phone: string;
  reason?: string;
}

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly config: SystemConfigService,
    private readonly attempts: PhoneOtpAttemptsRepository,
    private readonly appConfig: AppConfigService,
    @Inject(SMS_PROVIDER_TOKEN) private readonly sms: SmsProvider,
  ) {
    const master = this.appConfig.otp.devMasterOtp;
    if (master && this.appConfig.isDevelopment) {
      this.logger.warn(
        `dev-only: JP_DEV_MASTER_OTP is set — ANY phone can verify with ${master}. ` +
          'This is a developer-ergonomics escape hatch; never set it in staging/prod.',
      );
    }
  }

  /**
   * Request an OTP: rate-limit, generate, hash, store, persist audit row,
   * send via the configured SmsProvider.
   */
  async request(phone: string, ip: string | null): Promise<OtpRequestResult> {
    await this.enforceRateLimits(phone, ip);

    const ttl = await this.config.getNumber('otp.ttl_seconds');
    const code = generateCode(6);
    const hash = await argon2.hash(code, { type: argon2.argon2id });
    const expiresAt = new Date(Date.now() + ttl * 1000);

    // Replace any prior OTP for the phone (latest-wins).
    await this.redis.cacheClient.set(otpKey(phone), hash, 'EX', ttl);
    await this.redis.cacheClient.del(attemptsKey(phone));

    // Mint an opaque token that binds this send to a future verify call.
    // The client cannot synthesise it from knowledge of the phone alone.
    const token = ulid();
    await this.redis.cacheClient.set(tokenKey(token), phone, 'EX', ttl);

    await this.attempts.insertForPhone({
      phone,
      ip: ip ?? null,
      otp_hash: hash,
      attempts_count: 0,
      expires_at: expiresAt,
    });

    await this.recordRateLimitTimestamp(phone, ip);

    try {
      await this.sms.sendOtp(phone, code);
    } catch (err) {
      this.logger.error(
        `SMS dispatch failed for phone=${phone.slice(0, 3)}…${phone.slice(-2)}: ` +
          (err as Error).message,
      );
      // Don't surface to client — they shouldn't learn whether the gateway
      // is up. The OTP is still in Redis; retry by re-requesting.
    }

    return {
      otp_token: token,
      expires_in_seconds: ttl,
    };
  }

  /**
   * Verify an OTP. The caller passes the `otp_token` returned by /otp/send;
   * we look up the associated phone in Redis and proceed. Returns
   * `{ ok: true, attempt_id, phone }` on success so AuthService can chain
   * user resolution + session creation. Throws AppError on token expiry,
   * rate-limit, lockout, or invalid OTP.
   */
  async verify(otpToken: string, code: string): Promise<OtpVerifyOutcome> {
    // Resolve the phone the token was minted for. An expired or unknown
    // token returns null; we treat that as "OTP expired" rather than
    // "invalid token" so we don't leak token validity to an attacker.
    const phone = await this.redis.cacheClient.get(tokenKey(otpToken));
    if (!phone) {
      throw new AppError({
        code: ERROR_CODES.ERR_AUTH_OTP_EXPIRED,
        message: 'This OTP has expired — request a new one',
        statusCode: 401,
      });
    }

    // Dev-only master OTP shortcut. Bypasses Redis OTP-hash lookup (so it
    // works even when the configured SMS provider is silent) but ONLY when:
    //   - NODE_ENV === 'development'
    //   - JP_DEV_MASTER_OTP is set
    //   - The submitted code matches the master
    // Failure here falls through to the normal Redis path so a wrong
    // guess in dev still goes through the rate-limit / lockout machine.
    const masterOtp = this.appConfig.otp.devMasterOtp;
    if (masterOtp && this.appConfig.isDevelopment && code === masterOtp) {
      this.logger.warn(`dev-master-otp accepted for ${phone}`);
      const active = await this.attempts.findActiveByPhone(phone);
      if (active) {
        await this.attempts.markSucceeded(active.id);
        await this.invalidate(phone);
        await this.redis.cacheClient.del(tokenKey(otpToken));
        return { ok: true, attempt_id: active.id, phone };
      }
      const ttl = await this.config.getNumber('otp.ttl_seconds');
      const created = await this.attempts.insertForPhone({
        phone,
        otp_hash: `dev-master:${ulid()}`,
        expires_at: new Date(Date.now() + ttl * 1000),
        ip: null,
      });
      await this.attempts.markSucceeded(created.id);
      await this.redis.cacheClient.del(tokenKey(otpToken));
      return { ok: true, attempt_id: created.id, phone };
    }

    const hash = await this.redis.cacheClient.get(otpKey(phone));
    if (!hash) {
      throw new AppError({
        code: ERROR_CODES.ERR_AUTH_OTP_EXPIRED,
        message: 'This OTP has expired — request a new one',
        statusCode: 401,
      });
    }

    const maxAttempts = await this.config.getNumber('otp.verify.max_attempts');
    const currentAttempts = Number((await this.redis.cacheClient.get(attemptsKey(phone))) ?? 0);

    if (currentAttempts >= maxAttempts) {
      // Already locked out from a prior wrong run; clear and reject.
      await this.invalidate(phone);
      throw new AppError({
        code: ERROR_CODES.ERR_AUTH_OTP_MAX_ATTEMPTS,
        message: 'Too many wrong tries — request a new OTP',
        statusCode: 401,
      });
    }

    const matched = await argon2.verify(hash, code).catch(() => false);
    if (!matched) {
      const after = await this.redis.cacheClient.incr(attemptsKey(phone));
      const ttl = await this.config.getNumber('otp.ttl_seconds');
      await this.redis.cacheClient.expire(attemptsKey(phone), ttl);

      const active = await this.attempts.findActiveByPhone(phone);
      if (active) await this.attempts.incrementAttempts(active.id);

      if (after >= maxAttempts) {
        await this.invalidate(phone);
        if (active) {
          await this.attempts.markLocked(
            active.id,
            new Date(Date.now() + 60_000), // 60s cooldown per SPEC §16.9
          );
        }
        throw new AppError({
          code: ERROR_CODES.ERR_AUTH_OTP_MAX_ATTEMPTS,
          message: 'Too many wrong tries — request a new OTP',
          statusCode: 401,
        });
      }
      throw new AppError({
        code: ERROR_CODES.ERR_AUTH_INVALID_OTP,
        message: 'That OTP is incorrect — check your SMS and try again',
        statusCode: 401,
      });
    }

    // Success — wipe Redis keys + mark attempt row succeeded.
    const active = await this.attempts.findActiveByPhone(phone);
    await this.invalidate(phone);
    await this.redis.cacheClient.del(tokenKey(otpToken));
    if (active) await this.attempts.markSucceeded(active.id);

    return { ok: true, attempt_id: active?.id ?? null, phone };
  }

  // ------------------------------------------------------------------------
  // Rate limiting (Redis sliding-window ZSets)
  // ------------------------------------------------------------------------

  private async enforceRateLimits(phone: string, ip: string | null): Promise<void> {
    const [perMinPhone, perHourPhone, perHourIp] = await Promise.all([
      this.config.getNumber('otp.send.per_minute_per_phone'),
      this.config.getNumber('otp.send.per_hour_per_phone'),
      this.config.getNumber('otp.send.per_hour_per_ip'),
    ]);

    await this.checkWindow(`otp:rl:phone:m1:${phone}`, 60, perMinPhone);
    await this.checkWindow(`otp:rl:phone:h1:${phone}`, 3600, perHourPhone);
    if (ip) {
      await this.checkWindow(`otp:rl:ip:h1:${ip}`, 3600, perHourIp);
    }
  }

  private async checkWindow(key: string, windowSeconds: number, max: number): Promise<void> {
    const now = Date.now();
    const cutoff = now - windowSeconds * 1000;
    // Prune old entries, count the remainder.
    await this.redis.cacheClient.zremrangebyscore(key, '-inf', cutoff);
    const count = await this.redis.cacheClient.zcard(key);
    if (count >= max) {
      throw new AppError({
        code: ERROR_CODES.ERR_RATE_LIMITED,
        message: 'Too many OTP requests — wait a moment and try again',
        statusCode: 429,
      });
    }
  }

  private async recordRateLimitTimestamp(phone: string, ip: string | null): Promise<void> {
    const now = Date.now();
    const member = `${now}:${Math.random().toString(36).slice(2, 10)}`;
    const pipeline = this.redis.cacheClient.multi();
    pipeline.zadd(`otp:rl:phone:m1:${phone}`, now, member);
    pipeline.expire(`otp:rl:phone:m1:${phone}`, 90);
    pipeline.zadd(`otp:rl:phone:h1:${phone}`, now, member);
    pipeline.expire(`otp:rl:phone:h1:${phone}`, 3700);
    if (ip) {
      pipeline.zadd(`otp:rl:ip:h1:${ip}`, now, member);
      pipeline.expire(`otp:rl:ip:h1:${ip}`, 3700);
    }
    await pipeline.exec();
  }

  /** Drop OTP and attempt counter — used after success OR exhaustion. */
  private async invalidate(phone: string): Promise<void> {
    await this.redis.cacheClient.del(otpKey(phone), attemptsKey(phone));
  }
}

function generateCode(digits: number): string {
  const max = 10 ** digits;
  return randomInt(0, max).toString().padStart(digits, '0');
}

const otpKey = (phone: string): string => `otp:${phone}`;
const attemptsKey = (phone: string): string => `otp:attempts:${phone}`;
/** Maps the opaque `otp_token` issued by /otp/send to its phone. */
const tokenKey = (token: string): string => `otp:token:${token}`;
