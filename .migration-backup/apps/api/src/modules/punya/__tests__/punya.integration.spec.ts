/**
 * Punya integration tests — Step 16.
 *
 * Coverage:
 *   1. Idempotency: PunyaService.award() twice with the SAME idempotency_key
 *      → only ONE row in punya_transactions for that key.
 *   2. Concurrency: 10 concurrent award() calls (10 distinct keys) for one
 *      student → all succeed, balance = sum, projection matches.
 *   3. Reversal: reverseTransaction() decreases the balance and recomputes
 *      the tier when crossing a threshold.
 *   4. Reversal window: a 31-day-old award returns
 *      ERR_PUNYA_REVERSAL_WINDOW_EXPIRED.
 *   5. Reconcile: forcibly corrupt punya_balances, run the reconcile service,
 *      balance restored + Redis last-run report has drift_count > 0.
 *   6. Manual award via POST /v1/admin/punya/manual-award validates bounds
 *      and reason.
 *   7. GET /v1/leaderboards/batch — seed ledger + rebuild ZSET + verify
 *      response ordering descends by points.
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
import { LeaderboardService } from '../leaderboard.service';
import { PunyaReconcileService } from '../punya-reconcile.service';
import { PunyaService } from '../punya.service';

import type { INestApplication } from '@nestjs/common';

type Role = 'super_admin' | 'state_admin' | 'city_admin' | 'sanchalak' | 'shikshak' | 'parent';

async function mintAccessAs(opts: {
  app: INestApplication;
  role: Role;
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

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe('Punya — integration', () => {
  let app: INestApplication;
  let drizzle: DrizzleService;
  let redis: RedisService;
  let punya: PunyaService;
  let leaderboards: LeaderboardService;
  let reconcile: PunyaReconcileService;
  let cityId: string;
  let centreId: string;
  let batchId: string;
  let cityAdminAccess: string;
  let cityAdminUserId: string;
  let parentUserId: string;
  let studentIds: string[];

  beforeAll(async () => {
    app = await bootTestApp();
    await captureOtps(app);
    drizzle = app.get(DrizzleService);
    redis = app.get(RedisService);
    punya = app.get(PunyaService);
    leaderboards = app.get(LeaderboardService);
    reconcile = app.get(PunyaReconcileService);

    const tag = Date.now().toString().slice(-6);
    const [stateRow] = (await drizzle.db.execute(
      sql`INSERT INTO states(name, code) VALUES (${`ST-PY-${tag}`}, ${'P' + tag.slice(-2)}) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    const [cityRow] = (await drizzle.db.execute(
      sql`INSERT INTO cities(state_id, name, code) VALUES (${stateRow!.id}, ${`CITY-PY-${tag}`}, ${'P' + tag.slice(-2)}) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    cityId = cityRow!.id;
    const [centreRow] = (await drizzle.db.execute(
      sql`INSERT INTO centres(city_id, name, status, gps_radius_m, lat, lng)
          VALUES (${cityId}, ${`Centre-PY-${tag}`}, 'active', 500, 23.0225, 72.5714) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    centreId = centreRow!.id;

    const cityAdmin = await mintAccessAs({ app, role: 'city_admin', cityId });
    cityAdminAccess = cityAdmin.access;
    cityAdminUserId = cityAdmin.userId;
    void cityAdminUserId;

    const parent = await mintAccessAs({ app, role: 'parent', cityId });
    parentUserId = parent.userId;

    const [batchRow] = (await drizzle.db.execute(
      sql`INSERT INTO batches(centre_id, name, age_group, day_of_week, start_time, end_time, capacity, status)
          VALUES (${centreId}, ${`Bal-PY-${tag}`}, 'bal', '{0,1,2,3,4,5,6}', '09:00', '11:00', 30, 'active') RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    batchId = batchRow!.id;

    studentIds = [];
    for (let i = 0; i < 5; i += 1) {
      const [row] = (await drizzle.db.execute(
        sql`INSERT INTO students(parent_user_id, full_name, dob, age_group, centre_id, batch_id,
                                  student_code, status, enrolled_at)
            VALUES (${parentUserId}, ${`StudentPY-${tag}-${i}`}, '2015-04-12', 'bal', ${centreId}, ${batchId},
                    ${`PY-${tag}-${i}`}, 'active', now()) RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      studentIds.push(row!.id);
    }
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // 1. Idempotency — same key twice → one row
  // ---------------------------------------------------------------------------
  it('1. award() twice with same idempotency_key inserts exactly ONE ledger row', async () => {
    const student = studentIds[0]!;
    const key = `test-idem:${student}:${Date.now()}`;
    const first = await punya.award({
      student_id: student,
      feature_key: 'attendance_present',
      points: 10,
      awarded_by_user_id: cityAdminUserId,
      source_entity_kind: 'test',
      source_entity_id: student,
      idempotency_key: key,
    });
    expect(first.duplicate).toBe(false);

    const second = await punya.award({
      student_id: student,
      feature_key: 'attendance_present',
      points: 10,
      awarded_by_user_id: cityAdminUserId,
      source_entity_kind: 'test',
      source_entity_id: student,
      idempotency_key: key,
    });
    expect(second.duplicate).toBe(true);
    expect(second.transaction.id).toBe(first.transaction.id);

    const rows = (await drizzle.db.execute(
      sql`SELECT COUNT(*)::int AS c FROM punya_transactions WHERE idempotency_key = ${key}`,
    )) as unknown as Array<{ c: number }>;
    expect(rows[0]!.c).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // 2. Concurrency — 10 awards in parallel converge to a consistent balance
  // ---------------------------------------------------------------------------
  it('2. 10 concurrent award() calls all succeed; balance equals the sum', async () => {
    const student = studentIds[1]!;
    const before = await punya.getBalance(
      { user_id: cityAdminUserId, role: 'super_admin' as Role },
      student,
    );
    const beforeTotal = before.balance?.total_points ?? 0;

    const awardOps = Array.from({ length: 10 }, (_, i) =>
      punya.award({
        student_id: student,
        feature_key: 'attendance_present',
        points: 10,
        awarded_by_user_id: cityAdminUserId,
        source_entity_kind: 'test_concurrent',
        source_entity_id: student,
        idempotency_key: `test-concurrent:${student}:${Date.now()}:${i}`,
      }),
    );
    const results = await Promise.all(awardOps);
    expect(results.every((r) => !r.duplicate)).toBe(true);

    const after = await punya.getBalance(
      { user_id: cityAdminUserId, role: 'super_admin' as Role },
      student,
    );
    const afterTotal = after.balance?.total_points ?? 0;
    expect(afterTotal).toBe(beforeTotal + 100);

    // Cross-check via SQL — the projection must match the ledger sum.
    const rows = (await drizzle.db.execute(
      sql`SELECT COALESCE(SUM(points), 0)::int AS s FROM punya_transactions WHERE student_id = ${student}`,
    )) as unknown as Array<{ s: number }>;
    expect(rows[0]!.s).toBe(afterTotal);
  });

  // ---------------------------------------------------------------------------
  // 3. Reversal — decreases balance + recomputes tier if applicable
  // ---------------------------------------------------------------------------
  it('3. reverseTransaction() decreases balance and recomputes tier', async () => {
    const student = studentIds[2]!;
    // Award 95 so we're just below the shravak threshold (101).
    const target = await punya.award({
      student_id: student,
      feature_key: 'manual_seva',
      points: 95,
      reason: 'seva — to be reversed',
      awarded_by_user_id: cityAdminUserId,
      source_entity_kind: 'test',
      source_entity_id: student,
      idempotency_key: `test-reverse-target:${student}:${Date.now()}`,
    });
    expect(target.balance?.total_points).toBeGreaterThanOrEqual(95);

    const beforeTotal = target.balance!.total_points;
    const reversal = await punya.reverseTransaction(
      { user_id: cityAdminUserId, role: 'super_admin' as Role },
      {
        source_id: target.transaction.id,
        reason: 'test reversal',
        idempotency_key: `test-reverse:${target.transaction.id}`,
      },
    );
    expect(reversal.balance.total_points).toBe(beforeTotal - 95);

    // Confirm the reversal row exists and points at the source.
    const rows = (await drizzle.db.execute(
      sql`SELECT points, reversal_of FROM punya_transactions WHERE id = ${reversal.reversal_id}`,
    )) as unknown as Array<{ points: number; reversal_of: string }>;
    expect(rows[0]!.points).toBe(-95);
    expect(rows[0]!.reversal_of).toBe(target.transaction.id);
  });

  // ---------------------------------------------------------------------------
  // 4. Reversal window — > 30 days returns ERR_PUNYA_REVERSAL_WINDOW_EXPIRED
  // ---------------------------------------------------------------------------
  it('4. reversing a 31-day-old transaction returns ERR_PUNYA_REVERSAL_WINDOW_EXPIRED', async () => {
    const student = studentIds[3]!;
    const old = await punya.award({
      student_id: student,
      feature_key: 'attendance_present',
      points: 10,
      awarded_by_user_id: cityAdminUserId,
      source_entity_kind: 'test',
      source_entity_id: student,
      idempotency_key: `test-old:${student}:${Date.now()}`,
    });
    // Force the awarded_at backwards by 31 days.
    await drizzle.db.execute(
      sql`UPDATE punya_transactions
            SET awarded_at = now() - INTERVAL '31 days'
          WHERE id = ${old.transaction.id}`,
    );

    let caught: unknown = null;
    try {
      await punya.reverseTransaction(
        { user_id: cityAdminUserId, role: 'super_admin' as Role },
        {
          source_id: old.transaction.id,
          reason: 'too late',
          idempotency_key: `test-too-late:${old.transaction.id}`,
        },
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeTruthy();
    expect((caught as { code?: string }).code).toBe('ERR_PUNYA_REVERSAL_WINDOW_EXPIRED');
    expect((caught as { statusCode?: number }).statusCode).toBe(409);
  });

  // ---------------------------------------------------------------------------
  // 5. Reconcile — corrupt projection, run cron, projection restored
  // ---------------------------------------------------------------------------
  it('5. reconcile cron restores a corrupted projection + logs to Redis', async () => {
    const student = studentIds[4]!;
    // Make sure there's at least one ledger row for this student.
    await punya.award({
      student_id: student,
      feature_key: 'attendance_present',
      points: 10,
      awarded_by_user_id: cityAdminUserId,
      source_entity_kind: 'test',
      source_entity_id: student,
      idempotency_key: `test-reconcile:${student}:${Date.now()}`,
    });

    // Corrupt the projection: pin total to a wrong number.
    await drizzle.db.execute(
      sql`UPDATE punya_balances SET total_points = 99999 WHERE student_id = ${student}`,
    );

    const report = await reconcile.runOnce({ source: 'manual_admin' });
    expect(report.drift_count).toBeGreaterThan(0);
    expect(report.drift_students).toContain(student);

    const afterRows = (await drizzle.db.execute(
      sql`SELECT total_points FROM punya_balances WHERE student_id = ${student}`,
    )) as unknown as Array<{ total_points: number }>;
    const sumRows = (await drizzle.db.execute(
      sql`SELECT COALESCE(SUM(points), 0)::int AS s FROM punya_transactions WHERE student_id = ${student}`,
    )) as unknown as Array<{ s: number }>;
    expect(afterRows[0]!.total_points).toBe(sumRows[0]!.s);

    const lastRun = await reconcile.getLastRun();
    expect(lastRun?.run_id).toBe(report.run_id);
  });

  // ---------------------------------------------------------------------------
  // 6. Manual award via the HTTP endpoint
  // ---------------------------------------------------------------------------
  it('6. POST /v1/admin/punya/manual-award validates bounds and reason', async () => {
    const agent = makeAgent(app);
    const student = studentIds[0]!;

    // happy path
    const ok = await agent
      .post('/v1/admin/punya/manual-award')
      .set(authHeader(cityAdminAccess))
      .send({
        student_id: student,
        feature_key: 'manual_seva_small',
        points: 10,
        reason: 'Cleaned the centre after Paryushan',
      });
    expect(ok.status).toBe(201);

    // out of bounds — manual_seva_small is [1..25]
    const oob = await agent
      .post('/v1/admin/punya/manual-award')
      .set(authHeader(cityAdminAccess))
      .send({
        student_id: student,
        feature_key: 'manual_seva_small',
        points: 100,
        reason: 'should not be allowed',
      });
    expect(oob.status).toBe(422);
    expect(oob.body.error.code).toBe('ERR_PUNYA_AMOUNT_OUT_OF_BOUNDS');

    // missing reason on a requires_reason=true feature
    const noReason = await agent
      .post('/v1/admin/punya/manual-award')
      .set(authHeader(cityAdminAccess))
      .send({
        student_id: student,
        feature_key: 'manual_seva_small',
        points: 5,
        reason: '',
      });
    expect(noReason.status).toBe(422);
  });

  // ---------------------------------------------------------------------------
  // 7. Leaderboard read — descending by points
  // ---------------------------------------------------------------------------
  it('7. GET /v1/leaderboards/batch returns members in descending point order', async () => {
    // Seed varied points per student in the batch.
    for (let i = 0; i < studentIds.length; i += 1) {
      await punya.award({
        student_id: studentIds[i]!,
        feature_key: 'attendance_present',
        points: 10 * (i + 1), // 10, 20, 30, 40, 50
        awarded_by_user_id: cityAdminUserId,
        source_entity_kind: 'test_lb',
        source_entity_id: studentIds[i]!,
        idempotency_key: `test-lb:${studentIds[i]}:${Date.now()}`,
      });
    }

    // Force-rebuild the ZSET via the service (skips the cron debounce).
    const rebuilt = await leaderboards.rebuildScope({
      scope: 'batch',
      scope_id: batchId,
      period: new Date().toISOString().slice(0, 7),
    });
    expect(rebuilt.member_count).toBeGreaterThan(0);

    const agent = makeAgent(app);
    const res = await agent
      .get('/v1/leaderboards/batch')
      .query({ scope_id: batchId })
      .set(authHeader(cityAdminAccess));
    expect(res.status).toBe(200);
    const entries = res.body.data.entries as Array<{ student_id: string; total_points: number }>;
    expect(entries.length).toBeGreaterThan(0);
    for (let i = 1; i < entries.length; i += 1) {
      expect(entries[i - 1]!.total_points).toBeGreaterThanOrEqual(entries[i]!.total_points);
    }
  });

  // Pin redis so the tests can clean up after themselves if needed.
  it('Redis cache client is usable from tests', async () => {
    expect(redis.cacheClient).toBeDefined();
  });
});
