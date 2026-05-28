/**
 * SystemConfigRepository — typed key/value reads + writes against the
 * `system_config` table.
 *
 * Reads go through `dbRead`; writes are through `db` and append `updated_at`
 * + `updated_by` (set by the caller). The `value` column is `jsonb` so we
 * surface it as `unknown` here and let the caller (SystemConfigService)
 * cast / validate.
 */

import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { system_config } from '../schema';

export interface SystemConfigRow {
  key: string;
  value: unknown;
  updated_at: Date;
  updated_by: string | null;
}

@Injectable()
export class SystemConfigRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async findByKey(key: string): Promise<SystemConfigRow | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(system_config)
      .where(eq(system_config.key, key))
      .limit(1);
    return rows[0] ?? null;
  }

  async listAll(): Promise<SystemConfigRow[]> {
    return this.drizzle.dbRead.select().from(system_config);
  }

  /** UPSERT (insert or update) — used by super_admin to override a default. */
  async upsert(key: string, value: unknown, updatedBy: string | null): Promise<void> {
    await this.drizzle.db
      .insert(system_config)
      .values({ key, value, updated_by: updatedBy })
      .onConflictDoUpdate({
        target: system_config.key,
        set: { value, updated_at: new Date(), updated_by: updatedBy },
      });
  }
}
