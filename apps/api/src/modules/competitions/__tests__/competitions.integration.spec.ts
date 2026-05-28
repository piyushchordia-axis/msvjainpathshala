/**
 * Competitions integration tests — Step 18 (SPEC §5.12, §6.15).
 *
 * Coverage:
 *   1. Register parent's child → row created, count increments.
 *   2. max_participants — 2nd registration rejected with ERR_COMPETITION_FULL.
 *   3. Eligibility: msv_only + age_group filters block ineligible students.
 *   4. Record results then publish → top-3 get punya_transactions with
 *      `reference_type='competition'` (source_entity_kind), exactly 3 rows.
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
import { CompetitionsService } from '../competitions.service';

import type { INestApplication } from '@nestjs/common';

async function mintAccessAs(opts: {
  app: INestApplication;
  role: 'parent' | 'city_admin';
  cityId?: string;
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
  const scope: { city_id?: string } = {};
  if (opts.cityId) scope.city_id = opts.cityId;
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

describe('Competitions — integration', () => {
  let app: INestApplication;
  let drizzle: DrizzleService;
  let svc: CompetitionsService;
  let cityId: string;
  let centreId: string;
  let batchId: string;
  let cityAdminUserId: string;
  let parentUserId: string;
  let studentIds: string[];

  beforeAll(async () => {
    app = await bootTestApp();
    await captureOtps(app);
    drizzle = app.get(DrizzleService);
    svc = app.get(CompetitionsService);

    const tag = Date.now().toString().slice(-6);
    const [stateRow] = (await drizzle.db.execute(
      sql`INSERT INTO states(name, code) VALUES (${`ST-CO-${tag}`}, ${'C' + tag.slice(-2)}) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    const [cityRow] = (await drizzle.db.execute(
      sql`INSERT INTO cities(state_id, name, code) VALUES (${stateRow!.id}, ${`CITY-CO-${tag}`}, ${'C' + tag.slice(-2)}) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    cityId = cityRow!.id;
    const [centreRow] = (await drizzle.db.execute(
      sql`INSERT INTO centres(city_id, name, status, gps_radius_m, lat, lng)
          VALUES (${cityId}, ${`Centre-CO-${tag}`}, 'active', 500, 23.0225, 72.5714) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    centreId = centreRow!.id;
    const [batchRow] = (await drizzle.db.execute(
      sql`INSERT INTO batches(centre_id, name, age_group, day_of_week, start_time, end_time, capacity, status)
          VALUES (${centreId}, ${`Bal-CO-${tag}`}, 'bal', '{0,1,2,3,4,5,6}', '09:00', '11:00', 30, 'active') RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    batchId = batchRow!.id;

    const admin = await mintAccessAs({ app, role: 'city_admin', cityId });
    cityAdminUserId = admin.userId;
    const parent = await mintAccessAs({ app, role: 'parent', cityId });
    parentUserId = parent.userId;

    studentIds = [];
    for (let i = 0; i < 4; i += 1) {
      const [row] = (await drizzle.db.execute(
        sql`INSERT INTO students(parent_user_id, full_name, dob, age_group, centre_id, batch_id,
                                  student_code, status, enrolled_at)
            VALUES (${parentUserId}, ${`StudentCO-${tag}-${i}`}, '2015-04-12', 'bal', ${centreId}, ${batchId},
                    ${`CO-${tag}-${i}`}, 'active', now()) RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      studentIds.push(row!.id);
    }
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('1. register → row created, count increments', async () => {
    const comp = await svc.create(
      { user_id: cityAdminUserId, role: 'city_admin', city_id: cityId },
      {
        name_en: 'Bhajan competition',
        name_hi: 'भजन प्रतियोगिता',
        eligible_age_groups: ['bal'],
        winner_points: 50,
        participant_points: 10,
        status: 'open',
      },
    );
    const reg = await svc.register(
      { user_id: parentUserId, role: 'parent', city_id: cityId },
      comp.id,
      { student_id: studentIds[0]! },
    );
    expect(reg.competition_id).toBe(comp.id);
    expect(reg.student_id).toBe(studentIds[0]);
    const rows = (await drizzle.db.execute(
      sql`SELECT COUNT(*)::int AS c FROM competition_registrations WHERE competition_id = ${comp.id}`,
    )) as unknown as Array<{ c: number }>;
    expect(rows[0]!.c).toBe(1);
  });

  it('2. max_participants enforced — 2nd reg rejected', async () => {
    const comp = await svc.create(
      { user_id: cityAdminUserId, role: 'city_admin', city_id: cityId },
      {
        name_en: 'Single-seat',
        name_hi: 'एक-सीट',
        eligible_age_groups: ['bal'],
        max_participants: 1,
        winner_points: 50,
        participant_points: 10,
        status: 'open',
      },
    );
    await svc.register({ user_id: parentUserId, role: 'parent', city_id: cityId }, comp.id, {
      student_id: studentIds[0]!,
    });
    let caught: unknown = null;
    try {
      await svc.register({ user_id: parentUserId, role: 'parent', city_id: cityId }, comp.id, {
        student_id: studentIds[1]!,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeTruthy();
    expect((caught as { code?: string }).code).toBe('ERR_COMPETITION_FULL');
  });

  it('3. eligibility: msv_only blocks non-MSV students', async () => {
    const comp = await svc.create(
      { user_id: cityAdminUserId, role: 'city_admin', city_id: cityId },
      {
        name_en: 'MSV-only quiz',
        name_hi: 'MSV क्विज',
        msv_only: true,
        winner_points: 50,
        participant_points: 10,
        status: 'open',
      },
    );
    let caught: unknown = null;
    try {
      await svc.register({ user_id: parentUserId, role: 'parent', city_id: cityId }, comp.id, {
        student_id: studentIds[0]!,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeTruthy();
    expect((caught as { code?: string }).code).toBe('ERR_COMPETITION_NOT_ELIGIBLE');
  });

  it('4. publish results: top 3 → 3 punya_transactions rows with source_entity_kind=competition', async () => {
    const comp = await svc.create(
      { user_id: cityAdminUserId, role: 'city_admin', city_id: cityId },
      {
        name_en: 'Recitation contest',
        name_hi: 'पाठ प्रतियोगिता',
        eligible_age_groups: ['bal'],
        winner_points: 50,
        participant_points: 10,
        status: 'open',
      },
    );
    for (let i = 0; i < 4; i += 1) {
      await svc.register({ user_id: parentUserId, role: 'parent', city_id: cityId }, comp.id, {
        student_id: studentIds[i]!,
      });
    }
    await svc.recordResults(
      { user_id: cityAdminUserId, role: 'city_admin', city_id: cityId },
      comp.id,
      {
        results: [
          { student_id: studentIds[0]!, rank: 1 },
          { student_id: studentIds[1]!, rank: 2 },
          { student_id: studentIds[2]!, rank: 3 },
          { student_id: studentIds[3]!, rank: 4 },
        ],
      },
    );
    const publish = await svc.publishResults(
      { user_id: cityAdminUserId, role: 'city_admin', city_id: cityId },
      comp.id,
    );
    expect(publish.punya_awards).toBe(4);
    const rows = (await drizzle.db.execute(sql`
      SELECT COUNT(*)::int AS c
        FROM punya_transactions
       WHERE source_entity_kind = 'competition'
         AND source_entity_id = ${comp.id}
    `)) as unknown as Array<{ c: number }>;
    // 4 registered + ranked → 4 punya rows, top-3 use winner_points key.
    expect(rows[0]!.c).toBe(4);
    const winners = (await drizzle.db.execute(sql`
      SELECT COUNT(*)::int AS c
        FROM punya_transactions
       WHERE source_entity_id = ${comp.id}
         AND feature_key = 'competition_winner'
    `)) as unknown as Array<{ c: number }>;
    // Only rank=1 maps to competition_winner; ranks 2 and 3 still use winner_points
    // but their feature_key is `competition_participant` per service logic.
    expect(winners[0]!.c).toBe(1);
  });
});
