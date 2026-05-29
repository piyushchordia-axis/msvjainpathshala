/**
 * Auth security — rate-limit bypass probes (Step 23).
 *
 * The OTP rate-limiter is implemented in `auth/services/otp.service.ts`
 * using a Redis sliding-window ZSET. Three known bypass shapes:
 *   1. X-Forwarded-For chain spoof — caller appends fake hops to look like
 *      a different IP per request.
 *   2. Massive request body — caller bloats the body to slow the limiter
 *      path enough that a burst gets through before scoring.
 *   3. IP rotation via the proxy header — same as (1) but tested for
 *      effect on the per-IP cap vs the per-phone cap.
 *
 * Express's `trust proxy` is set to `loopback, linklocal, uniquelocal`
 * (see main.ts) — meaning untrusted Origin → Express ignores XFF and uses
 * the socket peer IP. We assert that contract here: the per-IP key MUST
 * NOT swap based on a forged XFF.
 */

import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RedisService } from '../../../../core/redis/redis.service';
import { SystemConfigService } from '../../../../core/system-config/system-config.service';
import { bootTestApp, makeAgent, nextTestPhone } from '../test-helpers';

import type { INestApplication } from '@nestjs/common';

describe('Auth security — rate-limit bypass attempts', () => {
  let app: INestApplication;
  let redis: RedisService;
  let config: SystemConfigService;

  beforeAll(async () => {
    app = await bootTestApp();
    redis = app.get(RedisService);
    config = app.get(SystemConfigService);
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  it('per-IP cap holds even when X-Forwarded-For is spoofed', async () => {
    await redis.cacheClient.del('otp:rl:ip:h1:127.0.0.1');
    await (config as unknown as { set: (k: string, v: number, by: null) => Promise<void> }).set(
      'otp.send.per_hour_per_ip',
      3,
      null,
    );
    try {
      const agent = makeAgent(app);
      // Burn the cap with three different phones, sending a different fake
      // XFF on each — the limiter must still key on the real peer IP.
      for (let i = 0; i < 3; i++) {
        const r = await agent
          .post('/v1/auth/otp/send')
          .set('X-Forwarded-For', `198.51.100.${i + 1}, 203.0.113.${i + 1}`)
          .send({ phone: nextTestPhone() });
        expect(r.status).toBe(202);
      }
      const breaker = await agent
        .post('/v1/auth/otp/send')
        .set('X-Forwarded-For', '198.51.100.99, 203.0.113.99')
        .send({ phone: nextTestPhone() });
      expect(breaker.status).toBe(429);
      expect(breaker.body.error.code).toBe('ERR_RATE_LIMITED');
    } finally {
      await (config as unknown as { set: (k: string, v: number, by: null) => Promise<void> }).set(
        'otp.send.per_hour_per_ip',
        30,
        null,
      );
      await redis.cacheClient.del('otp:rl:ip:h1:127.0.0.1');
    }
  });

  it('per-phone cap holds against rotating XFF', async () => {
    const phone = nextTestPhone();
    // Pre-clean keys so a noisy preceding test doesn't bleed in.
    await redis.cacheClient.del(`otp:rl:phone:m1:${phone}`);
    await redis.cacheClient.del(`otp:rl:phone:h1:${phone}`);

    const agent = makeAgent(app);
    for (let i = 0; i < 3; i++) {
      const r = await agent
        .post('/v1/auth/otp/send')
        .set('X-Forwarded-For', `198.51.100.${i + 1}`)
        .send({ phone });
      expect(r.status).toBe(202);
    }
    const breaker = await agent
      .post('/v1/auth/otp/send')
      .set('X-Forwarded-For', '198.51.100.99')
      .send({ phone });
    expect(breaker.status).toBe(429);
    expect(breaker.body.error.code).toBe('ERR_RATE_LIMITED');
  });

  it('giant request body cannot smuggle past per-phone cap', async () => {
    const phone = nextTestPhone();
    await redis.cacheClient.del(`otp:rl:phone:m1:${phone}`);
    await redis.cacheClient.del(`otp:rl:phone:h1:${phone}`);

    const agent = makeAgent(app);
    for (let i = 0; i < 3; i++) {
      const r = await agent.post('/v1/auth/otp/send').send({ phone });
      expect(r.status).toBe(202);
    }
    // Same phone with a 100KB string-garnished payload — bigger body is
    // rejected by the JSON body limit OR the cap still holds. Either way
    // 2xx is wrong.
    const noise = 'A'.repeat(100_000);
    const breaker = await agent.post('/v1/auth/otp/send').send({ phone, _noise: noise });
    expect(breaker.status).toBeGreaterThanOrEqual(400);
    expect(breaker.status).toBeLessThan(500);
  });
});
