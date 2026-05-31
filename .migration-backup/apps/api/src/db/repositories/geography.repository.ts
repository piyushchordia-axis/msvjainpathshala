/**
 * GeographyRepository — states + cities.
 *
 * Reference data; rarely changes. Service-level caching keys these reads
 * (24h TTL per SPEC §17.3 / §6.28).
 */

import { Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { cities, states } from '../schema';

import type { City, NewCity, NewState, State } from '../schema';

@Injectable()
export class GeographyRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  // ----- states -----------------------------------------------------------
  async listStates(): Promise<State[]> {
    return this.drizzle.dbRead.select().from(states).orderBy(asc(states.name));
  }

  async findStateById(id: string): Promise<State | null> {
    const rows = await this.drizzle.dbRead.select().from(states).where(eq(states.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async createState(input: NewState): Promise<State> {
    const [row] = await this.drizzle.db.insert(states).values(input).returning();
    if (!row) throw new Error('[Geography.createState] insert returned no row');
    return row;
  }

  // ----- cities -----------------------------------------------------------
  async listCitiesByState(stateId: string): Promise<City[]> {
    return this.drizzle.dbRead
      .select()
      .from(cities)
      .where(eq(cities.state_id, stateId))
      .orderBy(asc(cities.name));
  }

  async findCityById(id: string): Promise<City | null> {
    const rows = await this.drizzle.dbRead.select().from(cities).where(eq(cities.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async createCity(input: NewCity): Promise<City> {
    const [row] = await this.drizzle.db.insert(cities).values(input).returning();
    if (!row) throw new Error('[Geography.createCity] insert returned no row');
    return row;
  }
}
