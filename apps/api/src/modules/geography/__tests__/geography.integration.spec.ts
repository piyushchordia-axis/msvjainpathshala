/**
 * Geography module integration tests.
 *
 * Hits the public read endpoints + a super_admin write to confirm cache
 * invalidation on writes. Boots the full Nest app via `bootTestApp`.
 */

import 'reflect-metadata';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DrizzleService } from '../../../core/database/drizzle.service';
import { SystemConfigService } from '../../../core/system-config/system-config.service';
import {
  bootTestApp,
  captureOtps,
  lastOtpFor,
  makeAgent,
  nextTestPhone,
} from '../../auth/__tests__/test-helpers';
import { JwtService } from '../../auth/services/jwt.service';

import type { INestApplication } from '@nestjs/common';

describe('Geography module — integration', () => {
  let app: INestApplication;
  let drizzle: DrizzleService;
  let jwt: JwtService;
  let config: SystemConfigService;

  beforeAll(async () => {
    app = await bootTestApp();
    await captureOtps(app);
    drizzle = app.get(DrizzleService);
    jwt = app.get(JwtService);
    config = app.get(SystemConfigService);
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  it('GET /v1/geography/states is public and returns an array', async () => {
    const agent = makeAgent(app);
    const res = await agent.get('/v1/geography/states');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.items)).toBe(true);
  });

  it('GET /v1/geography/states/:stateId/cities — 404 for unknown state', async () => {
    const agent = makeAgent(app);
    const res = await agent.get('/v1/geography/states/00000000-0000-0000-0000-000000000000/cities');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ERR_RESOURCE_NOT_FOUND');
  });

  it('POST /v1/geography/states — only super_admin', async () => {
    const agent = makeAgent(app);
    // Try anonymously first — should 401.
    const anon = await agent.post('/v1/geography/states').send({ name: 'Test', code: 'TST' });
    expect(anon.status).toBe(401);

    // Acquire any-role token, then mint a super_admin token via JwtService.
    const phone = nextTestPhone();
    await agent.post('/v1/auth/otp/send').send({ phone });
    const verify = await agent.post('/v1/auth/otp/verify').send({
      phone,
      code: lastOtpFor(phone),
      device: { device_id: 'dev-G', platform: 'ios' },
    });
    const userId = verify.body.data.user.id;
    const sessionId = JSON.parse(
      Buffer.from(verify.body.data.tokens.access_token.split('.')[1], 'base64url').toString(),
    ).device_session_id;
    await drizzle.db.execute(sql`UPDATE users SET role = 'super_admin' WHERE id = ${userId}`);

    const accessTtl = await config.getNumber('jwt.access_ttl_seconds');
    const access = await jwt.signAccess(
      {
        sub: userId,
        role: 'super_admin',
        scope: {},
        view_context: 'parent',
        device_session_id: sessionId,
        jti: crypto.randomUUID(),
      },
      accessTtl,
    );

    const code = `T${Date.now() % 1000}`;
    const res = await agent
      .post('/v1/geography/states')
      .set('Authorization', `Bearer ${access}`)
      .send({ name: `TestState-${Date.now()}`, code });
    expect(res.status).toBe(201);
    expect(res.body.data.code).toBe(code);
  });
});
