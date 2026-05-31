/**
 * PlatformSettingsRepository — singleton row CRUD (SPEC §5.17 platform
 * settings + CLAUDE.md Q3 80G toggle).
 *
 * The migration seeds the lone `id='global'` row so `get()` never needs
 * a separate create path; updates always touch the same row.
 */

import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { platform_settings } from '../schema';

import type { NewPlatformSettings, PlatformSettings } from '../schema';

const SINGLETON_ID = 'global';

@Injectable()
export class PlatformSettingsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async get(): Promise<PlatformSettings> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(platform_settings)
      .where(eq(platform_settings.id, SINGLETON_ID))
      .limit(1);
    const row = rows[0];
    if (!row) {
      // Defensive: the migration seeds the row, but a fresh DB without
      // migrations applied would land here. Insert lazily.
      const inserted = await this.drizzle.db
        .insert(platform_settings)
        .values({ id: SINGLETON_ID } as NewPlatformSettings)
        .onConflictDoNothing()
        .returning();
      if (inserted[0]) return inserted[0];
      const reread = await this.drizzle.dbRead
        .select()
        .from(platform_settings)
        .where(eq(platform_settings.id, SINGLETON_ID))
        .limit(1);
      if (!reread[0]) throw new Error('[PlatformSettings.get] singleton row missing after upsert');
      return reread[0];
    }
    return row;
  }

  async update(
    patch: Partial<Omit<NewPlatformSettings, 'id'>>,
    actorUserId: string,
  ): Promise<PlatformSettings> {
    const [row] = await this.drizzle.db
      .update(platform_settings)
      .set({
        ...patch,
        last_updated_by: actorUserId,
        last_updated_at: new Date(),
        updated_at: new Date(),
      })
      .where(eq(platform_settings.id, SINGLETON_ID))
      .returning();
    if (!row) throw new Error('[PlatformSettings.update] update returned no row');
    return row;
  }
}
