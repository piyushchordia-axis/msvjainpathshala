/**
 * Enrolments module integration tests — Step 10.
 *
 * Covers the verification prompts:
 *   1. Guest POST /v1/enrolments → 201 + status=pending
 *   2. Same parent + same first name + same dob → 200/201 with
 *      meta.warning='duplicate_suspected'
 *   3. Approve when batch at capacity → 409 ERR_BATCH_OVER_CAPACITY
 *   4. Approve when under capacity → 200 + student row created
 *   5. POST /v1/students/:id/deactivate → status='inactive' (no DELETE)
 *   6. POST /v1/msv/enrolments + admin approve → student msv_status='approved'
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

type AdminRole = 'super_admin' | 'state_admin' | 'city_admin' | 'sanchalak' | 'shikshak';

async function mintAccessAs(opts: {
  app: INestApplication;
  role: AdminRole | 'parent';
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
  await agent.post('/v1/auth/otp/send').send({ phone });
  const verify = await agent.post('/v1/auth/otp/verify').send({
    phone,
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

describe('Enrolments module — integration', () => {
  let app: INestApplication;
  let drizzle: DrizzleService;
  let cityId: string;
  let centreId: string;
  let batchId: string;
  let tightBatchId: string;

  beforeAll(async () => {
    app = await bootTestApp();
    await captureOtps(app);
    drizzle = app.get(DrizzleService);

    const tag = Date.now().toString().slice(-6);
    const [stateRow] = (await drizzle.db.execute(
      sql`INSERT INTO states(name, code) VALUES (${`ST-${tag}`}, ${tag.slice(-3).toUpperCase()}) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    const [cityRow] = (await drizzle.db.execute(
      sql`INSERT INTO cities(state_id, name, code) VALUES (${stateRow!.id}, ${`CITY-${tag}`}, ${'C' + tag.slice(-2)}) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    cityId = cityRow!.id;
    const [centreRow] = (await drizzle.db.execute(
      sql`INSERT INTO centres(city_id, name, status, gps_radius_m) VALUES (${cityId}, ${`Centre-${tag}`}, 'active', 500) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    centreId = centreRow!.id;
    const [batchRow] = (await drizzle.db.execute(
      sql`INSERT INTO batches(centre_id, name, age_group, day_of_week, start_time, end_time, capacity, status)
          VALUES (${centreId}, ${`Bal-${tag}`}, 'bal', '{0}', '09:00', '11:00', 30, 'active') RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    batchId = batchRow!.id;
    const [tightBatch] = (await drizzle.db.execute(
      sql`INSERT INTO batches(centre_id, name, age_group, day_of_week, start_time, end_time, capacity, status)
          VALUES (${centreId}, ${`Tight-${tag}`}, 'bal', '{0}', '09:00', '11:00', 1, 'active') RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    tightBatchId = tightBatch!.id;
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  // 1 — Guest path: POST /v1/enrolments with no auth → 201 + status=pending
  it('1. guest can POST /v1/enrolments → 201 + status=pending', async () => {
    const agent = makeAgent(app);
    const parentPhone = nextTestPhone();
    const resp = await agent.post('/v1/enrolments').send({
      parent_phone: parentPhone,
      parent_full_name: 'Rajesh Shah',
      preferred_language: 'en',
      requested_centre_id: centreId,
      requested_batch_id: batchId,
      full_name: 'Aarav Shah',
      dob: '2017-04-12',
      age_group: 'bal',
      father_name: 'Rajesh Shah',
    });
    expect(resp.status).toBe(201);
    expect(resp.body.data.enrolment.status).toBe('pending');
    expect(resp.body.data.enrolment.requested_centre_id).toBe(centreId);
    expect(resp.body.meta.warning).toBeUndefined();
  });

  // 2 — Duplicate detection: same parent + first_name + dob → meta.warning
  it('2. duplicate (same name+dob+parent) returns meta.warning=duplicate_suspected', async () => {
    const agent = makeAgent(app);
    const parentPhone = nextTestPhone();

    // Need to PRE-CREATE a student row so the duplicate check sees it.
    // We do this by submitting one enrolment, approving it via the
    // service-level write path, then resubmitting.
    const first = await agent.post('/v1/enrolments').send({
      parent_phone: parentPhone,
      parent_full_name: 'Mehta',
      requested_centre_id: centreId,
      requested_batch_id: batchId,
      full_name: 'Diya Mehta',
      dob: '2018-08-21',
      age_group: 'bal',
    });
    expect(first.status).toBe(201);
    const enrolmentId = first.body.data.enrolment.id as string;

    // Approve via city_admin so the student row exists.
    const cityAdmin = await mintAccessAs({ app, role: 'city_admin', cityId });
    const approve = await makeAgent(app)
      .post(`/v1/enrolments/${enrolmentId}/approve`)
      .set('Authorization', `Bearer ${cityAdmin.access}`);
    expect(approve.status).toBe(200);

    // Now resubmit the same child via the same phone.
    const second = await makeAgent(app).post('/v1/enrolments').send({
      parent_phone: parentPhone,
      parent_full_name: 'Mehta',
      requested_centre_id: centreId,
      requested_batch_id: batchId,
      full_name: 'Diya Mehta',
      dob: '2018-08-21',
      age_group: 'bal',
    });
    expect(second.status).toBe(201);
    expect(second.body.meta.warning).toBe('duplicate_suspected');
    expect(second.body.meta.duplicate_of_student_id).toBeDefined();
  });

  // 3 — Capacity-fail on approve
  it('3. approve over capacity → 409 ERR_BATCH_OVER_CAPACITY', async () => {
    const cityAdmin = await mintAccessAs({ app, role: 'city_admin', cityId });

    // Submit two enrolments into the 1-seat tight batch.
    const a = await makeAgent(app).post('/v1/enrolments').send({
      parent_phone: nextTestPhone(),
      requested_centre_id: centreId,
      requested_batch_id: tightBatchId,
      full_name: 'A One',
      dob: '2017-03-15',
      age_group: 'bal',
    });
    const b = await makeAgent(app).post('/v1/enrolments').send({
      parent_phone: nextTestPhone(),
      requested_centre_id: centreId,
      requested_batch_id: tightBatchId,
      full_name: 'B Two',
      dob: '2017-03-16',
      age_group: 'bal',
    });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    // First approve fills the seat.
    const r1 = await makeAgent(app)
      .post(`/v1/enrolments/${a.body.data.enrolment.id}/approve`)
      .set('Authorization', `Bearer ${cityAdmin.access}`);
    expect(r1.status).toBe(200);

    // Second approve should hit capacity.
    const r2 = await makeAgent(app)
      .post(`/v1/enrolments/${b.body.data.enrolment.id}/approve`)
      .set('Authorization', `Bearer ${cityAdmin.access}`);
    expect(r2.status).toBe(409);
    expect(r2.body.error.code).toBe('ERR_BATCH_OVER_CAPACITY');
  });

  // 4 — Approve under capacity → 200 + student row + idcard.generation enqueued
  it('4. approve under capacity → 200 + student created + idcard job queued', async () => {
    const cityAdmin = await mintAccessAs({ app, role: 'city_admin', cityId });

    const submit = await makeAgent(app).post('/v1/enrolments').send({
      parent_phone: nextTestPhone(),
      requested_centre_id: centreId,
      requested_batch_id: batchId,
      full_name: 'Anaya Patel',
      dob: '2018-06-04',
      age_group: 'bal',
    });
    expect(submit.status).toBe(201);

    const approve = await makeAgent(app)
      .post(`/v1/enrolments/${submit.body.data.enrolment.id}/approve`)
      .set('Authorization', `Bearer ${cityAdmin.access}`);
    expect(approve.status).toBe(200);
    expect(approve.body.data.student).toBeDefined();
    expect(approve.body.data.student.status).toBe('active');
    expect(approve.body.data.student.student_code).toMatch(/^MSV-/);

    // idcard.generation job enqueued (BullMQ key in Redis).
    const stats = await makeAgent(app)
      .get('/v1/admin/queues/stats')
      .set('Authorization', `Bearer ${(await mintAccessAs({ app, role: 'super_admin' })).access}`);
    expect(stats.status).toBe(200);
    const row = stats.body.data.queues.find(
      (q: { queue: string }) => q.queue === 'idcard.generation',
    );
    expect(row).toBeDefined();
    expect(row.waiting + row.completed + row.delayed).toBeGreaterThan(0);
  });

  // 5 — Deactivate student → status='inactive' (NEVER DELETE — Q11)
  it('5. deactivate student → status=inactive, row still queryable (Q11)', async () => {
    const cityAdmin = await mintAccessAs({ app, role: 'city_admin', cityId });
    const submit = await makeAgent(app).post('/v1/enrolments').send({
      parent_phone: nextTestPhone(),
      requested_centre_id: centreId,
      requested_batch_id: batchId,
      full_name: 'Inactive Test',
      dob: '2017-01-01',
      age_group: 'bal',
    });
    const approve = await makeAgent(app)
      .post(`/v1/enrolments/${submit.body.data.enrolment.id}/approve`)
      .set('Authorization', `Bearer ${cityAdmin.access}`);
    const studentId = approve.body.data.student.id as string;

    const deact = await makeAgent(app)
      .post(`/v1/students/${studentId}/deactivate`)
      .set('Authorization', `Bearer ${cityAdmin.access}`)
      .send({ reason: 'moved out' });
    expect(deact.status).toBe(200);
    expect(deact.body.data.status).toBe('inactive');

    // Row still exists (no DELETE).
    const stillThere = await drizzle.dbRead.execute(
      sql`SELECT id, status, deactivated_at, deleted_at FROM students WHERE id = ${studentId}::uuid`,
    );
    const row = (
      stillThere as unknown as Array<{
        status: string;
        deactivated_at: Date | null;
        deleted_at: Date | null;
      }>
    )[0];
    expect(row).toBeDefined();
    expect(row!.status).toBe('inactive');
    expect(row!.deactivated_at).not.toBeNull();
    expect(row!.deleted_at).toBeNull(); // Q11: never hard-deleted
  });

  // 6 — MSV apply + approve → student.msv_status='approved'
  it('6. parent applies for MSV, city_admin approves → student.msv_status=approved', async () => {
    const cityAdmin = await mintAccessAs({ app, role: 'city_admin', cityId });

    // Create a student.
    const parentPhone = nextTestPhone();
    const submit = await makeAgent(app).post('/v1/enrolments').send({
      parent_phone: parentPhone,
      parent_full_name: 'MSV Parent',
      requested_centre_id: centreId,
      requested_batch_id: batchId,
      full_name: 'MSV Child',
      dob: '2014-02-09',
      age_group: 'bal',
    });
    const approve = await makeAgent(app)
      .post(`/v1/enrolments/${submit.body.data.enrolment.id}/approve`)
      .set('Authorization', `Bearer ${cityAdmin.access}`);
    const studentId = approve.body.data.student.id as string;
    const parentUserId = approve.body.data.enrolment.parent_user_id as string;

    // Mint a parent token for the (newly-promoted) parent user.
    const jwt = app.get(JwtService);
    const config = app.get(SystemConfigService);
    const accessTtl = await config.getNumber('jwt.access_ttl_seconds');
    const parentAccess = await jwt.signAccess(
      {
        sub: parentUserId,
        role: 'parent',
        scope: {},
        view_context: 'parent',
        device_session_id: crypto.randomUUID(),
        jti: crypto.randomUUID(),
      },
      accessTtl,
    );

    const apply = await makeAgent(app)
      .post('/v1/msv/enrolments')
      .set('Authorization', `Bearer ${parentAccess}`)
      .send({ student_id: studentId, note: 'Strong interest' });
    expect(apply.status).toBe(201);
    expect(apply.body.data.status).toBe('applied');
    const msvId = apply.body.data.id as string;

    const decide = await makeAgent(app)
      .post(`/v1/msv/enrolments/${msvId}/approve`)
      .set('Authorization', `Bearer ${cityAdmin.access}`)
      .send({ notes: 'discretionary approval' });
    expect(decide.status).toBe(200);
    expect(decide.body.data.status).toBe('approved');

    // Verify student.msv_status was flipped.
    const row = await drizzle.dbRead.execute(
      sql`SELECT msv_status FROM students WHERE id = ${studentId}::uuid`,
    );
    const s = (row as unknown as Array<{ msv_status: string }>)[0];
    expect(s).toBeDefined();
    expect(s!.msv_status).toBe('approved');
  });
});
