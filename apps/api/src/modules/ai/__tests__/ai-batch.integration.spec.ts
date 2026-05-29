/**
 * AI batch + HMAC guard integration tests — Step 21.
 *
 * Coverage:
 *   1. POST /v1/questions/ai-batch without HMAC headers → 401.
 *   2. POST with a bad signature → 401.
 *   3. POST with valid HMAC + valid body → 201 and questions appear in
 *      the DB with ai_review_status='pending_review'. ai_generation_jobs
 *      row flips to 'ready' with the resulting question ids.
 *
 * The guard short-circuits when `AI_SERVICE_HMAC_SECRET` is empty so we
 * set it explicitly here via process.env before boot.
 */

import 'reflect-metadata';
import { createHmac } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DrizzleService } from '../../../core/database/drizzle.service';
import { bootTestApp, captureOtps, makeAgent } from '../../auth/__tests__/test-helpers';

import type { INestApplication } from '@nestjs/common';

const SHARED_SECRET = 'step21-ai-batch-test-secret';

async function createSuperAdminAndJob(
  app: INestApplication,
  marker: number,
): Promise<{ jobId: string }> {
  const drizzle = app.get(DrizzleService);
  const phone = `+91900${(Date.now() % 100000).toString().padStart(5, '0')}${marker
    .toString()
    .padStart(2, '0')}`.slice(0, 13);
  const [u] = (await drizzle.db.execute(
    sql`INSERT INTO users(phone, role, full_name, preferred_language)
        VALUES (${phone}, 'super_admin', 'AI super', 'en') RETURNING id`,
  )) as unknown as Array<{ id: string }>;
  const [j] = (await drizzle.db.execute(
    sql`INSERT INTO ai_generation_jobs(actor_user_id, topic, age_group, language, count, status)
        VALUES (${u!.id}, 'Tirthankaras', 'kishor', 'en', 3, 'running') RETURNING id`,
  )) as unknown as Array<{ id: string }>;
  return { jobId: j!.id };
}

function signed(body: object): {
  raw: string;
  signature: string;
  timestamp: string;
} {
  const raw = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac('sha256', SHARED_SECRET).update(raw).digest('hex');
  return { raw, signature, timestamp };
}

describe('AI batch — integration (Step 21)', () => {
  let app: INestApplication;
  let agent: ReturnType<typeof makeAgent>;
  let drizzle: DrizzleService;

  beforeAll(async () => {
    process.env.AI_SERVICE_HMAC_SECRET = SHARED_SECRET;
    app = await bootTestApp();
    await captureOtps(app);
    agent = makeAgent(app);
    drizzle = app.get(DrizzleService);
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  // -----------------------------------------------------------------
  it('1. POST without HMAC → 401 ERR_AI_HMAC_MISSING', async () => {
    const res = await agent
      .post('/v1/questions/ai-batch')
      .send({ job_id: '00000000-0000-0000-0000-000000000000', questions: [] });
    expect(res.status).toBe(401);
    expect(res.body?.error?.code).toBe('ERR_AI_HMAC_MISSING');
  });

  // -----------------------------------------------------------------
  it('2. POST with bad signature → 401 ERR_AI_HMAC_INVALID', async () => {
    const body = { job_id: '00000000-0000-0000-0000-000000000000', questions: [] };
    const { raw, timestamp } = signed(body);
    const res = await agent
      .post('/v1/questions/ai-batch')
      .set('x-signature', 'not-the-right-hash')
      .set('x-timestamp', timestamp)
      .set('content-type', 'application/json')
      .send(raw);
    expect(res.status).toBe(401);
    expect(res.body?.error?.code).toBe('ERR_AI_HMAC_INVALID');
  });

  // -----------------------------------------------------------------
  it('3. POST with valid HMAC → 201, questions inserted as pending_review', async () => {
    const { jobId } = await createSuperAdminAndJob(app, 91);
    const body = {
      job_id: jobId,
      questions: [
        {
          question_en: 'Who was the 24th Tirthankara?',
          question_hi: 'चौबीसवें तीर्थंकर कौन थे?',
          options: [
            { text_en: 'Mahavira', text_hi: 'महावीर' },
            { text_en: 'Parshvanatha', text_hi: 'पार्श्वनाथ' },
            { text_en: 'Adinatha', text_hi: 'आदिनाथ' },
            { text_en: 'Neminatha', text_hi: 'नेमिनाथ' },
          ],
          correct_index: 0,
          difficulty: 'easy',
        },
        {
          question_en: 'How many Tirthankaras are there?',
          question_hi: 'कुल कितने तीर्थंकर हैं?',
          options: [
            { text_en: '12', text_hi: '१२' },
            { text_en: '24', text_hi: '२४' },
            { text_en: '36', text_hi: '३६' },
            { text_en: '48', text_hi: '४८' },
          ],
          correct_index: 1,
          difficulty: 'easy',
        },
      ],
    };
    const { raw, signature, timestamp } = signed(body);
    const res = await agent
      .post('/v1/questions/ai-batch')
      .set('x-signature', signature)
      .set('x-timestamp', timestamp)
      .set('content-type', 'application/json')
      .send(raw);
    expect(res.status).toBe(201);
    expect(res.body?.data?.accepted_count).toBe(2);
    expect(res.body?.data?.question_ids).toHaveLength(2);

    // The drafted questions land as ai_review_status='pending_review'.
    const questionIds = res.body.data.question_ids as string[];
    const idCsv = questionIds.map((i) => `'${i}'`).join(',');
    const rows = (await drizzle.db.execute(
      sql.raw(
        `SELECT id, is_ai_generated, ai_review_status, source FROM questions
           WHERE id IN (${idCsv})`,
      ),
    )) as unknown as Array<{
      id: string;
      is_ai_generated: boolean;
      ai_review_status: string;
      source: string;
    }>;
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.is_ai_generated).toBe(true);
      expect(r.ai_review_status).toBe('pending_review');
      expect(r.source).toBe('ai');
    }

    // The job row should be 'ready' with the question ids embedded.
    const [job] = (await drizzle.db.execute(
      sql`SELECT status, array_length(result_question_ids, 1) AS n
          FROM ai_generation_jobs WHERE id = ${jobId}`,
    )) as unknown as Array<{ status: string; n: number }>;
    expect(job?.status).toBe('ready');
    expect(Number(job?.n)).toBe(2);
  });
});
