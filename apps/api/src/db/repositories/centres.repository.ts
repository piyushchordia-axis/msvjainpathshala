/**
 * CentresRepository — scoped CRUD over `centres` + a thin resolver helper
 * that ScopeGuard uses to fetch the centre's city / state for scope checks.
 *
 * "Scoped list" is driven by the actor's ScopeContext (centre_ids /
 * city_id / state_id) — the service layer builds the WHERE; this layer
 * exposes a few primitive selectors and the centres-by-city / centres-by-id
 * lookups.
 */

import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { batches, centres, cities } from '../schema';

import type { Centre, NewCentre } from '../schema';

@Injectable()
export class CentresRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async findById(id: string): Promise<Centre | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(centres)
      .where(and(eq(centres.id, id), isNull(centres.deleted_at)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Used by ScopeGuard's CentreResolver — returns city_id + state_id only. */
  async findScopeById(id: string): Promise<{ city_id: string; state_id: string } | null> {
    const rows = await this.drizzle.dbRead
      .select({ city_id: centres.city_id, state_id: cities.state_id })
      .from(centres)
      .innerJoin(cities, eq(cities.id, centres.city_id))
      .where(and(eq(centres.id, id), isNull(centres.deleted_at)))
      .limit(1);
    return rows[0] ?? null;
  }

  async listByCity(cityId: string): Promise<Centre[]> {
    return this.drizzle.dbRead
      .select()
      .from(centres)
      .where(and(eq(centres.city_id, cityId), isNull(centres.deleted_at)))
      .orderBy(asc(centres.name));
  }

  async listByIds(ids: string[]): Promise<Centre[]> {
    if (ids.length === 0) return [];
    return this.drizzle.dbRead
      .select()
      .from(centres)
      .where(and(inArray(centres.id, ids), isNull(centres.deleted_at)))
      .orderBy(asc(centres.name));
  }

  async listAll(): Promise<Centre[]> {
    return this.drizzle.dbRead
      .select()
      .from(centres)
      .where(isNull(centres.deleted_at))
      .orderBy(asc(centres.name));
  }

  async create(input: NewCentre): Promise<Centre> {
    const [row] = await this.drizzle.db.insert(centres).values(input).returning();
    if (!row) throw new Error('[Centres.create] insert returned no row');
    return row;
  }

  async update(id: string, patch: Partial<NewCentre>): Promise<Centre> {
    const [row] = await this.drizzle.db
      .update(centres)
      .set({ ...patch, updated_at: new Date() })
      .where(eq(centres.id, id))
      .returning();
    if (!row) throw new Error('[Centres.update] update returned no row');
    return row;
  }

  /**
   * Count active (not-deleted, status='active') batches for a centre. Used by
   * the deactivate guard — a centre cannot be deactivated while it owns
   * active batches.
   */
  async countActiveBatches(centreId: string): Promise<number> {
    const rows = await this.drizzle.dbRead
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(batches)
      .where(
        and(
          eq(batches.centre_id, centreId),
          eq(batches.status, 'active'),
          isNull(batches.deleted_at),
        ),
      );
    return rows[0]?.count ?? 0;
  }

  async setStatus(id: string, status: 'active' | 'inactive'): Promise<void> {
    await this.drizzle.db
      .update(centres)
      .set({ status, updated_at: new Date() })
      .where(eq(centres.id, id));
  }
}
