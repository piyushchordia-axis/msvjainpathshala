/**
 * Library integration tests — Step 22 (SPEC §5.16, §6.20, CLAUDE.md Q7).
 *
 * Coverage:
 *   1. Public-tier item is visible to a guest.
 *   2. Non-MSV parent gets 403 ERR_LIBRARY_ACCESS_DENIED on an msv-tier item;
 *      super_admin gets 200 on the same id.
 *   3. POST video item with a non-YouTube/Vimeo URL → ERR_VALIDATION_EMBED_URL_INVALID.
 *   4. POST video item with a valid YouTube URL → stores embed_url, asset_id=null.
 *   5. POST pdf item without asset_id → ERR_LIBRARY_ASSET_REQUIRED.
 */

import 'reflect-metadata';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DrizzleService } from '../../../core/database/drizzle.service';
import { bootTestApp, captureOtps } from '../../auth/__tests__/test-helpers';
import { LibraryService } from '../library.service';

import type { INestApplication } from '@nestjs/common';

async function createUser(
  app: INestApplication,
  role: 'super_admin' | 'parent' | 'shikshak',
  marker: number,
): Promise<string> {
  const drizzle = app.get(DrizzleService);
  const phone = `+91900${(Date.now() % 100000).toString().padStart(5, '0')}${marker
    .toString()
    .padStart(2, '0')}`.slice(0, 13);
  const [row] = (await drizzle.db.execute(
    sql`INSERT INTO users(phone, role, full_name, preferred_language)
        VALUES (${phone}, ${role}, ${`Lib ${role}`}, 'en') RETURNING id`,
  )) as unknown as Array<{ id: string }>;
  return row!.id;
}

describe('Library — integration (Step 22)', () => {
  let app: INestApplication;
  let svc: LibraryService;
  let drizzle: DrizzleService;
  let superId: string;
  let parentId: string;
  let publicItemId: string;
  let msvItemId: string;

  beforeAll(async () => {
    app = await bootTestApp();
    await captureOtps(app);
    drizzle = app.get(DrizzleService);
    svc = app.get(LibraryService);

    superId = await createUser(app, 'super_admin', 91);
    parentId = await createUser(app, 'parent', 92);

    // Seed two items directly via SQL so the test isn't coupled to the
    // controller's auth path (we exercise the service layer directly).
    const [pub] = (await drizzle.db.execute(sql`
      INSERT INTO library_items
        (content_type, title_en, title_hi, access_tier, msv_only, uploaded_by_user_id, embed_url, asset_id)
      VALUES ('video', 'Public talk', 'सार्वजनिक प्रवचन', 'public', false, ${superId},
              'https://www.youtube.com/watch?v=test', NULL)
      RETURNING id
    `)) as unknown as Array<{ id: string }>;
    publicItemId = pub!.id;

    const [msv] = (await drizzle.db.execute(sql`
      INSERT INTO library_items
        (content_type, title_en, title_hi, access_tier, msv_only, uploaded_by_user_id, embed_url, asset_id)
      VALUES ('video', 'MSV-only talk', 'MSV-only', 'msv', true, ${superId},
              'https://vimeo.com/123456', NULL)
      RETURNING id
    `)) as unknown as Array<{ id: string }>;
    msvItemId = msv!.id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('1. guest can read a public-tier item', async () => {
    const item = await svc.getById({ role: 'guest' }, publicItemId);
    expect(item.id).toBe(publicItemId);
    expect(item.access_tier).toBe('public');
  });

  it('2. non-MSV parent on an msv item → 403; super_admin → 200', async () => {
    await expect(
      svc.getById({ role: 'parent', user_id: parentId, msv_visible: false }, msvItemId),
    ).rejects.toMatchObject({ code: 'ERR_LIBRARY_ACCESS_DENIED' });

    const adminItem = await svc.getById(
      { role: 'super_admin', user_id: superId, msv_visible: true },
      msvItemId,
    );
    expect(adminItem.id).toBe(msvItemId);
  });

  it('3. POST video_embed with non-YouTube/Vimeo URL → ERR_VALIDATION_EMBED_URL_INVALID', async () => {
    await expect(
      svc.create(
        { user_id: superId, role: 'super_admin' },
        {
          content_type: 'video',
          title_en: 'Bad video',
          title_hi: 'खराब',
          embed_url: 'https://example.com/some-video',
          access_tier: 'public',
        },
      ),
    ).rejects.toMatchObject({ code: 'ERR_VALIDATION_EMBED_URL_INVALID' });
  });

  it('4. POST video with a YouTube URL → stored with embed_url, asset_id NULL', async () => {
    const created = await svc.create(
      { user_id: superId, role: 'super_admin' },
      {
        content_type: 'video',
        title_en: 'Good talk',
        title_hi: 'अच्छा',
        embed_url: 'https://youtu.be/abcdef',
        access_tier: 'public',
      },
    );
    expect(created.content_type).toBe('video');
    expect(created.embed_url).toBe('https://youtu.be/abcdef');
    expect(created.asset_id).toBeNull();
  });

  it('5. POST pdf without asset_id → ERR_LIBRARY_ASSET_REQUIRED', async () => {
    await expect(
      svc.create(
        { user_id: superId, role: 'super_admin' },
        {
          content_type: 'pdf',
          title_en: 'Bad pdf',
          title_hi: 'खराब पीडीएफ',
          access_tier: 'public',
        },
      ),
    ).rejects.toMatchObject({ code: 'ERR_LIBRARY_ASSET_REQUIRED' });
  });
});
