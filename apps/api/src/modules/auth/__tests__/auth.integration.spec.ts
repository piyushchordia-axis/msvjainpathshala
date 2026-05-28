/**
 * Auth module integration tests (9 scenarios per the Step 5 prompt).
 *
 * Boots a real NestJS app against the local Postgres + Redis (CI / prod
 * mirror swaps these for Testcontainers via JP_TEST_DB_URL / JP_TEST_REDIS_URL
 * in `vitest.integration.config.ts`). The SMS provider is patched to capture
 * OTPs in-memory so we don't depend on Pino-pretty stdout buffering.
 */

import 'reflect-metadata';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DrizzleService } from '../../../core/database/drizzle.service';
import { RedisService } from '../../../core/redis/redis.service';
import { SystemConfigService } from '../../../core/system-config/system-config.service';

import { bootTestApp, captureOtps, lastOtpFor, makeAgent, nextTestPhone } from './test-helpers';

import type { INestApplication } from '@nestjs/common';

describe('Auth module — integration', () => {
  let app: INestApplication;
  let redis: RedisService;
  let drizzle: DrizzleService;
  let config: SystemConfigService;

  beforeAll(async () => {
    app = await bootTestApp();
    await captureOtps(app);
    redis = app.get(RedisService);
    drizzle = app.get(DrizzleService);
    config = app.get(SystemConfigService);
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  // 1 — OTP send → verify happy path issues both tokens
  it('1. OTP send → verify happy path issues access + refresh tokens', async () => {
    const phone = nextTestPhone();
    const agent = makeAgent(app);
    const send = await agent.post('/v1/auth/otp/send').send({ phone });
    expect(send.status).toBe(202);
    const code = lastOtpFor(phone);
    expect(code).toMatch(/^\d{6}$/);

    const verify = await agent
      .post('/v1/auth/otp/verify')
      .send({ phone, code, device: { device_id: 'dev-A', platform: 'ios' } });
    expect(verify.status).toBe(200);
    expect(verify.body.data.tokens.access_token).toMatch(/^eyJ/);
    expect(verify.body.data.tokens.refresh_token).toMatch(/^eyJ/);
    expect(verify.body.data.user.phone).toBe(phone);
  });

  // 2 — Expired OTP
  it('2. Expired OTP returns ERR_AUTH_OTP_EXPIRED', async () => {
    const phone = nextTestPhone();
    const agent = makeAgent(app);
    await agent.post('/v1/auth/otp/send').send({ phone });
    const code = lastOtpFor(phone)!;
    // Manually expire the Redis key.
    await redis.cacheClient.del(`otp:${phone}`);
    const verify = await agent
      .post('/v1/auth/otp/verify')
      .send({ phone, code, device: { device_id: 'dev-A', platform: 'ios' } });
    expect(verify.status).toBe(401);
    expect(verify.body.error.code).toBe('ERR_AUTH_OTP_EXPIRED');
  });

  // 3 — Wrong code × 3 → max attempts, key purged
  it('3. Wrong code 3 times → ERR_AUTH_OTP_MAX_ATTEMPTS, OTP key purged', async () => {
    const phone = nextTestPhone();
    const agent = makeAgent(app);
    await agent.post('/v1/auth/otp/send').send({ phone });
    expect(await redis.cacheClient.get(`otp:${phone}`)).not.toBeNull();
    for (let i = 0; i < 2; i++) {
      const r = await agent
        .post('/v1/auth/otp/verify')
        .send({ phone, code: '000000', device: { device_id: 'd', platform: 'ios' } });
      expect(r.status).toBe(401);
      expect(r.body.error.code).toBe('ERR_AUTH_INVALID_OTP');
    }
    const r3 = await agent
      .post('/v1/auth/otp/verify')
      .send({ phone, code: '000000', device: { device_id: 'd', platform: 'ios' } });
    expect(r3.status).toBe(401);
    expect(r3.body.error.code).toBe('ERR_AUTH_OTP_MAX_ATTEMPTS');
    expect(await redis.cacheClient.get(`otp:${phone}`)).toBeNull();
  });

  // 4 — Per-phone 3/min rate limit
  it('4. Per-phone rate limit (3/min) returns ERR_RATE_LIMITED', async () => {
    const phone = nextTestPhone();
    const agent = makeAgent(app);
    // The default is 3/min; the 4th send within a minute trips the limit.
    for (let i = 0; i < 3; i++) {
      const r = await agent.post('/v1/auth/otp/send').send({ phone });
      expect(r.status).toBe(202);
    }
    const fourth = await agent.post('/v1/auth/otp/send').send({ phone });
    expect(fourth.status).toBe(429);
    expect(fourth.body.error.code).toBe('ERR_RATE_LIMITED');
  });

  // 5 — Per-IP 30/hr rate limit (NEW — Step 5 prompt addition)
  it('5. Per-IP rate limit (lowered) returns ERR_RATE_LIMITED', async () => {
    // Clear the per-IP rate-limit ZSet so prior test sends don't pollute.
    // Tests run via supertest from 127.0.0.1, so the key is `otp:rl:ip:h1:127.0.0.1`.
    await redis.cacheClient.del('otp:rl:ip:h1:127.0.0.1');
    // Lower the configured per-hour-IP cap so the test is fast.
    await (config as unknown as { set: (k: string, v: number, by: null) => Promise<void> }).set(
      'otp.send.per_hour_per_ip',
      5,
      null,
    );
    try {
      const agent = makeAgent(app);
      // Use different phones so the per-phone limit doesn't trip first.
      for (let i = 0; i < 5; i++) {
        const r = await agent.post('/v1/auth/otp/send').send({ phone: nextTestPhone() });
        expect(r.status).toBe(202);
      }
      const sixth = await agent.post('/v1/auth/otp/send').send({ phone: nextTestPhone() });
      expect(sixth.status).toBe(429);
      expect(sixth.body.error.code).toBe('ERR_RATE_LIMITED');
    } finally {
      await (config as unknown as { set: (k: string, v: number, by: null) => Promise<void> }).set(
        'otp.send.per_hour_per_ip',
        30,
        null,
      );
      await redis.cacheClient.del('otp:rl:ip:h1:127.0.0.1');
    }
  });

  // 6 — Refresh rotation + reuse detection
  it('6. Refresh rotates; replay of old token returns ERR_AUTH_REFRESH_REUSE_DETECTED', async () => {
    const phone = nextTestPhone();
    const agent = makeAgent(app);
    await agent.post('/v1/auth/otp/send').send({ phone });
    const code = lastOtpFor(phone)!;
    const verify = await agent
      .post('/v1/auth/otp/verify')
      .send({ phone, code, device: { device_id: 'dev-A', platform: 'ios' } });
    expect(verify.status).toBe(200);
    const oldRefresh = verify.body.data.tokens.refresh_token;

    const rot1 = await agent.post('/v1/auth/refresh').send({ refresh_token: oldRefresh });
    expect(rot1.status).toBe(200);
    expect(rot1.body.data.refresh_token).not.toBe(oldRefresh);

    const reuse = await agent.post('/v1/auth/refresh').send({ refresh_token: oldRefresh });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('ERR_AUTH_REFRESH_REUSE_DETECTED');
  });

  // 7 — 6th device revokes oldest
  it('7. 6th login for the same user revokes the oldest device session', async () => {
    const phone = nextTestPhone();
    const agent = makeAgent(app);

    const loginAndReturnSessionId = async (deviceId: string): Promise<string> => {
      // Clear per-phone rate-limit ZSets so 6 logins in a row don't trip 3/min.
      await redis.cacheClient.del(`otp:rl:phone:m1:${phone}`);
      await redis.cacheClient.del(`otp:rl:phone:h1:${phone}`);
      await agent.post('/v1/auth/otp/send').send({ phone });
      const code = lastOtpFor(phone);
      if (!code) throw new Error(`No OTP captured for ${phone}`);
      const r = await agent
        .post('/v1/auth/otp/verify')
        .send({ phone, code, device: { device_id: deviceId, platform: 'ios' } });
      if (!r.body.data?.tokens) {
        throw new Error(`verify failed (status=${r.status}): ${JSON.stringify(r.body)}`);
      }
      const payload = JSON.parse(
        Buffer.from(r.body.data.tokens.access_token.split('.')[1], 'base64url').toString(),
      );
      return payload.device_session_id;
    };

    const firstSessionId = await loginAndReturnSessionId('dev-1');
    for (let i = 2; i <= 6; i++) {
      await loginAndReturnSessionId(`dev-${i}`);
    }
    const rows = await drizzle.dbRead.execute(
      sql`SELECT revoked_at FROM device_sessions WHERE id = ${firstSessionId}`,
    );
    const row = (rows as unknown as Array<{ revoked_at: unknown }>)[0];
    if (!row) throw new Error('expected device_session row to exist');
    expect(row.revoked_at).not.toBeNull();
  });

  // 8 — Student-view 13+ hard gate
  it('8. Student-view toggle blocked for a student under 13 (CLAUDE.md Q4)', async () => {
    const { JwtService } = await import('../services/jwt.service');
    const jwt = app.get(JwtService);

    const phone = nextTestPhone();
    const agent = makeAgent(app);
    await agent.post('/v1/auth/otp/send').send({ phone });
    const code = lastOtpFor(phone)!;
    const verify = await agent
      .post('/v1/auth/otp/verify')
      .send({ phone, code, device: { device_id: 'dev-A', platform: 'ios' } });
    const userId = verify.body.data.user.id;
    const sessionId = JSON.parse(
      Buffer.from(verify.body.data.tokens.access_token.split('.')[1], 'base64url').toString(),
    ).device_session_id;

    // Promote user to 'parent' in DB and mint a fresh access token reflecting
    // the new role (the access token from verify still carries 'guest').
    await drizzle.db.execute(sql`UPDATE users SET role = 'parent' WHERE id = ${userId}`);
    const accessTtl = await config.getNumber('jwt.access_ttl_seconds');
    const access = await jwt.signAccess(
      {
        sub: userId,
        role: 'parent',
        scope: {},
        view_context: 'parent',
        device_session_id: sessionId,
        jti: crypto.randomUUID(),
      },
      accessTtl,
    );
    const [city] = await drizzle.db.execute(sql`
      INSERT INTO states(name, code) VALUES ('Test', 'TS') RETURNING id
    `);
    const [cityRow] = await drizzle.db.execute(sql`
      INSERT INTO cities(state_id, name, code) VALUES (${(city as { id: string }).id}, 'Testville', 'TV') RETURNING id
    `);
    const [centre] = await drizzle.db.execute(sql`
      INSERT INTO centres(city_id, name, status) VALUES (${(cityRow as { id: string }).id}, 'C1', 'active') RETURNING id
    `);
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 12); // 12 years old
    const dobStr = dob.toISOString().slice(0, 10);
    const [student] = await drizzle.db.execute(sql`
      INSERT INTO students(parent_user_id, full_name, dob, age_group, centre_id,
                           student_code, enrolled_at, student_view_enabled)
      VALUES (${userId}, 'Test Child', ${dobStr}, 'bal', ${(centre as { id: string }).id},
              ${'STU-' + Date.now()}, now(), true)
      RETURNING id
    `);

    const sw = await agent
      .post('/v1/auth/switch-view')
      .set('Authorization', `Bearer ${access}`)
      .send({ view_context: 'student', student_id: (student as { id: string }).id });
    expect(sw.status).toBe(409);
    expect(sw.body.error.code).toBe('ERR_AUTH_STUDENT_VIEW_UNDERAGE');
  });

  // 9a — JWT signature mismatch (NEW — Step 5 prompt addition)
  it('9a. JWT with bad signature returns ERR_AUTH_TOKEN_INVALID', async () => {
    const agent = makeAgent(app);
    const me = await agent
      .get('/v1/auth/me')
      .set('Authorization', 'Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJoYWNrIn0.invalidsig');
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe('ERR_AUTH_TOKEN_INVALID');
  });

  // 9b — Admin impersonation creates two audit entries
  it('9b. Admin impersonation creates two audit entries', async () => {
    const { JwtService } = await import('../services/jwt.service');
    const jwt = app.get(JwtService);

    // Set up two users via the API + promote the actor to super_admin in the DB.
    const targetPhone = nextTestPhone();
    const actorPhone = nextTestPhone();
    const agent = makeAgent(app);
    await agent.post('/v1/auth/otp/send').send({ phone: targetPhone });
    const targetVerify = await agent.post('/v1/auth/otp/verify').send({
      phone: targetPhone,
      code: lastOtpFor(targetPhone),
      device: { device_id: 'dev-T', platform: 'ios' },
    });
    const targetUserId = targetVerify.body.data.user.id;

    await agent.post('/v1/auth/otp/send').send({ phone: actorPhone });
    const actorVerify = await agent.post('/v1/auth/otp/verify').send({
      phone: actorPhone,
      code: lastOtpFor(actorPhone),
      device: { device_id: 'dev-A', platform: 'ios' },
    });
    const actorUserId = actorVerify.body.data.user.id;
    const actorSessionId = JSON.parse(
      Buffer.from(actorVerify.body.data.tokens.access_token.split('.')[1], 'base64url').toString(),
    ).device_session_id;

    await drizzle.db.execute(sql`UPDATE users SET role = 'super_admin' WHERE id = ${actorUserId}`);

    // Mint a fresh access token reflecting super_admin role.
    const accessTtl = await config.getNumber('jwt.access_ttl_seconds');
    const superAccess = await jwt.signAccess(
      {
        sub: actorUserId,
        role: 'super_admin',
        scope: {},
        view_context: 'parent',
        device_session_id: actorSessionId,
        jti: crypto.randomUUID(),
      },
      accessTtl,
    );

    const resp = await agent
      .post(`/v1/admin/impersonate/${targetUserId}`)
      .set('Authorization', `Bearer ${superAccess}`)
      .send({ reason: 'integration-test' });
    expect(resp.status).toBe(200);
    expect(resp.body.data.access_token).toMatch(/^eyJ/);

    // Two audit entries: actor side + subject side, both with the same target id.
    const rows = await drizzle.dbRead.execute(
      sql`SELECT entity_id, after->>'event_kind' AS event_kind
          FROM audit_logs
          WHERE entity_id = ${targetUserId}
            AND after->>'event_kind' IN ('auth.impersonation.started', 'auth.impersonation.subject_recorded')`,
    );
    const events = (rows as unknown as Array<{ event_kind: string }>).map((r) => r.event_kind);
    expect(events).toContain('auth.impersonation.started');
    expect(events).toContain('auth.impersonation.subject_recorded');
  });
});

// Test-local helpers are inlined in each `it(...)` block where they help —
// keeps the boundaries between scenarios obvious.
