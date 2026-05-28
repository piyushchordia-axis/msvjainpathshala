/**
 * FormConfigsRepository — `registration_form_configs` access.
 *
 * The unique index `(city_id, form_kind, version_no)` (Step 4) lets cities
 * publish their own override alongside the global default (city_id IS NULL).
 *
 * Resolution rule (Step 6 prompt):
 *   "city override takes precedence over default"
 *
 * Implemented in the service via two reads: first city-specific, then NULL.
 */

import { Injectable } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { registration_form_configs } from '../schema';

import type { NewRegistrationFormConfig, RegistrationFormConfig } from '../schema';

@Injectable()
export class FormConfigsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async findActiveByCityAndKind(
    cityId: string,
    formKind: string,
  ): Promise<RegistrationFormConfig | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(registration_form_configs)
      .where(
        and(
          eq(registration_form_configs.city_id, cityId),
          eq(registration_form_configs.form_kind, formKind),
          eq(registration_form_configs.is_active, true),
        ),
      )
      .orderBy(desc(registration_form_configs.version_no))
      .limit(1);
    return rows[0] ?? null;
  }

  async findActiveDefaultByKind(formKind: string): Promise<RegistrationFormConfig | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(registration_form_configs)
      .where(
        and(
          isNull(registration_form_configs.city_id),
          eq(registration_form_configs.form_kind, formKind),
          eq(registration_form_configs.is_active, true),
        ),
      )
      .orderBy(desc(registration_form_configs.version_no))
      .limit(1);
    return rows[0] ?? null;
  }

  async create(input: NewRegistrationFormConfig): Promise<RegistrationFormConfig> {
    const [row] = await this.drizzle.db.insert(registration_form_configs).values(input).returning();
    if (!row) throw new Error('[FormConfigs.create] insert returned no row');
    return row;
  }

  /** Latest version_no for (city_id, form_kind) — used to choose the next one. */
  async nextVersionFor(cityId: string | null, formKind: string): Promise<number> {
    const filters = [eq(registration_form_configs.form_kind, formKind)];
    filters.push(
      cityId === null
        ? isNull(registration_form_configs.city_id)
        : eq(registration_form_configs.city_id, cityId),
    );
    const rows = await this.drizzle.dbRead
      .select({ v: registration_form_configs.version_no })
      .from(registration_form_configs)
      .where(and(...filters))
      .orderBy(desc(registration_form_configs.version_no))
      .limit(1);
    return (rows[0]?.v ?? 0) + 1;
  }
}
