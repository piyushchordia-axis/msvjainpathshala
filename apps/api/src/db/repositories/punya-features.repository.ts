/**
 * PunyaFeaturesRepository — read-mostly catalogue + per-city overrides.
 *
 * SPEC §5.7:
 *   - `punya_features` — super_admin-managed catalogue. Each row carries a
 *     `default_points`, optional `min_points` / `max_points` envelope, and
 *     `is_manual` / `requires_reason` flags.
 *   - `punya_configs` — per-city overrides. The effective point value for a
 *     feature is `coalesce(override, default)`; the effective range is
 *     `coalesce(override.{min,max}, default.{min,max})`.
 *
 * Used by:
 *   - PunyaService.manualAward (range validation + reason enforcement)
 *   - PunyaConfigsController (city_admin tunes per-feature overrides)
 *   - LeaderboardService / processors that need a feature's metadata
 */

import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { punya_configs, punya_features } from '../schema';

import type { NewPunyaConfig, PunyaConfig, PunyaFeature } from '../schema';

export interface ResolvedFeature {
  feature: PunyaFeature;
  override: PunyaConfig | null;
  /** Final points for an automatic award (override → default). */
  effective_points: number;
  /** Effective minimum (override → feature → default_points). */
  effective_min: number;
  /** Effective maximum (override → feature → default_points). */
  effective_max: number;
}

@Injectable()
export class PunyaFeaturesRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async listFeatures(): Promise<PunyaFeature[]> {
    return this.drizzle.dbRead.select().from(punya_features).orderBy(punya_features.key);
  }

  async findFeatureByKey(key: string): Promise<PunyaFeature | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(punya_features)
      .where(eq(punya_features.key, key))
      .limit(1);
    return rows[0] ?? null;
  }

  async findFeatureById(id: string): Promise<PunyaFeature | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(punya_features)
      .where(eq(punya_features.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async listConfigsForCity(cityId: string): Promise<PunyaConfig[]> {
    return this.drizzle.dbRead
      .select()
      .from(punya_configs)
      .where(eq(punya_configs.city_id, cityId));
  }

  async findConfig(cityId: string, featureId: string): Promise<PunyaConfig | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(punya_configs)
      .where(and(eq(punya_configs.city_id, cityId), eq(punya_configs.feature_id, featureId)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Resolve a feature's effective points + bounds for a given city. */
  async resolveFeature(opts: {
    feature_key: string;
    city_id?: string;
  }): Promise<ResolvedFeature | null> {
    const feature = await this.findFeatureByKey(opts.feature_key);
    if (!feature) return null;
    let override: PunyaConfig | null = null;
    if (opts.city_id) {
      override = await this.findConfig(opts.city_id, feature.id);
    }
    const effectivePoints = override?.points_override ?? feature.default_points;
    const effectiveMin = override?.min_points ?? feature.min_points ?? effectivePoints;
    const effectiveMax = override?.max_points ?? feature.max_points ?? effectivePoints;
    return {
      feature,
      override,
      effective_points: effectivePoints,
      effective_min: effectiveMin,
      effective_max: effectiveMax,
    };
  }

  /**
   * UPSERT a per-city config. The city_admin UI calls this — bounds are
   * validated in the service layer against the parent feature's min/max
   * before reaching the repository.
   */
  async upsertConfig(input: NewPunyaConfig): Promise<PunyaConfig> {
    const existing = await this.findConfig(input.city_id, input.feature_id);
    if (existing) {
      const [row] = await this.drizzle.db
        .update(punya_configs)
        .set({
          points_override: input.points_override,
          min_points: input.min_points ?? null,
          max_points: input.max_points ?? null,
          updated_at: new Date(),
        })
        .where(eq(punya_configs.id, existing.id))
        .returning();
      return row!;
    }
    const [row] = await this.drizzle.db.insert(punya_configs).values(input).returning();
    return row!;
  }

  /** Bulk lookup helper for tests + manual debugging. */
  async findFeaturesByKeys(keys: string[]): Promise<PunyaFeature[]> {
    if (keys.length === 0) return [];
    return this.drizzle.dbRead
      .select()
      .from(punya_features)
      .where(inArray(punya_features.key, keys));
  }
}
