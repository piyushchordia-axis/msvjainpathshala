/**
 * Shivirs integration tests — Step 15.
 *
 * Coverage:
 *   1. Create shivir + sessions + 5 registrations → POST scan x5 → live shows 5 in.
 *   2. present_only: scan twice → 2nd returns 409 ERR_SHIVIR_SCAN_DUPLICATE_PRESENT.
 *   3. in_out: scan → out → 3rd no force → 409 ERR_SHIVIR_SCAN_OUT_OF_ORDER;
 *      force=true → 200.
 *   4. Scan replay with same client_op_id → returns duplicate=true; no new row.
 *   5. Volunteer not assigned → 403 ERR_SHIVIR_VOLUNTEER_NOT_ASSIGNED.
 *   6. Unregistered student → 409 ERR_SHIVIR_NOT_REGISTERED.
 *   7. Sync handler: POST /v1/sync/batch with shivir.scan → success, then replay
 *      → duplicate.
 *   8. POST /v1/admin/shivirs/:id/export → 202 with queued=true|false.
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

describe('Shivirs — integration', () => {
  let app: INestApplication;
  let drizzle: DrizzleService;
  let cityId: string;
  let centreId: string;
  let batchId: string;
  let cityAdminAccess: string;
  let cityAdminUserId: string;
  let sanchalakAccess: string;
  let sanchalakUserId: string;
  let volunteerAccess: string;
  let volunteerUserId: string;
  let unauthorisedVolunteerAccess: string;
  let parentUserId: string;
  let studentIds: string[];

  beforeAll(async () => {
    app = await bootTestApp();
    await captureOtps(app);
    drizzle = app.get(DrizzleService);

    const tag = Date.now().toString().slice(-6);
    const [stateRow] = (await drizzle.db.execute(
      sql`INSERT INTO states(name, code) VALUES (${`ST-SH-${tag}`}, ${'H' + tag.slice(-2)}) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    const [cityRow] = (await drizzle.db.execute(
      sql`INSERT INTO cities(state_id, name, code) VALUES (${stateRow!.id}, ${`CITY-SH-${tag}`}, ${'H' + tag.slice(-2)}) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    cityId = cityRow!.id;
    const [centreRow] = (await drizzle.db.execute(
      sql`INSERT INTO centres(city_id, name, status, gps_radius_m, lat, lng)
          VALUES (${cityId}, ${`Centre-SH-${tag}`}, 'active', 500, 23.0225, 72.5714) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    centreId = centreRow!.id;

    const cityAdmin = await mintAccessAs({ app, role: 'city_admin', cityId });
    cityAdminAccess = cityAdmin.access;
    cityAdminUserId = cityAdmin.userId;

    const sanchalak = await mintAccessAs({
      app,
      role: 'sanchalak',
      cityId,
      centreIds: [centreId],
    });
    sanchalakAccess = sanchalak.access;
    sanchalakUserId = sanchalak.userId;

    const volunteer = await mintAccessAs({
      app,
      role: 'parent',
      cityId,
    });
    volunteerAccess = volunteer.access;
    volunteerUserId = volunteer.userId;

    const unassigned = await mintAccessAs({ app, role: 'parent', cityId });
    unauthorisedVolunteerAccess = unassigned.access;

    const parent = await mintAccessAs({ app, role: 'parent', cityId });
    parentUserId = parent.userId;

    const [batchRow] = (await drizzle.db.execute(
      sql`INSERT INTO batches(centre_id, name, age_group, day_of_week, start_time, end_time, capacity, status, shikshak_id)
          VALUES (${centreId}, ${`Bal-SH-${tag}`}, 'bal', '{0,1,2,3,4,5,6}', '09:00', '11:00', 30, 'active', ${sanchalakUserId}) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    batchId = batchRow!.id;

    // 5 students owned by the parent.
    studentIds = [];
    for (let i = 0; i < 5; i += 1) {
      const [row] = (await drizzle.db.execute(
        sql`INSERT INTO students(parent_user_id, full_name, dob, age_group, centre_id, batch_id,
                                  student_code, status, enrolled_at)
            VALUES (${parentUserId}, ${`StudentSH-${tag}-${i}`}, '2015-04-12', 'bal', ${centreId}, ${batchId},
                    ${`MSV-SH-${tag}-${i}`}, 'active', now()) RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      studentIds.push(row!.id);
    }

    void cityAdminUserId;
    void volunteerUserId;
    void batchId;
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // 1. Create shivir, register 5 students, scan 5 → live shows 5 in
  // ---------------------------------------------------------------------------
  it('1. in_out shivir: create + register 5 + scan 5 → live currently_in=5', async () => {
    const agent = makeAgent(app);
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // Create shivir with 2 sessions
    const createResp = await agent
      .post('/v1/admin/shivirs')
      .set(authHeader(cityAdminAccess))
      .send({
        city_id: cityId,
        name: 'Paryushan Shivir',
        description: 'A two-day intensive',
        start_date: today,
        end_date: tomorrow,
        attendance_mode: 'in_out',
        sessions: [
          { day_number: 1, session_date: today, start_time: '09:00', end_time: '12:00' },
          { day_number: 2, session_date: tomorrow, start_time: '09:00', end_time: '12:00' },
        ],
      });
    expect(createResp.status).toBe(201);
    const eventId = createResp.body.data.event.id;
    const sessionIdDay1 = createResp.body.data.sessions[0].id;
    expect(eventId).toBeTruthy();

    // Assign volunteer (sanchalak role can self-do this, but city_admin issues it)
    const vResp = await agent
      .post(`/v1/admin/shivirs/${eventId}/volunteers`)
      .set(authHeader(cityAdminAccess))
      .send({ user_id: volunteerUserId });
    expect(vResp.status).toBe(201);

    // Register 5 students
    const regResp = await agent
      .post(`/v1/admin/shivirs/${eventId}/registrations`)
      .set(authHeader(cityAdminAccess))
      .send({ student_ids: studentIds });
    expect(regResp.status).toBe(201);
    expect(regResp.body.data.registered.length).toBe(5);

    // Volunteer scans all 5 students in
    for (let i = 0; i < 5; i += 1) {
      const scanResp = await agent
        .post(`/v1/shivirs/${eventId}/scan`)
        .set(authHeader(volunteerAccess))
        .send({
          shivir_session_id: sessionIdDay1,
          student_qr_code: studentIds[i],
          client_op_id: `01HSCAN${Date.now()}A${i}`,
          scanned_at: new Date().toISOString(),
        });
      expect(scanResp.status).toBe(201);
      expect(scanResp.body.data.scan_kind).toBe('check_in');
    }

    // Live counters
    const liveResp = await agent
      .get(`/v1/admin/shivirs/${eventId}/live`)
      .query({ session_id: sessionIdDay1 })
      .set(authHeader(cityAdminAccess));
    expect(liveResp.status).toBe(200);
    expect(liveResp.body.data.counters.registered).toBe(5);
    expect(liveResp.body.data.counters.currently_in).toBe(5);
    expect(liveResp.body.data.counters.already_out).toBe(0);
    expect(liveResp.body.data.counters.not_arrived).toBe(0);
    expect(liveResp.body.data.recent_scans.length).toBe(5);
  });

  // ---------------------------------------------------------------------------
  // 2. present_only: same student scanned twice → 409
  // ---------------------------------------------------------------------------
  it('2. present_only mode: second scan returns 409 ERR_SHIVIR_SCAN_DUPLICATE_PRESENT', async () => {
    const agent = makeAgent(app);
    const today = new Date().toISOString().slice(0, 10);

    const create = await agent
      .post('/v1/admin/shivirs')
      .set(authHeader(cityAdminAccess))
      .send({
        city_id: cityId,
        name: 'Present-Only Pravachan',
        start_date: today,
        end_date: today,
        attendance_mode: 'present_only',
        sessions: [{ day_number: 1, session_date: today, start_time: '17:00', end_time: '18:30' }],
      });
    expect(create.status).toBe(201);
    const eventId = create.body.data.event.id;
    const sessionId = create.body.data.sessions[0].id;

    await agent
      .post(`/v1/admin/shivirs/${eventId}/volunteers`)
      .set(authHeader(cityAdminAccess))
      .send({ user_id: volunteerUserId });
    await agent
      .post(`/v1/admin/shivirs/${eventId}/registrations`)
      .set(authHeader(cityAdminAccess))
      .send({ student_ids: [studentIds[0]] });

    const first = await agent
      .post(`/v1/shivirs/${eventId}/scan`)
      .set(authHeader(volunteerAccess))
      .send({
        shivir_session_id: sessionId,
        student_qr_code: studentIds[0],
        client_op_id: `01HPRES${Date.now()}P1`,
        scanned_at: new Date().toISOString(),
      });
    expect(first.status).toBe(201);
    expect(first.body.data.scan_kind).toBe('present');

    const second = await agent
      .post(`/v1/shivirs/${eventId}/scan`)
      .set(authHeader(volunteerAccess))
      .send({
        shivir_session_id: sessionId,
        student_qr_code: studentIds[0],
        client_op_id: `01HPRES${Date.now()}P2`,
        scanned_at: new Date().toISOString(),
      });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ERR_SHIVIR_SCAN_DUPLICATE_PRESENT');
  });

  // ---------------------------------------------------------------------------
  // 3. in_out: scan in → out → 3rd no force = 409; force=true → check_in
  // ---------------------------------------------------------------------------
  it('3. in_out: third scan blocked without force, allowed with force=true', async () => {
    const agent = makeAgent(app);
    const today = new Date().toISOString().slice(0, 10);

    const create = await agent
      .post('/v1/admin/shivirs')
      .set(authHeader(cityAdminAccess))
      .send({
        city_id: cityId,
        name: 'InOut Re-Entry Test',
        start_date: today,
        end_date: today,
        attendance_mode: 'in_out',
        sessions: [{ day_number: 1, session_date: today, start_time: '09:00', end_time: '20:00' }],
      });
    expect(create.status).toBe(201);
    const eventId = create.body.data.event.id;
    const sessionId = create.body.data.sessions[0].id;

    await agent
      .post(`/v1/admin/shivirs/${eventId}/volunteers`)
      .set(authHeader(cityAdminAccess))
      .send({ user_id: volunteerUserId });
    await agent
      .post(`/v1/admin/shivirs/${eventId}/registrations`)
      .set(authHeader(cityAdminAccess))
      .send({ student_ids: [studentIds[1]] });

    // 1st: check_in
    const r1 = await agent
      .post(`/v1/shivirs/${eventId}/scan`)
      .set(authHeader(volunteerAccess))
      .send({
        shivir_session_id: sessionId,
        student_qr_code: studentIds[1],
        client_op_id: `01HIO${Date.now()}1`,
        scanned_at: new Date().toISOString(),
      });
    expect(r1.body.data.scan_kind).toBe('check_in');

    // 2nd: check_out
    const r2 = await agent
      .post(`/v1/shivirs/${eventId}/scan`)
      .set(authHeader(volunteerAccess))
      .send({
        shivir_session_id: sessionId,
        student_qr_code: studentIds[1],
        client_op_id: `01HIO${Date.now()}2`,
        scanned_at: new Date(Date.now() + 1000).toISOString(),
      });
    expect(r2.body.data.scan_kind).toBe('check_out');

    // 3rd no force → 409
    const r3 = await agent
      .post(`/v1/shivirs/${eventId}/scan`)
      .set(authHeader(volunteerAccess))
      .send({
        shivir_session_id: sessionId,
        student_qr_code: studentIds[1],
        client_op_id: `01HIO${Date.now()}3`,
        scanned_at: new Date(Date.now() + 2000).toISOString(),
      });
    expect(r3.status).toBe(409);
    expect(r3.body.error.code).toBe('ERR_SHIVIR_SCAN_OUT_OF_ORDER');

    // 3rd with force=true → check_in (re-entry)
    const r4 = await agent
      .post(`/v1/shivirs/${eventId}/scan`)
      .set(authHeader(volunteerAccess))
      .send({
        shivir_session_id: sessionId,
        student_qr_code: studentIds[1],
        client_op_id: `01HIO${Date.now()}4`,
        scanned_at: new Date(Date.now() + 3000).toISOString(),
        force: true,
      });
    expect(r4.status).toBe(201);
    expect(r4.body.data.scan_kind).toBe('check_in');
  });

  // ---------------------------------------------------------------------------
  // 4. Replay scan with same client_op_id → duplicate=true, no new row
  // ---------------------------------------------------------------------------
  it('4. replay scan with same client_op_id → duplicate=true, no new DB row', async () => {
    const agent = makeAgent(app);
    const today = new Date().toISOString().slice(0, 10);

    const create = await agent
      .post('/v1/admin/shivirs')
      .set(authHeader(cityAdminAccess))
      .send({
        city_id: cityId,
        name: 'Replay Test',
        start_date: today,
        end_date: today,
        attendance_mode: 'in_out',
        sessions: [{ day_number: 1, session_date: today, start_time: '09:00', end_time: '12:00' }],
      });
    const eventId = create.body.data.event.id;
    const sessionId = create.body.data.sessions[0].id;

    await agent
      .post(`/v1/admin/shivirs/${eventId}/volunteers`)
      .set(authHeader(cityAdminAccess))
      .send({ user_id: volunteerUserId });
    await agent
      .post(`/v1/admin/shivirs/${eventId}/registrations`)
      .set(authHeader(cityAdminAccess))
      .send({ student_ids: [studentIds[2]] });

    const clientOpId = `01HREPLAY${Date.now()}R`;
    const r1 = await agent
      .post(`/v1/shivirs/${eventId}/scan`)
      .set(authHeader(volunteerAccess))
      .send({
        shivir_session_id: sessionId,
        student_qr_code: studentIds[2],
        client_op_id: clientOpId,
        scanned_at: new Date().toISOString(),
      });
    expect(r1.status).toBe(201);
    expect(r1.body.data.duplicate).toBe(false);

    const r2 = await agent
      .post(`/v1/shivirs/${eventId}/scan`)
      .set(authHeader(volunteerAccess))
      .send({
        shivir_session_id: sessionId,
        student_qr_code: studentIds[2],
        client_op_id: clientOpId,
        scanned_at: new Date().toISOString(),
      });
    expect(r2.status).toBe(201);
    expect(r2.body.data.duplicate).toBe(true);
    expect(r2.body.data.scan_id).toBe(r1.body.data.scan_id);

    const countRows = (await drizzle.db.execute(
      sql`SELECT COUNT(*)::int AS c FROM shivir_attendance_scans WHERE client_op_id = ${clientOpId}`,
    )) as unknown as Array<{ c: number }>;
    expect(countRows[0]!.c).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // 5. Volunteer not assigned → 403
  // ---------------------------------------------------------------------------
  it('5. unassigned parent → 403 ERR_SHIVIR_VOLUNTEER_NOT_ASSIGNED', async () => {
    const agent = makeAgent(app);
    const today = new Date().toISOString().slice(0, 10);

    const create = await agent
      .post('/v1/admin/shivirs')
      .set(authHeader(cityAdminAccess))
      .send({
        city_id: cityId,
        name: 'NoVolunteerForYou',
        start_date: today,
        end_date: today,
        attendance_mode: 'in_out',
        sessions: [{ day_number: 1, session_date: today, start_time: '09:00', end_time: '12:00' }],
      });
    const eventId = create.body.data.event.id;
    const sessionId = create.body.data.sessions[0].id;

    await agent
      .post(`/v1/admin/shivirs/${eventId}/registrations`)
      .set(authHeader(cityAdminAccess))
      .send({ student_ids: [studentIds[3]] });

    const resp = await agent
      .post(`/v1/shivirs/${eventId}/scan`)
      .set(authHeader(unauthorisedVolunteerAccess))
      .send({
        shivir_session_id: sessionId,
        student_qr_code: studentIds[3],
        client_op_id: `01HSEC${Date.now()}V`,
        scanned_at: new Date().toISOString(),
      });
    expect(resp.status).toBe(403);
    expect(resp.body.error.code).toBe('ERR_SHIVIR_VOLUNTEER_NOT_ASSIGNED');
  });

  // ---------------------------------------------------------------------------
  // 6. Unregistered student → 409 ERR_SHIVIR_NOT_REGISTERED
  // ---------------------------------------------------------------------------
  it('6. unregistered student → 409 ERR_SHIVIR_NOT_REGISTERED', async () => {
    const agent = makeAgent(app);
    const today = new Date().toISOString().slice(0, 10);

    const create = await agent
      .post('/v1/admin/shivirs')
      .set(authHeader(cityAdminAccess))
      .send({
        city_id: cityId,
        name: 'Unregistered Test',
        start_date: today,
        end_date: today,
        attendance_mode: 'in_out',
        sessions: [{ day_number: 1, session_date: today, start_time: '09:00', end_time: '12:00' }],
      });
    const eventId = create.body.data.event.id;
    const sessionId = create.body.data.sessions[0].id;

    await agent
      .post(`/v1/admin/shivirs/${eventId}/volunteers`)
      .set(authHeader(cityAdminAccess))
      .send({ user_id: volunteerUserId });
    // NO registrations.

    const resp = await agent
      .post(`/v1/shivirs/${eventId}/scan`)
      .set(authHeader(volunteerAccess))
      .send({
        shivir_session_id: sessionId,
        student_qr_code: studentIds[4],
        client_op_id: `01HUNREG${Date.now()}U`,
        scanned_at: new Date().toISOString(),
      });
    expect(resp.status).toBe(409);
    expect(resp.body.error.code).toBe('ERR_SHIVIR_NOT_REGISTERED');
  });

  // ---------------------------------------------------------------------------
  // 7. Sync handler: shivir.scan via /v1/sync/batch
  // ---------------------------------------------------------------------------
  it('7. sync handler: shivir.scan op succeeds, replay returns duplicate', async () => {
    const agent = makeAgent(app);
    const today = new Date().toISOString().slice(0, 10);

    const create = await agent
      .post('/v1/admin/shivirs')
      .set(authHeader(cityAdminAccess))
      .send({
        city_id: cityId,
        name: 'Sync Path Test',
        start_date: today,
        end_date: today,
        attendance_mode: 'in_out',
        sessions: [{ day_number: 1, session_date: today, start_time: '09:00', end_time: '12:00' }],
      });
    const eventId = create.body.data.event.id;
    const sessionId = create.body.data.sessions[0].id;

    await agent
      .post(`/v1/admin/shivirs/${eventId}/volunteers`)
      .set(authHeader(cityAdminAccess))
      .send({ user_id: volunteerUserId });
    await agent
      .post(`/v1/admin/shivirs/${eventId}/registrations`)
      .set(authHeader(cityAdminAccess))
      .send({ student_ids: [studentIds[0]] });

    const clientOpId = `01HSYNCSC${Date.now()}Z`;
    const now = new Date().toISOString();
    const op = {
      client_op_id: clientOpId,
      op_kind: 'shivir.scan' as const,
      payload: {
        shivir_event_id: eventId,
        shivir_session_id: sessionId,
        student_qr_code: studentIds[0],
        scanned_at: now,
      },
      client_timestamp: now,
    };

    const first = await agent
      .post('/v1/sync/batch')
      .set(authHeader(volunteerAccess))
      .send({ ops: [op] });
    expect(first.status).toBe(200);
    const firstResult = first.body.data.results[0];
    // Note: a fresh scan via sync returns 'success'; if the student already had
    // a scan via another op it could return 'failed' with ERR_SYNC_CONFLICT.
    expect(['success', 'duplicate']).toContain(firstResult.status);

    const replay = await agent
      .post('/v1/sync/batch')
      .set(authHeader(volunteerAccess))
      .send({ ops: [op] });
    expect(replay.status).toBe(200);
    expect(replay.body.data.results[0].status).toBe('duplicate');
  });

  // ---------------------------------------------------------------------------
  // 8. Export endpoint — queued enqueue
  // ---------------------------------------------------------------------------
  it('8. POST /v1/admin/shivirs/:id/export → 202 with export_id', async () => {
    const agent = makeAgent(app);
    const today = new Date().toISOString().slice(0, 10);

    const create = await agent
      .post('/v1/admin/shivirs')
      .set(authHeader(cityAdminAccess))
      .send({
        city_id: cityId,
        name: 'Export Test',
        start_date: today,
        end_date: today,
        attendance_mode: 'in_out',
        sessions: [{ day_number: 1, session_date: today, start_time: '09:00', end_time: '12:00' }],
      });
    const eventId = create.body.data.event.id;

    const resp = await agent
      .post(`/v1/admin/shivirs/${eventId}/export`)
      .query({ format: 'csv' })
      .set(authHeader(cityAdminAccess));
    expect(resp.status).toBe(202);
    expect(resp.body.data.export_id).toMatch(/^shivir-export:/);
    expect(resp.body.data.format).toBe('csv');
    void sanchalakAccess;
  });
});
