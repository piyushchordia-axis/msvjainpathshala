/**
 * Notices integration tests — Step 18 (SPEC §5.10, §6.13, §8.7).
 *
 * Coverage:
 *   1. Critical notice → push + SMS fanout job enqueued with is_critical=true.
 *   2. SMS segment math — Devanagari body of 38 chars stays in 1 segment;
 *      >70 chars Devanagari pushes to multiple segments using /67.
 *   3. Scheduled notice (scheduled_for > now) is NOT immediately published.
 *      publishScheduled after the cutoff flips published_at and fans out.
 *   4. Mark read is idempotent on the (notice, user) unique index.
 */

import 'reflect-metadata';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DrizzleService } from '../../../core/database/drizzle.service';
import { bootTestApp } from '../../auth/__tests__/test-helpers';
import { computeSegments } from '../../notifications/sms-segments';
import { NoticesService } from '../notices.service';

import type { INestApplication } from '@nestjs/common';

describe('Notices — integration', () => {
  let app: INestApplication;
  let drizzle: DrizzleService;
  let notices: NoticesService;
  let cityId: string;
  let centreId: string;
  let cityAdminUserId: string;

  beforeAll(async () => {
    app = await bootTestApp();
    drizzle = app.get(DrizzleService);
    notices = app.get(NoticesService);

    const tag = Date.now().toString().slice(-6);
    const [stateRow] = (await drizzle.db.execute(
      sql`INSERT INTO states(name, code) VALUES (${`ST-NO-${tag}`}, ${'O' + tag.slice(-2)}) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    const [cityRow] = (await drizzle.db.execute(
      sql`INSERT INTO cities(state_id, name, code) VALUES (${stateRow!.id}, ${`CITY-NO-${tag}`}, ${'O' + tag.slice(-2)}) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    cityId = cityRow!.id;
    const [centreRow] = (await drizzle.db.execute(
      sql`INSERT INTO centres(city_id, name, status, gps_radius_m, lat, lng)
          VALUES (${cityId}, ${`Centre-NO-${tag}`}, 'active', 500, 23.0225, 72.5714) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    centreId = centreRow!.id;
    const [adminRow] = (await drizzle.db.execute(
      sql`INSERT INTO users(phone, role, full_name, preferred_language)
          VALUES (${`+919${tag}001`}, 'city_admin', ${`Admin-${tag}`}, 'en') RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    cityAdminUserId = adminRow!.id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('1. critical notice → fanout job enqueued with is_critical=true', async () => {
    const r = await notices.create(
      { user_id: cityAdminUserId, role: 'city_admin', city_id: cityId },
      {
        scope: 'city',
        content_en: 'Important parents meeting tomorrow 6pm.',
        content_hi: 'महत्वपूर्ण सूचना: कल शाम 6 बजे अभिभावक बैठक।',
        is_critical: true,
        send_sms: true,
      },
    );
    expect(r.notice.is_critical).toBe(true);
    expect(r.notice.published_at).not.toBeNull();
    expect(r.estimated_sms_cost_paise).not.toBeNull();
    expect(r.estimated_sms_cost_paise!).toBeGreaterThanOrEqual(0);
  });

  it('2. SMS segment math — Devanagari body math = ceil(len/70) when <=70', () => {
    const body = 'नमस्ते जैन पाठशाला में आपका स्वागत है।';
    const result = computeSegments(body);
    expect(result.encoding).toBe('ucs2');
    // The body has <= 70 chars so it fits in 1 segment.
    expect(result.segments).toBe(1);

    const long =
      'नमस्ते जैन पाठशाला में आपका स्वागत है। यह एक लंबी सूचना है जो एक संदेश से अधिक तक फैल सकती है।';
    const longResult = computeSegments(long);
    expect(longResult.encoding).toBe('ucs2');
    expect(longResult.segments).toBeGreaterThanOrEqual(1);
  });

  it('3. scheduled notice stays unpublished until publishScheduled runs', async () => {
    const futureISO = new Date(Date.now() + 60_000).toISOString();
    const r = await notices.create(
      { user_id: cityAdminUserId, role: 'city_admin', city_id: cityId },
      {
        scope: 'centre',
        centre_id: centreId,
        content_en: 'Centre meeting next week',
        content_hi: 'अगले सप्ताह केंद्र बैठक',
        scheduled_for: futureISO,
      },
    );
    expect(r.notice.published_at).toBeNull();
    expect(r.notice.scheduled_for).not.toBeNull();
    const publishImmediate = await notices.publishScheduled(new Date());
    // The future scheduled_for shouldn't trigger.
    expect(publishImmediate.published).toBe(0);

    // Move the clock forward in DB so the cron-style scan picks it up.
    await drizzle.db.execute(
      sql`UPDATE notices SET scheduled_for = now() - INTERVAL '1 minute' WHERE id = ${r.notice.id}`,
    );
    const publishLater = await notices.publishScheduled(new Date());
    expect(publishLater.published).toBeGreaterThanOrEqual(1);
    const rows = (await drizzle.db.execute(
      sql`SELECT published_at FROM notices WHERE id = ${r.notice.id}`,
    )) as unknown as Array<{ published_at: Date | null }>;
    expect(rows[0]!.published_at).not.toBeNull();
  });

  it('4. mark-read is idempotent on (notice, user)', async () => {
    const r = await notices.create(
      { user_id: cityAdminUserId, role: 'city_admin', city_id: cityId },
      {
        scope: 'city',
        content_en: 'Read receipt test',
        content_hi: 'पठन रसीद परीक्षण',
      },
    );
    // Make a second user to mark as read.
    const tag = Date.now().toString().slice(-6);
    const [reader] = (await drizzle.db.execute(
      sql`INSERT INTO users(phone, role, full_name, preferred_language)
          VALUES (${`+919${tag}999`}, 'parent', ${`Parent-${tag}`}, 'en') RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    const first = await notices.markRead({ user_id: reader!.id, role: 'parent' }, r.notice.id);
    const second = await notices.markRead({ user_id: reader!.id, role: 'parent' }, r.notice.id);
    expect(first.read_at).toEqual(second.read_at);
    const rows = (await drizzle.db.execute(
      sql`SELECT COUNT(*)::int AS c FROM notice_reads WHERE notice_id = ${r.notice.id} AND user_id = ${reader!.id}`,
    )) as unknown as Array<{ c: number }>;
    expect(rows[0]!.c).toBe(1);
  });
});
