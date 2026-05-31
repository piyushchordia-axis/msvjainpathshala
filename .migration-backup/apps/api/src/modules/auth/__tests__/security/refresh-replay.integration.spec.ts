/**
 * Auth security — refresh-token replay & family-revocation tests (Step 23).
 *
 * The existing `auth.integration.spec.ts#6` covers the happy-path reuse
 * detection. This file goes a level deeper:
 *
 *   1. Replay a revoked refresh token from a different IP — still revoked.
 *   2. Concurrent refresh race — exactly one succeeds (or both fail), but
 *      we never accept both rotations.
 *   3. After reuse detection, ALL refresh tokens in the family die — the
 *      "live" one still in the attacker's hand stops working too.
 */

import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootTestApp, captureOtps, lastOtpFor, makeAgent, nextTestPhone } from '../test-helpers';

import type { INestApplication } from '@nestjs/common';

async function loginFreshSession(app: INestApplication): Promise<{
  refresh: string;
  access: string;
}> {
  const phone = nextTestPhone();
  const agent = makeAgent(app);
  const send = await agent.post('/v1/auth/otp/send').send({ phone });
  const otp_token = send.body.data.otp_token as string;
  const code = lastOtpFor(phone)!;
  const verify = await agent
    .post('/v1/auth/otp/verify')
    .send({ otp_token, code, device: { device_id: 'sec-replay', platform: 'ios' } });
  expect(verify.status).toBe(200);
  return {
    refresh: verify.body.data.tokens.refresh_token,
    access: verify.body.data.tokens.access_token,
  };
}

describe('Auth security — refresh-token replay', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootTestApp();
    await captureOtps(app);
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  it('replaying an old refresh from a different IP still triggers family revoke', async () => {
    const { refresh } = await loginFreshSession(app);
    const agent = makeAgent(app);

    const rot1 = await agent
      .post('/v1/auth/refresh')
      .set('X-Forwarded-For', '203.0.113.10')
      .send({ refresh_token: refresh });
    expect(rot1.status).toBe(200);

    // Same old token from a "different" IP — reuse detection must fire
    // independent of caller origin.
    const replay = await agent
      .post('/v1/auth/refresh')
      .set('X-Forwarded-For', '198.51.100.20')
      .send({ refresh_token: refresh });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('ERR_AUTH_REFRESH_REUSE_DETECTED');
  });

  it('after reuse detection, the rotated (live) token also dies — full family revoke', async () => {
    const { refresh: original } = await loginFreshSession(app);
    const agent = makeAgent(app);

    const rotation = await agent.post('/v1/auth/refresh').send({ refresh_token: original });
    expect(rotation.status).toBe(200);
    const live = rotation.body.data.refresh_token as string;

    // Attacker holds the original, replays it — triggers family revoke.
    const replay = await agent.post('/v1/auth/refresh').send({ refresh_token: original });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('ERR_AUTH_REFRESH_REUSE_DETECTED');

    // The legitimate "live" token from the first rotation must now also fail.
    const live2 = await agent.post('/v1/auth/refresh').send({ refresh_token: live });
    expect(live2.status).toBe(401);
    expect(live2.body.error.code).toMatch(/^ERR_AUTH_/);
  });

  it('concurrent refresh of the same token: only one rotation wins', async () => {
    const { refresh } = await loginFreshSession(app);
    const agent = makeAgent(app);

    const [a, b] = await Promise.all([
      agent.post('/v1/auth/refresh').send({ refresh_token: refresh }),
      agent.post('/v1/auth/refresh').send({ refresh_token: refresh }),
    ]);

    const successes = [a, b].filter((r) => r.status === 200).length;
    // Strict invariant: never both 200. (One success or zero — depending on
    // which race ordering the limiter picks.)
    expect(successes, `${a.status}/${b.status}`).toBeLessThanOrEqual(1);
  });
});
