/**
 * Niyams + Gallery integration tests — Step 17.
 *
 * Coverage:
 *   1. Submit niyam → status=auto_approved, ONE punya_transactions row
 *      keyed by `niyam_sub:{submission_id}`, balance increased.
 *   2. Reject within 30 days → reversal row written, balance decreased,
 *      gallery item hidden (when opted in).
 *   3. Force submitted_at to NOW-31d → reject returns 409
 *      ERR_NIYAM_REVERSAL_WINDOW_EXPIRED.
 *   4. Toggle gallery_visibility_opt_in false → COUNT(*) visible items
 *      for the parent's children drops to 0; toggle true → restored.
 *
 * No mocks — boots the full app, drives via SQL fixtures + the real
 * HTTP-level routes where useful.
 */

import 'reflect-metadata';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DrizzleService } from '../../../core/database/drizzle.service';
import { SystemConfigService } from '../../../core/system-config/system-config.service';
import { GalleryItemsRepository, UsersRepository } from '../../../db/repositories';
import {
  bootTestApp,
  captureOtps,
  lastOtpFor,
  makeAgent,
  nextTestPhone,
} from '../../auth/__tests__/test-helpers';
import { JwtService } from '../../auth/services/jwt.service';
import { GalleryService } from '../../gallery/gallery.service';
import { NiyamsService } from '../niyams.service';

import type { INestApplication } from '@nestjs/common';

type Role = 'super_admin' | 'state_admin' | 'city_admin' | 'sanchalak' | 'shikshak' | 'parent';

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

// authHeader helper retained inline (used by future HTTP tests).

describe('Niyams + Gallery — integration', () => {
  let app: INestApplication;
  let drizzle: DrizzleService;
  let niyamsService: NiyamsService;
  let gallery: GalleryService;
  let galleryRepo: GalleryItemsRepository;
  let users: UsersRepository;
  let cityId: string;
  let centreId: string;
  let batchId: string;
  let cityAdminAccess: string;
  let cityAdminUserId: string;
  let parentAccess: string;
  let parentUserId: string;
  let studentIds: string[];

  beforeAll(async () => {
    app = await bootTestApp();
    await captureOtps(app);
    drizzle = app.get(DrizzleService);
    niyamsService = app.get(NiyamsService);
    gallery = app.get(GalleryService);
    galleryRepo = app.get(GalleryItemsRepository);
    users = app.get(UsersRepository);

    const tag = Date.now().toString().slice(-6);
    const [stateRow] = (await drizzle.db.execute(
      sql`INSERT INTO states(name, code) VALUES (${`ST-NI-${tag}`}, ${'N' + tag.slice(-2)}) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    const [cityRow] = (await drizzle.db.execute(
      sql`INSERT INTO cities(state_id, name, code) VALUES (${stateRow!.id}, ${`CITY-NI-${tag}`}, ${'N' + tag.slice(-2)}) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    cityId = cityRow!.id;
    const [centreRow] = (await drizzle.db.execute(
      sql`INSERT INTO centres(city_id, name, status, gps_radius_m, lat, lng)
          VALUES (${cityId}, ${`Centre-NI-${tag}`}, 'active', 500, 23.0225, 72.5714) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    centreId = centreRow!.id;

    const cityAdmin = await mintAccessAs({ app, role: 'city_admin', cityId });
    cityAdminAccess = cityAdmin.access;
    cityAdminUserId = cityAdmin.userId;
    void cityAdminAccess;

    const parent = await mintAccessAs({ app, role: 'parent', cityId });
    parentAccess = parent.access;
    parentUserId = parent.userId;
    void parentAccess;

    const [batchRow] = (await drizzle.db.execute(
      sql`INSERT INTO batches(centre_id, name, age_group, day_of_week, start_time, end_time, capacity, status)
          VALUES (${centreId}, ${`Bal-NI-${tag}`}, 'bal', '{0,1,2,3,4,5,6}', '09:00', '11:00', 30, 'active') RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    batchId = batchRow!.id;

    studentIds = [];
    for (let i = 0; i < 3; i += 1) {
      const [row] = (await drizzle.db.execute(
        sql`INSERT INTO students(parent_user_id, full_name, dob, age_group, centre_id, batch_id,
                                  student_code, status, enrolled_at)
            VALUES (${parentUserId}, ${`StudentNI-${tag}-${i}`}, '2015-04-12', 'bal', ${centreId}, ${batchId},
                    ${`NI-${tag}-${i}`}, 'active', now()) RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      studentIds.push(row!.id);
    }
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  // --- Helpers ---------------------------------------------------------------

  async function createNiyam(
    opts: {
      type?: 'daily' | 'weekly' | 'monthly';
      points?: number;
      title?: string;
    } = {},
  ): Promise<string> {
    const [row] = (await drizzle.db.execute(sql`
      INSERT INTO niyams(
        title_en, title_hi, type, start_date, audience_kind, proof_type,
        points_value, created_by_user_id, city_id, msv_only
      ) VALUES (
        ${opts.title ?? 'Test niyam'}, ${opts.title ?? 'परीक्षण नियम'},
        ${opts.type ?? 'daily'}, ${new Date().toISOString().slice(0, 10)},
        'all', 'photo', ${opts.points ?? 15}, ${cityAdminUserId},
        ${cityId}, false
      ) RETURNING id
    `)) as unknown as Array<{ id: string }>;
    return row!.id;
  }

  async function createMediaAsset(): Promise<string> {
    const [row] = (await drizzle.db.execute(sql`
      INSERT INTO media_assets(
        kind, owner_user_id, s3_bucket, s3_key, mime_type, size_bytes,
        checksum_sha256, status, exif_stripped
      ) VALUES (
        'niyam_proof', ${parentUserId}, 'jp-test', ${`test/${Date.now()}.jpg`},
        'image/jpeg', 1024,
        ${'0'.repeat(64)}, 'ready', true
      ) RETURNING id
    `)) as unknown as Array<{ id: string }>;
    return row!.id;
  }

  // --- 1. Submit niyam → Punya award + idempotency key niyam:* --------------

  it('1. submit → ONE niyam:* punya_transactions row, balance increased', async () => {
    const niyamId = await createNiyam({ points: 15 });
    const assetId = await createMediaAsset();
    const student = studentIds[0]!;

    const result = await niyamsService.submit({ user_id: parentUserId, role: 'parent' }, niyamId, {
      student_id: student,
      proof_asset_id: assetId,
    });
    expect(result.duplicate).toBe(false);
    expect(result.status).toBe('auto_approved');
    expect(result.points_awarded).toBe(15);

    const rows = (await drizzle.db.execute(
      sql`SELECT COUNT(*)::int AS c FROM punya_transactions
          WHERE idempotency_key = ${'niyam_sub:' + result.submission_id}`,
    )) as unknown as Array<{ c: number }>;
    expect(rows[0]!.c).toBe(1);

    const balance = (await drizzle.db.execute(
      sql`SELECT total_points FROM punya_balances WHERE student_id = ${student}`,
    )) as unknown as Array<{ total_points: number }>;
    expect(balance[0]!.total_points).toBeGreaterThanOrEqual(15);
  });

  // --- 2. Reject within 30 days → reversal row, balance reduced --------------

  it('2. reject within 30 days → reversal row, balance decreased', async () => {
    const niyamId = await createNiyam({ points: 25 });
    const assetId = await createMediaAsset();
    const student = studentIds[1]!;

    // Opt this parent IN to gallery so we also test the hide path.
    await users.update(parentUserId, { gallery_visibility_opt_in: true });

    const submitted = await niyamsService.submit(
      { user_id: parentUserId, role: 'parent' },
      niyamId,
      { student_id: student, proof_asset_id: assetId },
    );
    const balanceBefore = (await drizzle.db.execute(
      sql`SELECT total_points FROM punya_balances WHERE student_id = ${student}`,
    )) as unknown as Array<{ total_points: number }>;
    const before = balanceBefore[0]!.total_points;
    expect(before).toBeGreaterThanOrEqual(25);

    // Gallery row should exist + be visible.
    const itemBefore = await galleryRepo.findBySubmissionId(submitted.submission_id);
    expect(itemBefore).toBeTruthy();
    expect(itemBefore!.removed).toBe(false);

    const reject = await niyamsService.reject(
      { user_id: cityAdminUserId, role: 'city_admin', city_id: cityId },
      submitted.submission_id,
      { reason: 'Photo does not show the niyam being performed correctly' },
    );
    expect(reject.gallery_hidden).toBe(true);

    // Reversal row + decreased balance.
    const reversal = (await drizzle.db.execute(
      sql`SELECT points, reversal_of FROM punya_transactions WHERE id = ${reject.reversal_transaction_id}`,
    )) as unknown as Array<{ points: number; reversal_of: string }>;
    expect(reversal[0]!.points).toBe(-25);
    expect(reversal[0]!.reversal_of).toBe(submitted.punya_transaction_id);

    const balanceAfter = (await drizzle.db.execute(
      sql`SELECT total_points FROM punya_balances WHERE student_id = ${student}`,
    )) as unknown as Array<{ total_points: number }>;
    expect(balanceAfter[0]!.total_points).toBe(before - 25);

    // Gallery now hidden.
    const itemAfter = await galleryRepo.findBySubmissionId(submitted.submission_id);
    expect(itemAfter!.removed).toBe(true);
  });

  // --- 3. submitted_at older than 30 days → 409 ------------------------------

  it('3. submission older than 30 days → ERR_NIYAM_REVERSAL_WINDOW_EXPIRED (409)', async () => {
    const niyamId = await createNiyam({ points: 10 });
    const assetId = await createMediaAsset();
    const student = studentIds[2]!;
    const submitted = await niyamsService.submit(
      { user_id: parentUserId, role: 'parent' },
      niyamId,
      { student_id: student, proof_asset_id: assetId },
    );
    // Force submitted_at backwards by 31 days.
    await drizzle.db.execute(
      sql`UPDATE niyam_submissions SET submitted_at = now() - INTERVAL '31 days'
          WHERE id = ${submitted.submission_id}`,
    );

    let caught: unknown = null;
    try {
      await niyamsService.reject(
        { user_id: cityAdminUserId, role: 'city_admin', city_id: cityId },
        submitted.submission_id,
        { reason: 'Too late — Q5 window long expired so this must 409 cleanly' },
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeTruthy();
    expect((caught as { code?: string }).code).toBe('ERR_NIYAM_REVERSAL_WINDOW_EXPIRED');
    expect((caught as { statusCode?: number }).statusCode).toBe(409);
  });

  // --- 4. Q6 — toggle gallery_visibility_opt_in -----------------------------

  it('4. Q6: toggling gallery_visibility_opt_in hides/restores all items', async () => {
    // Ensure parent is opted in; create two submissions so they both produce
    // gallery rows.
    await users.update(parentUserId, { gallery_visibility_opt_in: true });
    const n1 = await createNiyam({ points: 10, title: 'Niyam Q6 A' });
    const n2 = await createNiyam({ points: 10, title: 'Niyam Q6 B' });
    const a1 = await createMediaAsset();
    const a2 = await createMediaAsset();

    const s1 = await niyamsService.submit({ user_id: parentUserId, role: 'parent' }, n1, {
      student_id: studentIds[0]!,
      proof_asset_id: a1,
    });
    const s2 = await niyamsService.submit({ user_id: parentUserId, role: 'parent' }, n2, {
      student_id: studentIds[1]!,
      proof_asset_id: a2,
    });
    void s1;
    void s2;

    // Both items are visible (removed=false).
    const beforeVisible = await galleryRepo.countVisibleForParent(parentUserId);
    expect(beforeVisible).toBeGreaterThanOrEqual(2);

    // Toggle OFF — backfill should hide ALL.
    const offRes = await gallery.setGalleryVisibility(
      { user_id: parentUserId, role: 'parent' },
      false,
    );
    expect(offRes.gallery_visibility_opt_in).toBe(false);
    expect(offRes.items_hidden).toBeGreaterThanOrEqual(2);
    const afterOff = await galleryRepo.countVisibleForParent(parentUserId);
    expect(afterOff).toBe(0);

    // Toggle back ON — restore.
    const onRes = await gallery.setGalleryVisibility(
      { user_id: parentUserId, role: 'parent' },
      true,
    );
    expect(onRes.gallery_visibility_opt_in).toBe(true);
    expect(onRes.items_restored).toBeGreaterThanOrEqual(2);
    const afterOn = await galleryRepo.countVisibleForParent(parentUserId);
    expect(afterOn).toBeGreaterThanOrEqual(2);
  });
});
