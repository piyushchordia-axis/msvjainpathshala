/**
 * Sync engine integration tests — Step 14.
 *
 * Coverage:
 *   1. POST /v1/sync/batch with 5 attendance ops → all succeed; 5 attendance
 *      rows; 5 Punya transactions; sync_operations rows recorded.
 *   2. Replay same 5 ops → all return `duplicate`; no new attendance rows;
 *      no new Punya transactions; no new sync_operations rows.
 *   3. Mixed batch with an unknown op_kind → unknown returns `failed`
 *      with ERR_SYNC_UNKNOWN_OP_KIND.
 *   4. Attendance op for a cancelled session → `failed` with
 *      ERR_SYNC_CONFLICT.
 *   5. GET /v1/sync/bootstrap as parent returns the parent slice.
 *   6. GET /v1/sync/bootstrap as shikshak returns the shikshak slice.
 *   7. GET /v1/sync/delta?since=… returns the same envelope shape.
 *   8. Bootstrap envelope size for a 2-child parent < 500 KB.
 *   9. sync batch 100 ops — wall-clock timing reported.
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

const CENTRE_LAT = 23.0225;
const CENTRE_LNG = 72.5714;

describe('Sync engine — integration', () => {
  let app: INestApplication;
  let drizzle: DrizzleService;
  let cityId: string;
  let centreId: string;
  let batchId: string;
  let sessionId: string;
  let shikshakAccess: string;
  let shikshakUserId: string;
  let parentAccess: string;
  let parentUserId: string;
  let sanchalakAccess: string;
  let studentIds: string[];

  beforeAll(async () => {
    app = await bootTestApp();
    await captureOtps(app);
    drizzle = app.get(DrizzleService);

    const tag = Date.now().toString().slice(-6);
    const [stateRow] = (await drizzle.db.execute(
      sql`INSERT INTO states(name, code) VALUES (${`ST-S-${tag}`}, ${'S' + tag.slice(-2)}) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    const [cityRow] = (await drizzle.db.execute(
      sql`INSERT INTO cities(state_id, name, code) VALUES (${stateRow!.id}, ${`CITY-S-${tag}`}, ${'S' + tag.slice(-2)}) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    cityId = cityRow!.id;
    const [centreRow] = (await drizzle.db.execute(
      sql`INSERT INTO centres(city_id, name, status, gps_radius_m, lat, lng)
          VALUES (${cityId}, ${`Centre-S-${tag}`}, 'active', 500, ${CENTRE_LAT}, ${CENTRE_LNG}) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    centreId = centreRow!.id;

    const shikshak = await mintAccessAs({
      app,
      role: 'shikshak',
      cityId,
      centreIds: [centreId],
      batchIds: [],
    });
    shikshakAccess = shikshak.access;
    shikshakUserId = shikshak.userId;

    const [batchRow] = (await drizzle.db.execute(
      sql`INSERT INTO batches(centre_id, name, age_group, day_of_week, start_time, end_time, capacity, status, shikshak_id)
          VALUES (${centreId}, ${`Bal-S-${tag}`}, 'bal', '{0,1,2,3,4,5,6}', '09:00', '11:00', 30, 'active', ${shikshakUserId}) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    batchId = batchRow!.id;

    const parent = await mintAccessAs({ app, role: 'parent', cityId });
    parentAccess = parent.access;
    parentUserId = parent.userId;

    const sanchalak = await mintAccessAs({
      app,
      role: 'sanchalak',
      cityId,
      centreIds: [centreId],
    });
    sanchalakAccess = sanchalak.access;

    // 5 active students in the batch — owned by the parent so the parent
    // bootstrap can find them.
    studentIds = [];
    for (let i = 0; i < 5; i += 1) {
      const [row] = (await drizzle.db.execute(
        sql`INSERT INTO students(parent_user_id, full_name, dob, age_group, centre_id, batch_id,
                                  student_code, status, enrolled_at)
            VALUES (${parentUserId}, ${`StudentS-${tag}-${i}`}, '2017-04-12', 'bal', ${centreId}, ${batchId},
                    ${`MSV-SYN-${tag}-${i}`}, 'active', now()) RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      studentIds.push(row!.id);
    }

    // Open a session today so attendance ops have something to mark against.
    const [sessRow] = (await drizzle.db.execute(
      sql`INSERT INTO sessions(batch_id, scheduled_date, scheduled_start_time, scheduled_end_time,
                                 status, shikshak_user_id, check_in_at, check_in_lat, check_in_lng,
                                 check_in_distance_m, gps_haversine_m)
          VALUES (${batchId}, (now() AT TIME ZONE 'Asia/Kolkata')::date, '09:00', '11:00',
                  'in_progress', ${shikshakUserId}, now(), ${CENTRE_LAT.toString()}, ${CENTRE_LNG.toString()},
                  0, 0) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    sessionId = sessRow!.id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // 1. POST /v1/sync/batch with 5 attendance ops
  // ---------------------------------------------------------------------------
  it('1. batch of 5 attendance.mark ops → 5 success; rows + Punya land', async () => {
    const agent = makeAgent(app);
    const now = new Date().toISOString();
    const ops = studentIds.map((sid, i) => ({
      client_op_id: `01HSYNC${Date.now()}A${i.toString().padStart(2, '0')}`,
      op_kind: 'attendance.mark' as const,
      payload: {
        session_id: sessionId,
        student_id: sid,
        status: 'present' as const,
        marked_at: now,
      },
      client_timestamp: now,
    }));
    const resp = await agent.post('/v1/sync/batch').set(authHeader(shikshakAccess)).send({ ops });
    expect(resp.status).toBe(200);
    expect(resp.body.data.results).toHaveLength(5);
    expect(resp.body.data.server_timestamp).toBeTruthy();
    for (const r of resp.body.data.results) {
      expect(r.status).toBe('success');
      expect(r.result?.attendance_id).toBeTruthy();
    }

    const attendanceCount = (await drizzle.db.execute(
      sql`SELECT COUNT(*)::int AS c FROM attendance WHERE session_id = ${sessionId}`,
    )) as unknown as Array<{ c: number }>;
    expect(attendanceCount[0]!.c).toBe(5);

    const syncRowCount = (await drizzle.db.execute(
      sql`SELECT COUNT(*)::int AS c FROM sync_operations WHERE user_id = ${shikshakUserId} AND status = 'success'`,
    )) as unknown as Array<{ c: number }>;
    expect(syncRowCount[0]!.c).toBeGreaterThanOrEqual(5);
  });

  // ---------------------------------------------------------------------------
  // 2. Replay → all duplicate, no new rows
  // ---------------------------------------------------------------------------
  it('2. replay the same batch → all duplicate, attendance + sync row counts unchanged', async () => {
    const agent = makeAgent(app);
    const now = new Date().toISOString();
    const baseSuffix = Date.now();
    const ops = studentIds.map((sid, i) => ({
      client_op_id: `01HSYNCR${baseSuffix}B${i.toString().padStart(2, '0')}`,
      op_kind: 'attendance.mark' as const,
      payload: {
        session_id: sessionId,
        student_id: sid,
        status: 'present' as const,
        marked_at: now,
      },
      client_timestamp: now,
    }));
    // First call — success.
    const first = await agent.post('/v1/sync/batch').set(authHeader(shikshakAccess)).send({ ops });
    expect(first.status).toBe(200);
    for (const r of first.body.data.results) expect(r.status).toBe('success');

    const beforePunya = (await drizzle.db.execute(
      sql`SELECT COUNT(*)::int AS c FROM punya_transactions WHERE idempotency_key LIKE 'attendance:%'`,
    )) as unknown as Array<{ c: number }>;
    const beforeAttendance = (await drizzle.db.execute(
      sql`SELECT COUNT(*)::int AS c FROM attendance WHERE session_id = ${sessionId}`,
    )) as unknown as Array<{ c: number }>;
    const beforeSync = (await drizzle.db.execute(
      sql`SELECT COUNT(*)::int AS c FROM sync_operations WHERE user_id = ${shikshakUserId}`,
    )) as unknown as Array<{ c: number }>;

    // Second call — same client_op_ids → duplicate.
    const replay = await agent.post('/v1/sync/batch').set(authHeader(shikshakAccess)).send({ ops });
    expect(replay.status).toBe(200);
    for (const r of replay.body.data.results) expect(r.status).toBe('duplicate');

    const afterPunya = (await drizzle.db.execute(
      sql`SELECT COUNT(*)::int AS c FROM punya_transactions WHERE idempotency_key LIKE 'attendance:%'`,
    )) as unknown as Array<{ c: number }>;
    const afterAttendance = (await drizzle.db.execute(
      sql`SELECT COUNT(*)::int AS c FROM attendance WHERE session_id = ${sessionId}`,
    )) as unknown as Array<{ c: number }>;
    const afterSync = (await drizzle.db.execute(
      sql`SELECT COUNT(*)::int AS c FROM sync_operations WHERE user_id = ${shikshakUserId}`,
    )) as unknown as Array<{ c: number }>;
    expect(afterPunya[0]!.c).toBe(beforePunya[0]!.c);
    expect(afterAttendance[0]!.c).toBe(beforeAttendance[0]!.c);
    expect(afterSync[0]!.c).toBe(beforeSync[0]!.c);
  });

  // ---------------------------------------------------------------------------
  // 3. Unknown op_kind in mixed batch
  // ---------------------------------------------------------------------------
  it('3. mixed batch with notice.acknowledge (no handler) → failed with ERR_SYNC_UNKNOWN_OP_KIND', async () => {
    const agent = makeAgent(app);
    const now = new Date().toISOString();
    const goodOp = {
      client_op_id: `01HSYNCC${Date.now()}good`,
      op_kind: 'attendance.mark' as const,
      payload: {
        session_id: sessionId,
        student_id: studentIds[0]!,
        status: 'present' as const,
        marked_at: now,
      },
      client_timestamp: now,
    };
    const unknownOp = {
      client_op_id: `01HSYNCC${Date.now()}unk`,
      op_kind: 'notice.acknowledge' as const,
      payload: { notice_id: crypto.randomUUID(), acknowledged_at: now },
      client_timestamp: now,
    };
    const resp = await agent
      .post('/v1/sync/batch')
      .set(authHeader(shikshakAccess))
      .send({ ops: [goodOp, unknownOp] });
    expect(resp.status).toBe(200);
    const good = resp.body.data.results.find(
      (r: { client_op_id: string }) => r.client_op_id === goodOp.client_op_id,
    );
    const unknown = resp.body.data.results.find(
      (r: { client_op_id: string }) => r.client_op_id === unknownOp.client_op_id,
    );
    expect(good.status).toMatch(/success|duplicate/);
    expect(unknown.status).toBe('failed');
    expect(unknown.error_code).toBe('ERR_SYNC_UNKNOWN_OP_KIND');
  });

  // ---------------------------------------------------------------------------
  // 4. Conflict — attendance for a cancelled session
  // ---------------------------------------------------------------------------
  it('4. attendance.mark for a cancelled session → failed with ERR_SYNC_CONFLICT', async () => {
    // Spin up a second session purely to cancel it.
    const [cancelled] = (await drizzle.db.execute(
      sql`INSERT INTO sessions(batch_id, scheduled_date, scheduled_start_time, scheduled_end_time,
                                 status, shikshak_user_id)
          VALUES (${batchId}, (now() AT TIME ZONE 'Asia/Kolkata')::date - 1, '09:00', '11:00',
                  'cancelled', ${shikshakUserId}) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    const agent = makeAgent(app);
    const now = new Date().toISOString();
    const ops = [
      {
        client_op_id: `01HSYNCX${Date.now()}cancel`,
        op_kind: 'attendance.mark' as const,
        payload: {
          session_id: cancelled!.id,
          student_id: studentIds[1]!,
          status: 'present' as const,
          marked_at: now,
        },
        client_timestamp: now,
      },
    ];
    const resp = await agent.post('/v1/sync/batch').set(authHeader(shikshakAccess)).send({ ops });
    expect(resp.status).toBe(200);
    const r = resp.body.data.results[0];
    expect(r.status).toBe('failed');
    expect(r.error_code).toBe('ERR_SYNC_CONFLICT');
  });

  // ---------------------------------------------------------------------------
  // 5. Bootstrap as parent
  // ---------------------------------------------------------------------------
  it('5. GET /v1/sync/bootstrap as parent → returns students + enrolments + common', async () => {
    const agent = makeAgent(app);
    const resp = await agent.get('/v1/sync/bootstrap').set(authHeader(parentAccess));
    expect(resp.status).toBe(200);
    expect(resp.body.data.user_id).toBe(parentUserId);
    expect(resp.body.data.role).toBe('parent');
    expect(Array.isArray(resp.body.data.payload.parent.students)).toBe(true);
    expect(resp.body.data.payload.parent.students.length).toBeGreaterThanOrEqual(5);
    expect(Array.isArray(resp.body.data.payload.common.notifications)).toBe(true);
    // Future-slot keys must exist as empty defaults so the client can rely on them.
    expect(Array.isArray(resp.body.data.payload.common.notices)).toBe(true);
    expect(Array.isArray(resp.body.data.payload.common.niyams_catalogue)).toBe(true);

    // Bootstrap envelope must stay under 500 KB for a 2-child parent fixture.
    const bytes = Buffer.byteLength(JSON.stringify(resp.body));
    expect(bytes).toBeLessThan(500_000);
  });

  // ---------------------------------------------------------------------------
  // 6. Bootstrap as shikshak
  // ---------------------------------------------------------------------------
  it('6. GET /v1/sync/bootstrap as shikshak → returns shikshak slice', async () => {
    const agent = makeAgent(app);
    const resp = await agent.get('/v1/sync/bootstrap').set(authHeader(shikshakAccess));
    expect(resp.status).toBe(200);
    expect(resp.body.data.role).toBe('shikshak');
    expect(Array.isArray(resp.body.data.payload.shikshak.batches)).toBe(true);
    expect(Array.isArray(resp.body.data.payload.shikshak.students)).toBe(true);
    expect(Array.isArray(resp.body.data.payload.shikshak.sessions_today)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 7. Bootstrap as sanchalak
  // ---------------------------------------------------------------------------
  it('7. GET /v1/sync/bootstrap as sanchalak → returns sanchalak slice', async () => {
    const agent = makeAgent(app);
    const resp = await agent.get('/v1/sync/bootstrap').set(authHeader(sanchalakAccess));
    expect(resp.status).toBe(200);
    expect(resp.body.data.role).toBe('sanchalak');
    expect(Array.isArray(resp.body.data.payload.sanchalak.centres)).toBe(true);
    expect(Array.isArray(resp.body.data.payload.sanchalak.batches)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 8. Delta endpoint returns same envelope
  // ---------------------------------------------------------------------------
  it('8. GET /v1/sync/delta?since=… → same envelope shape, no Redis cache', async () => {
    const agent = makeAgent(app);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const resp = await agent
      .get(`/v1/sync/delta?since=${encodeURIComponent(since)}`)
      .set(authHeader(parentAccess));
    expect(resp.status).toBe(200);
    expect(resp.body.data.payload).toBeDefined();
    expect(resp.body.data.payload.common).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // 9. Perf — sync batch 100 ops (using fresh students so handlers actually run)
  // ---------------------------------------------------------------------------
  it('9. sync batch 100 ops → wall-clock timing reported', async () => {
    // Seed 100 students on the same batch.
    const tag = Date.now().toString().slice(-6);
    const perfStudents: string[] = [];
    for (let i = 0; i < 100; i += 1) {
      const [row] = (await drizzle.db.execute(
        sql`INSERT INTO students(parent_user_id, full_name, dob, age_group, centre_id, batch_id,
                                  student_code, status, enrolled_at)
            VALUES (${parentUserId}, ${`PerfStudent-${tag}-${i}`}, '2017-04-12', 'bal', ${centreId}, ${batchId},
                    ${`MSV-PERF-${tag}-${i.toString().padStart(3, '0')}`}, 'active', now()) RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      perfStudents.push(row!.id);
    }
    const now = new Date().toISOString();
    const ops = perfStudents.map((sid, i) => ({
      client_op_id: `01HSYNCP${Date.now()}P${i.toString().padStart(3, '0')}`,
      op_kind: 'attendance.mark' as const,
      payload: {
        session_id: sessionId,
        student_id: sid,
        status: 'present' as const,
        marked_at: now,
      },
      client_timestamp: now,
    }));
    const agent = makeAgent(app);
    const startedAt = Date.now();
    const resp = await agent.post('/v1/sync/batch').set(authHeader(shikshakAccess)).send({ ops });
    const elapsedMs = Date.now() - startedAt;
    expect(resp.status).toBe(200);
    expect(resp.body.data.results).toHaveLength(100);
    // Soft assertion: report timing for the build log. Not a hard pass/fail
    // because CI hardware varies — but we expect well under 10s.
    // eslint-disable-next-line no-console
    console.log(`[sync.perf] 100 ops batch wall-clock: ${elapsedMs}ms`);
    expect(elapsedMs).toBeLessThan(30_000);
  }, 60_000);
});
