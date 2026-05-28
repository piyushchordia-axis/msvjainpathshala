/**
 * Exams integration tests — Step 19 (SPEC §5.14, §6.17, §8.9).
 *
 * Coverage:
 *   1. Generate OTP + start attempt with correct OTP → status='in_progress',
 *      OTP_verified_at recorded.
 *   2. Wrong OTP → ERR_EXAM_OTP_INVALID (401).
 *   3. OTP after 30-minute window → ERR_EXAM_OTP_WINDOW_EXPIRED (409).
 *   4. Submit auto-grades MCQ correctly; final score appears immediately.
 *   5. Release results → ranked attempts get Punya `exam:{exam_id}:completion:*`
 *      and top-3 get `exam:{exam_id}:top:*`.
 */

import 'reflect-metadata';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DrizzleService } from '../../../core/database/drizzle.service';
import { RedisService } from '../../../core/redis/redis.service';
import { bootTestApp, captureOtps } from '../../auth/__tests__/test-helpers';
import { ExamsService } from '../exams.service';

import type { INestApplication } from '@nestjs/common';

type Role = 'super_admin' | 'city_admin' | 'parent';

/** Insert a `users` row directly — service-only test, no JWT needed. */
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

describe('Exams — integration', () => {
  let app: INestApplication;
  let drizzle: DrizzleService;
  let svc: ExamsService;
  let cityId: string;
  let centreId: string;
  let batchId: string;
  let cityAdminId: string;
  let parentId: string;
  let studentIds: string[] = [];

  beforeAll(async () => {
    app = await bootTestApp();
    await captureOtps(app);
    drizzle = app.get(DrizzleService);
    svc = app.get(ExamsService);
    const redis = app.get(RedisService);
    await redis.cacheClient.del('otp:rl:ip:h1:127.0.0.1');

    const tag = Date.now().toString().slice(-6);
    const [stateRow] = (await drizzle.db.execute(
      sql`INSERT INTO states(name, code) VALUES (${`ST-EX-${tag}`}, ${'X' + tag.slice(-2)}) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    const [cityRow] = (await drizzle.db.execute(
      sql`INSERT INTO cities(state_id, name, code) VALUES (${stateRow!.id}, ${`CITY-EX-${tag}`}, ${'X' + tag.slice(-2)}) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    cityId = cityRow!.id;
    const [centreRow] = (await drizzle.db.execute(
      sql`INSERT INTO centres(city_id, name, status, gps_radius_m, lat, lng)
          VALUES (${cityId}, ${`Centre-EX-${tag}`}, 'active', 500, 23.0225, 72.5714) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    centreId = centreRow!.id;
    const [batchRow] = (await drizzle.db.execute(
      sql`INSERT INTO batches(centre_id, name, age_group, day_of_week, start_time, end_time, capacity, status)
          VALUES (${centreId}, ${`Bal-EX-${tag}`}, 'bal', '{0,1,2,3,4,5,6}', '09:00', '11:00', 30, 'active') RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    batchId = batchRow!.id;

    cityAdminId = await createUserRow(app, 'city_admin', 1);
    parentId = await createUserRow(app, 'parent', 2);

    studentIds = [];
    for (let i = 0; i < 3; i += 1) {
      const [row] = (await drizzle.db.execute(
        sql`INSERT INTO students(parent_user_id, full_name, dob, age_group, centre_id, batch_id,
                                  student_code, status, enrolled_at)
            VALUES (${parentId}, ${`StudentEX-${tag}-${i}`}, '2015-04-12', 'bal', ${centreId}, ${batchId},
                    ${`EX-${tag}-${i}`}, 'active', now()) RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      studentIds.push(row!.id);
    }
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  async function makeExam(
    opts: {
      startsAgoMs?: number; // how long ago the window started
      endsFromNowMs?: number;
    } = {},
  ) {
    const startsAgo = opts.startsAgoMs ?? 5 * 60 * 1000; // window opened 5min ago
    const endsFromNow = opts.endsFromNowMs ?? 60 * 60 * 1000; // ends in 60min
    const now = Date.now();
    const created = await svc.create(
      { user_id: cityAdminId, role: 'city_admin', city_id: cityId },
      {
        title_en: `Test exam ${Math.random()}`,
        title_hi: 'परीक्षा',
        window_start: new Date(now - startsAgo).toISOString(),
        window_end: new Date(now + endsFromNow).toISOString(),
        max_attempts: 1,
        pass_mark: 1,
        completion_points: 20,
        top_score_points: 50,
        show_rank: true,
        questions: [
          {
            question_type: 'mcq_single',
            question_en: 'Pick A',
            question_hi: 'A चुनें',
            marks: 5,
            order_index: 0,
            options: [
              { label_en: 'A', label_hi: 'क', is_correct: true, order_index: 0 },
              { label_en: 'B', label_hi: 'ख', is_correct: false, order_index: 1 },
            ],
          },
          {
            question_type: 'true_false',
            question_en: 'Sun rises in the east',
            question_hi: 'सूरज पूर्व में उगता है',
            marks: 5,
            order_index: 1,
            options: [
              { label_en: 'True', label_hi: 'सत्य', is_correct: true, order_index: 0 },
              { label_en: 'False', label_hi: 'असत्य', is_correct: false, order_index: 1 },
            ],
          },
        ],
      },
    );
    return created.exam;
  }

  it('1. start with correct OTP → in_progress + otp_verified_at set', async () => {
    const exam = await makeExam();
    const { exam_otp } = await svc.generateOtp(
      { user_id: cityAdminId, role: 'city_admin', city_id: cityId },
      exam.id,
    );
    const out = await svc.startAttempt(
      { user_id: parentId, role: 'parent', city_id: cityId },
      exam.id,
      { student_id: studentIds[0]!, exam_otp },
    );
    expect(out.attempt.status).toBe('in_progress');
    expect(out.attempt.otp_verified_at).toBeTruthy();
    expect(out.questions.length).toBe(2);
    // is_correct must be stripped from option payload going to parent.
    for (const q of out.questions) {
      for (const o of q.options) expect(o.is_correct).toBe(false);
    }
  });

  it('2. wrong OTP → ERR_EXAM_OTP_INVALID (401)', async () => {
    const exam = await makeExam();
    await svc.generateOtp({ user_id: cityAdminId, role: 'city_admin', city_id: cityId }, exam.id);
    let caught: unknown = null;
    try {
      await svc.startAttempt({ user_id: parentId, role: 'parent', city_id: cityId }, exam.id, {
        student_id: studentIds[1]!,
        exam_otp: '000000',
      });
    } catch (e) {
      caught = e;
    }
    expect((caught as { code?: string; statusCode?: number }).code).toBe('ERR_EXAM_OTP_INVALID');
    expect((caught as { statusCode?: number }).statusCode).toBe(401);
  });

  it('3. OTP after 30-minute window → ERR_EXAM_OTP_WINDOW_EXPIRED (409)', async () => {
    // Window started 31 minutes ago — OTP window has expired but window
    // is still open.
    const exam = await makeExam({ startsAgoMs: 31 * 60 * 1000, endsFromNowMs: 30 * 60 * 1000 });
    const { exam_otp } = await svc.generateOtp(
      { user_id: cityAdminId, role: 'city_admin', city_id: cityId },
      exam.id,
    );
    let caught: unknown = null;
    try {
      await svc.startAttempt({ user_id: parentId, role: 'parent', city_id: cityId }, exam.id, {
        student_id: studentIds[2]!,
        exam_otp,
      });
    } catch (e) {
      caught = e;
    }
    expect((caught as { code?: string; statusCode?: number }).code).toBe(
      'ERR_EXAM_OTP_WINDOW_EXPIRED',
    );
    expect((caught as { statusCode?: number }).statusCode).toBe(409);
  });

  it('4. submit auto-grades MCQ correctly; final score immediate', async () => {
    const exam = await makeExam();
    const { exam_otp } = await svc.generateOtp(
      { user_id: cityAdminId, role: 'city_admin', city_id: cityId },
      exam.id,
    );
    const started = await svc.startAttempt(
      { user_id: parentId, role: 'parent', city_id: cityId },
      exam.id,
      { student_id: studentIds[0]!, exam_otp },
    );
    // Look up real option ids (server stripped is_correct, so we hit the DB).
    const opts = (await drizzle.db.execute(sql`
      SELECT q.id AS qid, q.question_type AS qtype, o.id AS oid, o.is_correct AS correct
      FROM exam_questions q JOIN exam_question_options o ON o.question_id = q.id
      WHERE q.exam_id = ${exam.id}
      ORDER BY q.order_index, o.order_index
    `)) as unknown as Array<{ qid: string; qtype: string; oid: string; correct: boolean }>;
    // For each question, pick the correct option.
    for (const q of started.questions) {
      const correct = opts.find((o) => o.qid === q.question.id && o.correct);
      if (!correct) throw new Error('no correct option found');
      await svc.saveAnswer(
        { user_id: parentId, role: 'parent', city_id: cityId },
        started.attempt.id,
        { question_id: q.question.id, selected_option_ids: [correct.oid] },
      );
    }
    const submitted = await svc.submitAttempt(
      { user_id: parentId, role: 'parent', city_id: cityId },
      started.attempt.id,
    );
    expect(submitted.auto_score).toBe(10); // 5 + 5
    expect(submitted.manual_pending).toBe(false);
    expect(submitted.attempt.score).toBe(10);
    expect(submitted.attempt.status).toBe('graded');
  });

  it('5. release results → completion + top punya rows; pushes enqueued', async () => {
    const exam = await makeExam();
    const { exam_otp } = await svc.generateOtp(
      { user_id: cityAdminId, role: 'city_admin', city_id: cityId },
      exam.id,
    );
    // Student 1 — perfect score.
    const a1 = await svc.startAttempt(
      { user_id: parentId, role: 'parent', city_id: cityId },
      exam.id,
      { student_id: studentIds[0]!, exam_otp },
    );
    const opts = (await drizzle.db.execute(sql`
      SELECT q.id AS qid, q.question_type AS qtype, o.id AS oid, o.is_correct AS correct
      FROM exam_questions q JOIN exam_question_options o ON o.question_id = q.id
      WHERE q.exam_id = ${exam.id}
      ORDER BY q.order_index, o.order_index
    `)) as unknown as Array<{ qid: string; qtype: string; oid: string; correct: boolean }>;
    for (const q of a1.questions) {
      const correct = opts.find((o) => o.qid === q.question.id && o.correct);
      await svc.saveAnswer({ user_id: parentId, role: 'parent', city_id: cityId }, a1.attempt.id, {
        question_id: q.question.id,
        selected_option_ids: [correct!.oid],
      });
    }
    await svc.submitAttempt({ user_id: parentId, role: 'parent', city_id: cityId }, a1.attempt.id);

    const released = await svc.releaseResults(
      { user_id: cityAdminId, role: 'city_admin', city_id: cityId },
      exam.id,
    );
    expect(released.ranks_emitted).toBe(1);

    const compKey = `exam:${exam.id}:completion:${studentIds[0]}`;
    const topKey = `exam:${exam.id}:top:${studentIds[0]}`;
    const txs = (await drizzle.db.execute(
      sql`SELECT idempotency_key, points, feature_key FROM punya_transactions
           WHERE idempotency_key IN (${compKey}, ${topKey})
           ORDER BY idempotency_key`,
    )) as unknown as Array<{
      idempotency_key: string;
      points: number;
      feature_key: string;
    }>;
    // Both rows should exist (completion=20, top=50).
    expect(txs.length).toBe(2);
    const byKey = new Map(txs.map((r) => [r.idempotency_key, r]));
    expect(byKey.get(compKey)?.points).toBe(20);
    expect(byKey.get(compKey)?.feature_key).toBe('exam_completion');
    expect(byKey.get(topKey)?.points).toBe(50);
    expect(byKey.get(topKey)?.feature_key).toBe('exam_top_score');

    // Re-release should now be ERR_EXAM_RESULTS_ALREADY_RELEASED.
    let caught: unknown = null;
    try {
      await svc.releaseResults(
        { user_id: cityAdminId, role: 'city_admin', city_id: cityId },
        exam.id,
      );
    } catch (e) {
      caught = e;
    }
    expect((caught as { code?: string }).code).toBe('ERR_EXAM_RESULTS_ALREADY_RELEASED');
  });
});
