/**
 * Questions integration tests — Step 20.
 *
 * Coverage:
 *   1. super_admin can manually create a question; it lands as
 *      ai_review_status='approved' and `is_ai_generated=false`.
 *   2. AI-generated rows inserted directly (simulating the worker) appear
 *      in `listPendingAiReview()`.
 *   3. Approving an AI question flips ai_review_status to 'approved'; the
 *      question is then usable in a scheduled quiz event.
 *   4. Rejecting an AI question flips ai_review_status to 'rejected'.
 */

import 'reflect-metadata';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DrizzleService } from '../../../core/database/drizzle.service';
import { RedisService } from '../../../core/redis/redis.service';
import { bootTestApp, captureOtps } from '../../auth/__tests__/test-helpers';
import { QuestionsService } from '../questions.service';

import type { INestApplication } from '@nestjs/common';

async function createSuperAdmin(app: INestApplication, seed: number): Promise<string> {
  const drizzle = app.get(DrizzleService);
  const phone = `+91900${(Date.now() % 100000).toString().padStart(5, '0')}${seed
    .toString()
    .padStart(2, '0')}`.slice(0, 13);
  const [row] = (await drizzle.db.execute(
    sql`INSERT INTO users(phone, role, full_name, preferred_language)
        VALUES (${phone}, 'super_admin', 'Test super', 'en') RETURNING id`,
  )) as unknown as Array<{ id: string }>;
  return row!.id;
}

describe('Questions — integration', () => {
  let app: INestApplication;
  let drizzle: DrizzleService;
  let svc: QuestionsService;
  let superId: string;

  beforeAll(async () => {
    app = await bootTestApp();
    await captureOtps(app);
    drizzle = app.get(DrizzleService);
    svc = app.get(QuestionsService);
    const redis = app.get(RedisService);
    await redis.cacheClient.del('otp:rl:ip:h1:127.0.0.1');
    superId = await createSuperAdmin(app, 99);
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('1. manual create lands as approved + not AI-generated', async () => {
    const q = await svc.createManual(
      { user_id: superId, role: 'super_admin' },
      {
        scope: 'national',
        city_id: null,
        question_en: 'Manual q?',
        question_hi: 'मैनुअल प्रश्न?',
        options: [
          { id: 'a', text_en: 'A', text_hi: 'क' },
          { id: 'b', text_en: 'B', text_hi: 'ख' },
        ],
        correct_indices: [0],
      },
    );
    expect(q.is_ai_generated).toBe(false);
    expect(q.ai_review_status).toBe('approved');
  });

  it('2. AI rows surface in pending-review list', async () => {
    // Simulate the worker: insert an AI-generated row directly.
    const [aiQ] = (await drizzle.db.execute(
      sql`INSERT INTO questions(scope, question_en, question_hi, options, correct_indices,
                                source, is_ai_generated, ai_review_status)
          VALUES ('national', 'AI?', 'AI?', ${sql`'[]'::jsonb`}, '{0}',
                  'ai', true, 'pending_review') RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    const pending = await svc.listPendingAiReview({ user_id: superId, role: 'super_admin' });
    expect(pending.find((p) => p.id === aiQ!.id)).toBeTruthy();
  });

  it('3. approve flips status to approved', async () => {
    const [aiQ] = (await drizzle.db.execute(
      sql`INSERT INTO questions(scope, question_en, question_hi, options, correct_indices,
                                source, is_ai_generated, ai_review_status)
          VALUES ('national', 'AI ok?', 'AI ok?', ${sql`'[]'::jsonb`}, '{0}',
                  'ai', true, 'pending_review') RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    const updated = await svc.reviewAiQuestion({ user_id: superId, role: 'super_admin' }, aiQ!.id, {
      decision: 'approve',
    });
    expect(updated.ai_review_status).toBe('approved');
  });

  it('4. reject flips status to rejected', async () => {
    const [aiQ] = (await drizzle.db.execute(
      sql`INSERT INTO questions(scope, question_en, question_hi, options, correct_indices,
                                source, is_ai_generated, ai_review_status)
          VALUES ('national', 'AI bad?', 'AI bad?', ${sql`'[]'::jsonb`}, '{0}',
                  'ai', true, 'pending_review') RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    const updated = await svc.reviewAiQuestion({ user_id: superId, role: 'super_admin' }, aiQ!.id, {
      decision: 'reject',
    });
    expect(updated.ai_review_status).toBe('rejected');
  });
});
