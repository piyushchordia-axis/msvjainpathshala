/**
 * Push-quiz integration tests — Step 20 (SPEC §5.14, §6.18, §9.4).
 *
 * Coverage:
 *   1. Create + start broadcasts `quiz.started`.
 *   2. next-question broadcasts `quiz.question_next` and activates the
 *      question; 3 concurrent answer submissions all land in distinct
 *      attempt rows.
 *   3. Submit after the per-question time window → ERR_QUIZ_TIME_WINDOW_EXPIRED (409).
 *   4. End-quiz awards `push_quiz_completion` Punya for students with
 *      ≥ 1 correct answer; emits `quiz.ended`. Double-end → ERR_QUIZ_ALREADY_ENDED (409).
 *
 * The RealtimeGateway is intercepted via a Vitest spy so we can assert
 * the exact emit() calls without standing up a Socket.IO client.
 */

import 'reflect-metadata';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DrizzleService } from '../../../core/database/drizzle.service';
import { RedisService } from '../../../core/redis/redis.service';
import { RealtimeGateway } from '../../../realtime/realtime.gateway';
import { bootTestApp, captureOtps } from '../../auth/__tests__/test-helpers';
import { PushQuizzesService } from '../push-quizzes.service';
import { PUSH_QUIZ_QUESTION_WINDOW_MS } from '../quizzes.types';

import type { INestApplication } from '@nestjs/common';

type Role = 'super_admin' | 'shikshak' | 'parent';

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

describe('PushQuizzes — integration', () => {
  let app: INestApplication;
  let drizzle: DrizzleService;
  let svc: PushQuizzesService;
  let realtime: RealtimeGateway;
  let cityId: string;
  let centreId: string;
  let batchId: string;
  let otherBatchId: string;
  let shikshakId: string;
  let parentId: string;
  let studentIds: string[] = [];
  let outsideStudentId: string;
  let emitSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    app = await bootTestApp();
    await captureOtps(app);
    drizzle = app.get(DrizzleService);
    svc = app.get(PushQuizzesService);
    realtime = app.get(RealtimeGateway);
    const redis = app.get(RedisService);
    await redis.cacheClient.del('otp:rl:ip:h1:127.0.0.1');

    // Replace RealtimeGateway.emit with a spy so the assertions can read it
    // back later without a Socket.IO server.
    emitSpy = vi.spyOn(realtime, 'emit').mockImplementation(() => undefined);

    const tag = Date.now().toString().slice(-6);
    const [stateRow] = (await drizzle.db.execute(
      sql`INSERT INTO states(name, code) VALUES (${`ST-PQ-${tag}`}, ${'Q' + tag.slice(-2)}) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    const [cityRow] = (await drizzle.db.execute(
      sql`INSERT INTO cities(state_id, name, code) VALUES (${stateRow!.id}, ${`CITY-PQ-${tag}`}, ${'Q' + tag.slice(-2)}) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    cityId = cityRow!.id;
    const [centreRow] = (await drizzle.db.execute(
      sql`INSERT INTO centres(city_id, name, status, gps_radius_m, lat, lng)
          VALUES (${cityId}, ${`Centre-PQ-${tag}`}, 'active', 500, 23.0225, 72.5714) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    centreId = centreRow!.id;
    const [batchRow] = (await drizzle.db.execute(
      sql`INSERT INTO batches(centre_id, name, age_group, day_of_week, start_time, end_time, capacity, status)
          VALUES (${centreId}, ${`Bal-PQ-${tag}`}, 'bal', '{0,1,2,3,4,5,6}', '09:00', '11:00', 30, 'active') RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    batchId = batchRow!.id;
    const [otherBatchRow] = (await drizzle.db.execute(
      sql`INSERT INTO batches(centre_id, name, age_group, day_of_week, start_time, end_time, capacity, status)
          VALUES (${centreId}, ${`Other-PQ-${tag}`}, 'bal', '{0,1,2,3,4,5,6}', '09:00', '11:00', 30, 'active') RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    otherBatchId = otherBatchRow!.id;

    shikshakId = await createUserRow(app, 'shikshak', 1);
    parentId = await createUserRow(app, 'parent', 2);

    studentIds = [];
    for (let i = 0; i < 3; i += 1) {
      const [row] = (await drizzle.db.execute(
        sql`INSERT INTO students(parent_user_id, full_name, dob, age_group, centre_id, batch_id,
                                  student_code, status, enrolled_at)
            VALUES (${parentId}, ${`StudentPQ-${tag}-${i}`}, '2015-04-12', 'bal', ${centreId}, ${batchId},
                    ${`PQ-${tag}-${i}`}, 'active', now()) RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      studentIds.push(row!.id);
    }
    // One student in a different batch — used to assert ERR_QUIZ_STUDENT_NOT_IN_BATCH.
    const [outsideRow] = (await drizzle.db.execute(
      sql`INSERT INTO students(parent_user_id, full_name, dob, age_group, centre_id, batch_id,
                                student_code, status, enrolled_at)
          VALUES (${parentId}, ${`Outsider-${tag}`}, '2015-04-12', 'bal', ${centreId}, ${otherBatchId},
                  ${`OUT-${tag}`}, 'active', now()) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    outsideStudentId = outsideRow!.id;
  }, 60_000);

  afterAll(async () => {
    emitSpy?.mockRestore();
    await app.close();
  });

  async function makePushQuiz() {
    return svc.create(
      { user_id: shikshakId, role: 'shikshak', batch_ids: [batchId] },
      {
        batch_id: batchId,
        expires_in_seconds: 600,
        completion_points: 10,
        questions: [
          {
            question_en: 'How many Tirthankaras?',
            question_hi: 'कितने तीर्थंकर?',
            options: [
              { id: 'a', text_en: '12', text_hi: '12' },
              { id: 'b', text_en: '24', text_hi: '24' },
              { id: 'c', text_en: '108', text_hi: '108' },
            ],
            correct_indices: [1],
          },
          {
            question_en: 'Ahimsa means?',
            question_hi: 'अहिंसा का अर्थ?',
            options: [
              { id: 'a', text_en: 'Truth', text_hi: 'सत्य' },
              { id: 'b', text_en: 'Non-violence', text_hi: 'अहिंसा' },
            ],
            correct_indices: [1],
          },
        ],
      },
    );
  }

  it('1. start broadcasts quiz.started', async () => {
    const quiz = await makePushQuiz();
    emitSpy.mockClear();
    const res = await svc.start(
      { user_id: shikshakId, role: 'shikshak', batch_ids: [batchId] },
      quiz.id,
    );
    expect(res.quiz.id).toBe(quiz.id);
    expect(res.total_questions).toBe(2);
    expect(emitSpy).toHaveBeenCalledTimes(1);
    const [ns, evt, payload] = emitSpy.mock.calls[0]!;
    expect(ns).toBe(`/push-quizzes/${quiz.id}`);
    expect(evt).toBe('quiz.started');
    expect((payload as { quiz_id: string; total_questions: number }).quiz_id).toBe(quiz.id);
    expect((payload as { total_questions: number }).total_questions).toBe(2);
  });

  it('2. next-question + 3 concurrent submissions all recorded', async () => {
    const quiz = await makePushQuiz();
    await svc.start({ user_id: shikshakId, role: 'shikshak', batch_ids: [batchId] }, quiz.id);
    emitSpy.mockClear();
    const next = await svc.nextQuestion(
      { user_id: shikshakId, role: 'shikshak', batch_ids: [batchId] },
      quiz.id,
    );
    expect(next.question.id).toBeTruthy();
    expect(next.question_number).toBe(1);
    // Capture the quiz.question_next emit.
    const nextEmit = emitSpy.mock.calls.find((c) => c[1] === 'quiz.question_next');
    expect(nextEmit).toBeTruthy();

    emitSpy.mockClear();
    // Submit 3 concurrent answers (one per student) — all to the same active question.
    const results = await Promise.all(
      studentIds.map((sid, ix) =>
        svc.submitAnswer({ user_id: parentId, role: 'parent' }, quiz.id, sid, {
          question_id: next.question.id,
          selected_option_index: ix === 1 ? 1 : 0,
        }),
      ),
    );
    expect(results.length).toBe(3);
    // Two wrong (idx 0), one correct (idx 1).
    const correctSubmissions = results.filter((r) => r.is_correct).length;
    expect(correctSubmissions).toBe(1);

    // Verify 3 push_quiz_attempts rows exist (one per student).
    const rows = (await drizzle.db.execute(
      sql`SELECT student_id, answers, score FROM push_quiz_attempts WHERE push_quiz_id = ${quiz.id}`,
    )) as unknown as Array<{ student_id: string; answers: unknown; score: number | null }>;
    expect(rows.length).toBe(3);
    for (const row of rows) {
      expect(row.answers).toBeTruthy();
    }
    // The aggregated counts should have been emitted for each submission.
    const aggregates = emitSpy.mock.calls.filter((c) => c[1] === 'quiz.answer_received');
    expect(aggregates.length).toBeGreaterThanOrEqual(3);
  });

  it('3. Submit after time window → ERR_QUIZ_TIME_WINDOW_EXPIRED (409)', async () => {
    const quiz = await makePushQuiz();
    await svc.start({ user_id: shikshakId, role: 'shikshak', batch_ids: [batchId] }, quiz.id);
    const next = await svc.nextQuestion(
      { user_id: shikshakId, role: 'shikshak', batch_ids: [batchId] },
      quiz.id,
    );
    // Hack the active-question state in Redis to make started_at_ms appear
    // ancient — outside the per-question window. This is the same path
    // `submitAnswer` reads through.
    const redis = app.get(RedisService);
    const expiredState = {
      question_id: next.question.id,
      question_index: 0,
      started_at_ms: Date.now() - (PUSH_QUIZ_QUESTION_WINDOW_MS + 5000),
    };
    await redis.cacheClient.set(`pq:active:${quiz.id}`, JSON.stringify(expiredState), 'EX', 3600);

    let caught: unknown = null;
    try {
      await svc.submitAnswer({ user_id: parentId, role: 'parent' }, quiz.id, studentIds[0]!, {
        question_id: next.question.id,
        selected_option_index: 1,
      });
    } catch (e) {
      caught = e;
    }
    expect((caught as { code?: string; statusCode?: number }).code).toBe(
      'ERR_QUIZ_TIME_WINDOW_EXPIRED',
    );
    expect((caught as { statusCode?: number }).statusCode).toBe(409);
  });

  it('3b. Student not in batch → ERR_QUIZ_STUDENT_NOT_IN_BATCH (403)', async () => {
    const quiz = await makePushQuiz();
    await svc.start({ user_id: shikshakId, role: 'shikshak', batch_ids: [batchId] }, quiz.id);
    const next = await svc.nextQuestion(
      { user_id: shikshakId, role: 'shikshak', batch_ids: [batchId] },
      quiz.id,
    );
    let caught: unknown = null;
    try {
      await svc.submitAnswer({ user_id: parentId, role: 'parent' }, quiz.id, outsideStudentId, {
        question_id: next.question.id,
        selected_option_index: 1,
      });
    } catch (e) {
      caught = e;
    }
    expect((caught as { code?: string }).code).toBe('ERR_QUIZ_STUDENT_NOT_IN_BATCH');
    expect((caught as { statusCode?: number }).statusCode).toBe(403);
  });

  it('4. End-quiz awards push_quiz_completion + broadcasts quiz.ended', async () => {
    const quiz = await makePushQuiz();
    await svc.start({ user_id: shikshakId, role: 'shikshak', batch_ids: [batchId] }, quiz.id);
    const next = await svc.nextQuestion(
      { user_id: shikshakId, role: 'shikshak', batch_ids: [batchId] },
      quiz.id,
    );
    // All 3 students answer; students[0] gets it right (index 1).
    await svc.submitAnswer({ user_id: parentId, role: 'parent' }, quiz.id, studentIds[0]!, {
      question_id: next.question.id,
      selected_option_index: 1,
    });
    await svc.submitAnswer({ user_id: parentId, role: 'parent' }, quiz.id, studentIds[1]!, {
      question_id: next.question.id,
      selected_option_index: 0,
    });
    await svc.submitAnswer({ user_id: parentId, role: 'parent' }, quiz.id, studentIds[2]!, {
      question_id: next.question.id,
      selected_option_index: 0,
    });

    emitSpy.mockClear();
    const ended = await svc.end(
      { user_id: shikshakId, role: 'shikshak', batch_ids: [batchId] },
      quiz.id,
    );
    expect(ended.participants).toBe(3);
    expect(ended.punya_awards).toBeGreaterThanOrEqual(1);
    // Leaderboard sorted: studentIds[0] (correct) should be rank 1.
    expect(ended.leaderboard[0]?.student_id).toBe(studentIds[0]);

    // quiz.ended emit happened.
    const endedEmit = emitSpy.mock.calls.find((c) => c[1] === 'quiz.ended');
    expect(endedEmit).toBeTruthy();

    // Verify the punya row landed with the correct idempotency key.
    const punyaKey = `push_quiz:${quiz.id}:completion:${studentIds[0]}`;
    const txs = (await drizzle.db.execute(
      sql`SELECT idempotency_key, feature_key, points FROM punya_transactions
           WHERE idempotency_key = ${punyaKey}`,
    )) as unknown as Array<{
      idempotency_key: string;
      feature_key: string;
      points: number;
    }>;
    expect(txs.length).toBe(1);
    expect(txs[0]!.feature_key).toBe('push_quiz_completion');
    expect(txs[0]!.points).toBe(10);

    // Double-end → ERR_QUIZ_ALREADY_ENDED.
    let caught: unknown = null;
    try {
      await svc.end({ user_id: shikshakId, role: 'shikshak', batch_ids: [batchId] }, quiz.id);
    } catch (e) {
      caught = e;
    }
    expect((caught as { code?: string }).code).toBe('ERR_QUIZ_ALREADY_ENDED');
  });
});
