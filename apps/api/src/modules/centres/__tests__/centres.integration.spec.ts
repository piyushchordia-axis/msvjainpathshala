/**
 * Centres module integration tests — scope filtering + deactivate guard.
 *
 * Covers the Step 6 prompt's verifications:
 *   • sanchalak's GET /v1/centres returns only assigned centres
 *   • city_admin attempt to deactivate a centre with active batches → 409
 *
 * Boots a real NestJS app (test-helpers from the auth tests reused) against
 * the local Postgres + Redis.
 */

import 'reflect-metadata';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DrizzleService } from '../../../core/database/drizzle.service';
import { RedisService } from '../../../core/redis/redis.service';
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

async function mintAccessAs(opts: {
  app: INestApplication;
  role: 'super_admin' | 'state_admin' | 'city_admin' | 'sanchalak' | 'shikshak' | 'parent';
  cityId?: string;
  centreIds?: string[];
  batchIds?: string[];
}): Promise<{ access: string; userId: string }> {
  const { app, role } = opts;
  const drizzle = app.get(DrizzleService);
  const jwt = app.get(JwtService);
  const config = app.get(SystemConfigService);

  const phone = nextTestPhone();
  const agent = makeAgent(app);
  const send = await agent.post('/v1/auth/otp/send').send({ phone });
  const otp_token = send.body.data.otp_token;
  const verify = await agent.post('/v1/auth/otp/verify').send({
    otp_token,
    code: lastOtpFor(phone),
    device: { device_id: `dev-${role}-${Date.now()}`, platform: 'ios' },
  });
  const userId = verify.body.data.user.id;
  const sessionId = JSON.parse(
    Buffer.from(verify.body.data.tokens.access_token.split('.')[1], 'base64url').toString(),
  ).device_session_id;

  await drizzle.db.execute(sql`UPDATE users SET role = ${role} WHERE id = ${userId}`);
  const accessTtl = await config.getNumber('jwt.access_ttl_seconds');
  const scope: { city_id?: string; centre_ids?: string[]; batch_ids?: string[] } = {};
  if (opts.cityId) scope.city_id = opts.cityId;
  if (opts.centreIds) scope.centre_ids = opts.centreIds;
  if (opts.batchIds) scope.batch_ids = opts.batchIds;
  const access = await jwt.signAccess(
    {
      sub: userId,
      role,
      scope,
      view_context: 'parent',
      device_session_id: sessionId,
      jti: crypto.randomUUID(),
    },
    accessTtl,
  );
  return { access, userId };
}

describe('Centres module — integration', () => {
  let app: INestApplication;
  let drizzle: DrizzleService;
  let cityId: string;
  let centreA: string;
  let centreB: string;
  let batchInCentreA: string;

  beforeAll(async () => {
    app = await bootTestApp();
    await captureOtps(app);
    drizzle = app.get(DrizzleService);

    // Build dedicated test geography so we're isolated from seed/run state.
    const tag = Date.now();
    const stateRow = (
      await drizzle.db.execute(
        sql`INSERT INTO states (name, code) VALUES (${`State-${tag}`}, ${`S${tag % 1000}`}) RETURNING id`,
      )
    )[0] as { id: string };
    const cityRow = (
      await drizzle.db.execute(
        sql`INSERT INTO cities (state_id, name, code) VALUES (${stateRow.id}, ${`City-${tag}`}, ${`C${tag % 1000}`}) RETURNING id`,
      )
    )[0] as { id: string };
    cityId = cityRow.id;
    const ca = (
      await drizzle.db.execute(
        sql`INSERT INTO centres (city_id, name, status, gps_radius_m) VALUES (${cityId}, ${`Centre-A-${tag}`}, 'active', 500) RETURNING id`,
      )
    )[0] as { id: string };
    const cb = (
      await drizzle.db.execute(
        sql`INSERT INTO centres (city_id, name, status, gps_radius_m) VALUES (${cityId}, ${`Centre-B-${tag}`}, 'active', 500) RETURNING id`,
      )
    )[0] as { id: string };
    centreA = ca.id;
    centreB = cb.id;
    const ba = (
      await drizzle.db.execute(sql`
        INSERT INTO batches (centre_id, name, day_of_week, start_time, end_time, age_group, status, capacity)
        VALUES (${centreA}, ${`Batch-A-${tag}`}, ARRAY[1,3,5]::int[], '16:00'::time, '17:30'::time, 'bal', 'active', 30)
        RETURNING id
      `)
    )[0] as { id: string };
    batchInCentreA = ba.id;

    // Bust the centre list cache so the scoped tests see fresh data.
    const redis = app.get(RedisService);
    const stream = redis.cacheClient.scanStream({ match: 'cache:centres:*', count: 100 });
    for await (const keys of stream as unknown as AsyncIterable<string[]>) {
      if (keys.length > 0) await redis.cacheClient.del(...keys);
    }
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  it('sanchalak sees ONLY their assigned centres', async () => {
    // Mint a sanchalak token with centre_ids scoped to centreA only.
    const { access, userId } = await mintAccessAs({
      app,
      role: 'sanchalak',
      centreIds: [centreA],
    });
    // Also persist the link table row so cache invalidation tests work.
    await drizzle.db.execute(sql`
      INSERT INTO sanchalak_centre_assignments (sanchalak_user_id, centre_id, assigned_at)
      VALUES (${userId}, ${centreA}, now())
    `);

    const res = await makeAgent(app).get('/v1/centres').set('Authorization', `Bearer ${access}`);
    expect(res.status).toBe(200);
    const ids: string[] = res.body.data.items.map((c: { id: string }) => c.id);
    expect(ids).toContain(centreA);
    expect(ids).not.toContain(centreB);
  });

  it('city_admin deactivate-with-active-batches → 409', async () => {
    const { access } = await mintAccessAs({
      app,
      role: 'city_admin',
      cityId,
    });

    // Cache may still hold the centreA detail from earlier scope check; bust it.
    const redis = app.get(RedisService);
    await redis.cacheClient.del(`cache:centres:detail:${centreA}`);

    const res = await makeAgent(app)
      .post(`/v1/centres/${centreA}/deactivate`)
      .set('Authorization', `Bearer ${access}`)
      .send();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ERR_CONFLICT_STATE_TRANSITION');
    // Centre should still be active.
    const [row] = await drizzle.dbRead.execute(
      sql`SELECT status FROM centres WHERE id = ${centreA}`,
    );
    expect((row as { status: string }).status).toBe('active');
    // Suppress unused-var warning for the auxiliary batch we created.
    expect(batchInCentreA).toMatch(/^[0-9a-f-]{36}$/);
  });
});
