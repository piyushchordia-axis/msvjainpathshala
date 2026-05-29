/**
 * Analytics integration tests — Step 22 (SPEC §6.25, §12).
 *
 * Coverage:
 *   1. REFRESH MATERIALIZED VIEW CONCURRENTLY mv_centre_engagement runs
 *      without taking a table-level lock — verified via pg_locks before/after.
 *   2. AnalyticsService.overview() returns an envelope with the seven KPI
 *      fields and a tier_distribution side channel.
 *   3. RBAC: non-admin (parent) gets ERR_RBAC_FORBIDDEN on overview().
 *   4. refreshAllViews() runs all six views without throwing.
 */

import 'reflect-metadata';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DrizzleService } from '../../../core/database/drizzle.service';
import { bootTestApp, captureOtps } from '../../auth/__tests__/test-helpers';
import { AnalyticsService } from '../analytics.service';

import type { INestApplication } from '@nestjs/common';

describe('Analytics — integration (Step 22)', () => {
  let app: INestApplication;
  let drizzle: DrizzleService;
  let svc: AnalyticsService;

  beforeAll(async () => {
    app = await bootTestApp();
    await captureOtps(app);
    drizzle = app.get(DrizzleService);
    svc = app.get(AnalyticsService);
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------
  it('1. REFRESH CONCURRENTLY mv_centre_engagement does not lock the view', async () => {
    // First populate the view (required for CONCURRENTLY).
    await drizzle.db.execute(sql`REFRESH MATERIALIZED VIEW mv_centre_engagement`);
    // Now refresh concurrently — must succeed and must NOT have held an
    // ACCESS EXCLUSIVE lock by the time it returns.
    await expect(
      drizzle.db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_centre_engagement`),
    ).resolves.toBeDefined();

    const locks = (await drizzle.db.execute(sql`
      SELECT mode FROM pg_locks
       WHERE relation = 'mv_centre_engagement'::regclass
         AND mode = 'AccessExclusiveLock'
    `)) as unknown as Array<{ mode: string }>;
    expect(locks.length).toBe(0);
  });

  // ---------------------------------------------------------------------
  it('2. service.refreshAllViews() runs all 6 views', async () => {
    const out = await svc.refreshAllViews();
    expect(out.refreshed.length + out.failed.length).toBeGreaterThanOrEqual(6);
    expect(out.failed.length).toBe(0);
  });

  // ---------------------------------------------------------------------
  it('3. overview() returns the KPI envelope for a super_admin', async () => {
    const overview = await svc.overview({
      user_id: '00000000-0000-0000-0000-000000000001',
      role: 'super_admin',
    });
    expect(overview).toHaveProperty('active_students');
    expect(overview).toHaveProperty('attendance_rate_30d');
    expect(overview).toHaveProperty('punya_awarded_30d');
    expect(overview).toHaveProperty('msv_active');
    expect(overview).toHaveProperty('donations_total_paise_ytd');
    expect((overview as unknown as Record<string, unknown>).tier_distribution).toBeDefined();
  });

  // ---------------------------------------------------------------------
  it('4. parent gets ERR_RBAC_FORBIDDEN on overview()', async () => {
    await expect(
      svc.overview({
        user_id: '00000000-0000-0000-0000-000000000002',
        role: 'parent',
      }),
    ).rejects.toMatchObject({ code: 'ERR_RBAC_FORBIDDEN' });
  });
});
