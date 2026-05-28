/**
 * Curriculum integration tests — Step 19 (SPEC §5.13, §6.16, CLAUDE.md Q2).
 *
 * Coverage:
 *   1. super_admin can create an MSV curriculum.
 *   2. city_admin cannot — SERVICE LAYER returns ERR_RBAC_FORBIDDEN_MSV_CURRICULUM
 *      (Q2 enforcement). 403, even though the controller's role guard would
 *      let a Standard create through.
 *   3. Assign one Standard + one MSV to a batch → both succeed.
 *      Second active Standard on the same batch → ERR_CURRICULUM_ASSIGNMENT_CONFLICT.
 *   4. progressUpsert(level='mastered') awards Punya with idempotency key
 *      `curriculum:{student}:{item}`.
 */

import 'reflect-metadata';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DrizzleService } from '../../../core/database/drizzle.service';
import { RedisService } from '../../../core/redis/redis.service';
import { bootTestApp, captureOtps } from '../../auth/__tests__/test-helpers';
import { CurriculumService } from '../curriculum.service';

import type { INestApplication } from '@nestjs/common';

type Role = 'super_admin' | 'city_admin' | 'shikshak' | 'parent';

/**
 * Insert a `users` row directly (no OTP send) — this test calls the service
 * surface so we only ever need user_ids, not real access tokens. Avoids
 * burning through the per-IP OTP rate-limit.
 */
async function createUserRow(
  app: INestApplication,
  role: Role,
  phoneSuffix: number,
): Promise<string> {
  const drizzle = app.get(DrizzleService);
  const phone = `+91900${(Date.now() % 100000).toString().padStart(5, '0')}${phoneSuffix
    .toString()
    .padStart(2, '0')}`.slice(0, 13);
  const [row] = (await drizzle.db.execute(
    sql`INSERT INTO users(phone, role, full_name, preferred_language)
        VALUES (${phone}, ${role}, ${`Test ${role}`}, 'en') RETURNING id`,
  )) as unknown as Array<{ id: string }>;
  return row!.id;
}

describe('Curriculum — integration', () => {
  let app: INestApplication;
  let drizzle: DrizzleService;
  let svc: CurriculumService;
  let cityId: string;
  let centreId: string;
  let batchId: string;
  let superId: string;
  let cityAdminId: string;
  let shikshakId: string;
  let parentId: string;
  let studentId: string;

  beforeAll(async () => {
    app = await bootTestApp();
    await captureOtps(app);
    drizzle = app.get(DrizzleService);
    svc = app.get(CurriculumService);
    // Clear the per-IP OTP rate-limit ZSet (tests share 127.0.0.1).
    const redis = app.get(RedisService);
    await redis.cacheClient.del('otp:rl:ip:h1:127.0.0.1');

    const tag = Date.now().toString().slice(-6);
    const [stateRow] = (await drizzle.db.execute(
      sql`INSERT INTO states(name, code) VALUES (${`ST-CR-${tag}`}, ${'R' + tag.slice(-2)}) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    const [cityRow] = (await drizzle.db.execute(
      sql`INSERT INTO cities(state_id, name, code) VALUES (${stateRow!.id}, ${`CITY-CR-${tag}`}, ${'R' + tag.slice(-2)}) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    cityId = cityRow!.id;
    const [centreRow] = (await drizzle.db.execute(
      sql`INSERT INTO centres(city_id, name, status, gps_radius_m, lat, lng)
          VALUES (${cityId}, ${`Centre-CR-${tag}`}, 'active', 500, 23.0225, 72.5714) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    centreId = centreRow!.id;
    const [batchRow] = (await drizzle.db.execute(
      sql`INSERT INTO batches(centre_id, name, age_group, day_of_week, start_time, end_time, capacity, status)
          VALUES (${centreId}, ${`Bal-CR-${tag}`}, 'bal', '{0,1,2,3,4,5,6}', '09:00', '11:00', 30, 'active') RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    batchId = batchRow!.id;

    superId = await createUserRow(app, 'super_admin', 1);
    cityAdminId = await createUserRow(app, 'city_admin', 2);
    shikshakId = await createUserRow(app, 'shikshak', 3);
    parentId = await createUserRow(app, 'parent', 4);

    const [stu] = (await drizzle.db.execute(
      sql`INSERT INTO students(parent_user_id, full_name, dob, age_group, centre_id, batch_id,
                                student_code, status, enrolled_at)
          VALUES (${parentId}, ${`StudentCR-${tag}`}, '2015-04-12', 'bal', ${centreId}, ${batchId},
                  ${`CR-${tag}`}, 'active', now()) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    studentId = stu!.id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('1. super_admin can create an MSV curriculum', async () => {
    const c = await svc.createCurriculum(
      { user_id: superId, role: 'super_admin' },
      { kind: 'msv', name: 'MSV master 2026', status: 'active' },
    );
    expect(c.kind).toBe('msv');
    expect(c.city_id).toBeNull();
  });

  it('2. city_admin cannot create an MSV curriculum (Q2 service-layer 403)', async () => {
    let caught: unknown = null;
    try {
      await svc.createCurriculum(
        { user_id: cityAdminId, role: 'city_admin', city_id: cityId },
        { kind: 'msv', name: 'Forbidden MSV', status: 'active' },
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeTruthy();
    expect((caught as { code?: string; statusCode?: number }).code).toBe(
      'ERR_RBAC_FORBIDDEN_MSV_CURRICULUM',
    );
    expect((caught as { statusCode?: number }).statusCode).toBe(403);
  });

  it('3. one active Standard + one active MSV per batch enforced', async () => {
    const standard1 = await svc.createCurriculum(
      { user_id: cityAdminId, role: 'city_admin', city_id: cityId },
      { kind: 'standard', name: 'Std A', status: 'active' },
    );
    const standard2 = await svc.createCurriculum(
      { user_id: cityAdminId, role: 'city_admin', city_id: cityId },
      { kind: 'standard', name: 'Std B', status: 'active' },
    );
    const msv = await svc.createCurriculum(
      { user_id: superId, role: 'super_admin' },
      { kind: 'msv', name: 'MSV-A', status: 'active' },
    );

    await svc.assign({ user_id: cityAdminId, role: 'city_admin', city_id: cityId }, standard1.id, {
      batch_id: batchId,
    });
    // MSV on same batch — should succeed (different kind).
    await svc.assign({ user_id: superId, role: 'super_admin' }, msv.id, { batch_id: batchId });
    // Second Standard on same batch — should be rejected.
    let caught: unknown = null;
    try {
      await svc.assign(
        { user_id: cityAdminId, role: 'city_admin', city_id: cityId },
        standard2.id,
        { batch_id: batchId },
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeTruthy();
    expect((caught as { code?: string }).code).toBe('ERR_CURRICULUM_ASSIGNMENT_CONFLICT');
  });

  it('4. progressUpsert(level=mastered) awards Punya with `curriculum:` idempotency key', async () => {
    const c = await svc.createCurriculum(
      { user_id: cityAdminId, role: 'city_admin', city_id: cityId },
      { kind: 'standard', name: 'Progress test', status: 'active' },
    );
    const section = await svc.addSection(
      { user_id: cityAdminId, role: 'city_admin', city_id: cityId },
      c.id,
      { title_en: 'Section 1', title_hi: 'खंड 1', order_index: 0 },
    );
    const item = await svc.addItem(
      { user_id: cityAdminId, role: 'city_admin', city_id: cityId },
      c.id,
      {
        section_id: section.id,
        title_en: 'Recite Navkar 5x',
        title_hi: 'णमोकार 5 बार बोलें',
        order_index: 0,
      },
    );

    const before = (await drizzle.db.execute(
      sql`SELECT COALESCE(total_points, 0)::int AS p FROM punya_balances WHERE student_id = ${studentId}`,
    )) as unknown as Array<{ p: number }>;
    const beforePts = before[0]?.p ?? 0;

    const row = await svc.upsertProgress(
      {
        user_id: shikshakId,
        role: 'shikshak',
        city_id: cityId,
        centre_ids: [centreId],
        batch_ids: [batchId],
      },
      studentId,
      { item_id: item.id, level: 'mastered', note: 'Excellent!' },
    );
    expect(row.level).toBe('mastered');

    const idemKey = `curriculum:${studentId}:${item.id}`;
    const txs = (await drizzle.db.execute(
      sql`SELECT COUNT(*)::int AS c FROM punya_transactions WHERE idempotency_key = ${idemKey}`,
    )) as unknown as Array<{ c: number }>;
    expect(txs[0]!.c).toBe(1);

    const after = (await drizzle.db.execute(
      sql`SELECT total_points::int AS p FROM punya_balances WHERE student_id = ${studentId}`,
    )) as unknown as Array<{ p: number }>;
    expect(after[0]!.p).toBe(beforePts + 20);

    // Idempotent: re-upserting mastered (same student/item) should NOT
    // double-credit.
    await svc.upsertProgress(
      {
        user_id: shikshakId,
        role: 'shikshak',
        city_id: cityId,
        centre_ids: [centreId],
        batch_ids: [batchId],
      },
      studentId,
      { item_id: item.id, level: 'mastered' },
    );
    const after2 = (await drizzle.db.execute(
      sql`SELECT total_points::int AS p FROM punya_balances WHERE student_id = ${studentId}`,
    )) as unknown as Array<{ p: number }>;
    expect(after2[0]!.p).toBe(beforePts + 20);
  });
});
