/**
 * Homework integration tests — Step 18.
 *
 * Coverage:
 *   1. Assign to batch of 3 → COUNT(*) homework_submissions WHERE assignment_id
 *      returns exactly 3.
 *   2. Mark done → submission_asset_id stored, status remains pending until grade.
 *   3. Grade with 'approved' → exactly one punya_transactions row with
 *      idempotency_key = `homework:{submission_id}`; balance updated.
 *   4. Grade with 'starred' → bonus Punya (20% over base) credited.
 *   5. Late marker → past-due assignments flip pending submissions to late=true.
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
import { HomeworkService } from '../homework.service';

import type { INestApplication } from '@nestjs/common';

type Role = 'super_admin' | 'shikshak' | 'parent' | 'city_admin';

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

describe('Homework — integration', () => {
  let app: INestApplication;
  let drizzle: DrizzleService;
  let homework: HomeworkService;
  let cityId: string;
  let centreId: string;
  let batchId: string;
  let shikshakUserId: string;
  let parentUserId: string;
  let studentIds: string[];

  beforeAll(async () => {
    app = await bootTestApp();
    await captureOtps(app);
    drizzle = app.get(DrizzleService);
    homework = app.get(HomeworkService);

    const tag = Date.now().toString().slice(-6);
    const [stateRow] = (await drizzle.db.execute(
      sql`INSERT INTO states(name, code) VALUES (${`ST-HW-${tag}`}, ${'H' + tag.slice(-2)}) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    const [cityRow] = (await drizzle.db.execute(
      sql`INSERT INTO cities(state_id, name, code) VALUES (${stateRow!.id}, ${`CITY-HW-${tag}`}, ${'H' + tag.slice(-2)}) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    cityId = cityRow!.id;
    const [centreRow] = (await drizzle.db.execute(
      sql`INSERT INTO centres(city_id, name, status, gps_radius_m, lat, lng)
          VALUES (${cityId}, ${`Centre-HW-${tag}`}, 'active', 500, 23.0225, 72.5714) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    centreId = centreRow!.id;
    const [batchRow] = (await drizzle.db.execute(
      sql`INSERT INTO batches(centre_id, name, age_group, day_of_week, start_time, end_time, capacity, status)
          VALUES (${centreId}, ${`Bal-HW-${tag}`}, 'bal', '{0,1,2,3,4,5,6}', '09:00', '11:00', 30, 'active') RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    batchId = batchRow!.id;

    const shikshak = await mintAccessAs({
      app,
      role: 'shikshak',
      cityId,
      centreIds: [centreId],
      batchIds: [batchId],
    });
    shikshakUserId = shikshak.userId;

    const parent = await mintAccessAs({ app, role: 'parent', cityId });
    parentUserId = parent.userId;

    studentIds = [];
    for (let i = 0; i < 3; i += 1) {
      const [row] = (await drizzle.db.execute(
        sql`INSERT INTO students(parent_user_id, full_name, dob, age_group, centre_id, batch_id,
                                  student_code, status, enrolled_at)
            VALUES (${parentUserId}, ${`StudentHW-${tag}-${i}`}, '2015-04-12', 'bal', ${centreId}, ${batchId},
                    ${`HW-${tag}-${i}`}, 'active', now()) RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      studentIds.push(row!.id);
    }
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('1. assign to batch of 3 → COUNT(*) homework_submissions = 3', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const r = await homework.assign(
      {
        user_id: shikshakUserId,
        role: 'shikshak',
        city_id: cityId,
        centre_ids: [centreId],
        batch_ids: [batchId],
      },
      {
        batch_id: batchId,
        title: 'Read chapter 5',
        due_date: tomorrow,
      },
    );
    expect(r.submissions_seeded).toBe(3);
    const rows = (await drizzle.db.execute(
      sql`SELECT COUNT(*)::int AS c FROM homework_submissions WHERE assignment_id = ${r.assignment.id}`,
    )) as unknown as Array<{ c: number }>;
    expect(rows[0]!.c).toBe(3);
  });

  it('2. mark-done flips submission_asset_id', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const { assignment } = await homework.assign(
      {
        user_id: shikshakUserId,
        role: 'shikshak',
        city_id: cityId,
        centre_ids: [centreId],
        batch_ids: [batchId],
      },
      { batch_id: batchId, title: 'Mark-done test', due_date: tomorrow },
    );
    const [asset] = (await drizzle.db.execute(sql`
      INSERT INTO media_assets(kind, owner_user_id, s3_bucket, s3_key, mime_type, size_bytes, checksum_sha256, status, exif_stripped)
      VALUES ('homework_attachment', ${parentUserId}, 'jp-test', ${`test/${Date.now()}.jpg`},
              'image/jpeg', 1024, ${'a'.repeat(64)}, 'ready', true) RETURNING id
    `)) as unknown as Array<{ id: string }>;
    const result = await homework.markDone(
      { user_id: parentUserId, role: 'parent' },
      assignment.id,
      { student_id: studentIds[0]!, submission_asset_id: asset!.id },
    );
    expect(result.submission.submission_asset_id).toBe(asset!.id);
  });

  it('3. grade approved → ONE homework:* punya_transactions row, balance up', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const { assignment } = await homework.assign(
      {
        user_id: shikshakUserId,
        role: 'shikshak',
        city_id: cityId,
        centre_ids: [centreId],
        batch_ids: [batchId],
      },
      { batch_id: batchId, title: 'Grade test', due_date: tomorrow },
    );
    const student = studentIds[1]!;
    const before = (await drizzle.db.execute(
      sql`SELECT COALESCE(total_points, 0)::int AS p FROM punya_balances WHERE student_id = ${student}`,
    )) as unknown as Array<{ p: number }>;
    const beforePts = before[0]?.p ?? 0;
    const r = await homework.grade(
      {
        user_id: shikshakUserId,
        role: 'shikshak',
        city_id: cityId,
        centre_ids: [centreId],
        batch_ids: [batchId],
      },
      assignment.id,
      student,
      { status: 'approved' },
    );
    expect(r.points_awarded).toBe(15);
    const idemKey = `homework:${r.submission.id}`;
    const rows = (await drizzle.db.execute(
      sql`SELECT COUNT(*)::int AS c FROM punya_transactions WHERE idempotency_key = ${idemKey}`,
    )) as unknown as Array<{ c: number }>;
    expect(rows[0]!.c).toBe(1);
    const after = (await drizzle.db.execute(
      sql`SELECT total_points::int AS p FROM punya_balances WHERE student_id = ${student}`,
    )) as unknown as Array<{ p: number }>;
    expect(after[0]!.p).toBe(beforePts + 15);
  });

  it('4. grade starred → 18 points (20% bonus)', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const { assignment } = await homework.assign(
      {
        user_id: shikshakUserId,
        role: 'shikshak',
        city_id: cityId,
        centre_ids: [centreId],
        batch_ids: [batchId],
      },
      { batch_id: batchId, title: 'Star test', due_date: tomorrow },
    );
    const r = await homework.grade(
      {
        user_id: shikshakUserId,
        role: 'shikshak',
        city_id: cityId,
        centre_ids: [centreId],
        batch_ids: [batchId],
      },
      assignment.id,
      studentIds[2]!,
      { status: 'starred', feedback_note: 'Beautiful handwriting' },
    );
    expect(r.points_awarded).toBe(18);
    expect(r.submission.status).toBe('starred');
  });

  it('5. markOverdue flips pending submissions to late=true', async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const r = await homework.assign(
      {
        user_id: shikshakUserId,
        role: 'shikshak',
        city_id: cityId,
        centre_ids: [centreId],
        batch_ids: [batchId],
      },
      { batch_id: batchId, title: 'Overdue test', due_date: yesterday },
    );
    const out = await homework.markOverdue(new Date().toISOString().slice(0, 10));
    expect(out.assignments_scanned).toBeGreaterThanOrEqual(1);
    const rows = (await drizzle.db.execute(
      sql`SELECT COUNT(*)::int AS c FROM homework_submissions WHERE assignment_id = ${r.assignment.id} AND late = true`,
    )) as unknown as Array<{ c: number }>;
    expect(rows[0]!.c).toBe(3);
  });
});
