/**
 * PublicService — unauthenticated content reads for the public website
 * (SPEC §6.26). Only exposes non-sensitive, active records.
 */

import { Injectable } from '@nestjs/common';
import { and, asc, eq, gte, isNull, sql } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { batches, centres, cities, shivir_events, shivir_sessions, states } from '../../db/schema';

export interface PublicCentreSummary {
  id: string;
  name: string;
  locality: string | null;
  pincode: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  city_id: string;
  city_name: string;
  state_name: string;
  batch_count: number;
}

export interface PublicBatchRow {
  id: string;
  name: string;
  age_group: string;
  day_of_week: number[];
  start_time: string;
  end_time: string;
  capacity: number;
  language_preference: string | null;
}

export interface PublicShivirSummary {
  id: string;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string;
  location_text: string | null;
  city_id: string;
  city_name: string;
}

@Injectable()
export class PublicService {
  constructor(private readonly drizzle: DrizzleService) {}

  async listCentres(): Promise<{ items: PublicCentreSummary[] }> {
    const rows = await this.drizzle.dbRead
      .select({
        id: centres.id,
        name: centres.name,
        locality: centres.locality,
        pincode: centres.pincode,
        contact_phone: centres.contact_phone,
        contact_email: centres.contact_email,
        city_id: centres.city_id,
        city_name: cities.name,
        state_name: states.name,
      })
      .from(centres)
      .innerJoin(cities, eq(cities.id, centres.city_id))
      .innerJoin(states, eq(states.id, cities.state_id))
      .where(and(eq(centres.status, 'active'), isNull(centres.deleted_at)))
      .orderBy(asc(states.name), asc(cities.name), asc(centres.name));

    const counts = await this.drizzle.dbRead
      .select({ centre_id: batches.centre_id, count: sql<number>`count(*)::int` })
      .from(batches)
      .where(and(eq(batches.status, 'active'), isNull(batches.deleted_at)))
      .groupBy(batches.centre_id);
    const countMap = new Map(counts.map((c) => [c.centre_id, c.count]));

    return { items: rows.map((r) => ({ ...r, batch_count: countMap.get(r.id) ?? 0 })) };
  }

  async getCentre(
    id: string,
  ): Promise<{
    centre: Omit<PublicCentreSummary, 'batch_count'> | null;
    batches: PublicBatchRow[];
  }> {
    const [centre] = await this.drizzle.dbRead
      .select({
        id: centres.id,
        name: centres.name,
        locality: centres.locality,
        pincode: centres.pincode,
        contact_phone: centres.contact_phone,
        contact_email: centres.contact_email,
        city_id: centres.city_id,
        city_name: cities.name,
        state_name: states.name,
      })
      .from(centres)
      .innerJoin(cities, eq(cities.id, centres.city_id))
      .innerJoin(states, eq(states.id, cities.state_id))
      .where(and(eq(centres.id, id), eq(centres.status, 'active'), isNull(centres.deleted_at)));

    if (!centre) return { centre: null, batches: [] };

    const batchRows = await this.drizzle.dbRead
      .select({
        id: batches.id,
        name: batches.name,
        age_group: batches.age_group,
        day_of_week: batches.day_of_week,
        start_time: batches.start_time,
        end_time: batches.end_time,
        capacity: batches.capacity,
        language_preference: batches.language_preference,
      })
      .from(batches)
      .where(
        and(eq(batches.centre_id, id), eq(batches.status, 'active'), isNull(batches.deleted_at)),
      )
      .orderBy(asc(batches.start_time));

    return { centre, batches: batchRows };
  }

  async listShivirs(): Promise<{ items: PublicShivirSummary[] }> {
    const today = new Date().toISOString().slice(0, 10);
    const rows = await this.drizzle.dbRead
      .select({
        id: shivir_events.id,
        name: shivir_events.name,
        description: shivir_events.description,
        start_date: shivir_events.start_date,
        end_date: shivir_events.end_date,
        location_text: shivir_events.location_text,
        city_id: shivir_events.city_id,
        city_name: cities.name,
      })
      .from(shivir_events)
      .innerJoin(cities, eq(cities.id, shivir_events.city_id))
      .where(and(gte(shivir_events.end_date, today), isNull(shivir_events.deleted_at)))
      .orderBy(asc(shivir_events.start_date));
    return { items: rows };
  }

  async getShivir(id: string): Promise<{
    event: (PublicShivirSummary & { capacity: number | null; msv_only: boolean }) | null;
    sessions: Array<{
      id: string;
      day_number: number;
      session_date: string;
      start_time: string;
      end_time: string;
    }>;
  }> {
    const [event] = await this.drizzle.dbRead
      .select({
        id: shivir_events.id,
        name: shivir_events.name,
        description: shivir_events.description,
        start_date: shivir_events.start_date,
        end_date: shivir_events.end_date,
        location_text: shivir_events.location_text,
        capacity: shivir_events.capacity,
        msv_only: shivir_events.msv_only,
        city_id: shivir_events.city_id,
        city_name: cities.name,
      })
      .from(shivir_events)
      .innerJoin(cities, eq(cities.id, shivir_events.city_id))
      .where(and(eq(shivir_events.id, id), isNull(shivir_events.deleted_at)));

    if (!event) return { event: null, sessions: [] };

    const sessions = await this.drizzle.dbRead
      .select({
        id: shivir_sessions.id,
        day_number: shivir_sessions.day_number,
        session_date: shivir_sessions.session_date,
        start_time: shivir_sessions.start_time,
        end_time: shivir_sessions.end_time,
      })
      .from(shivir_sessions)
      .where(eq(shivir_sessions.shivir_event_id, id))
      .orderBy(asc(shivir_sessions.day_number));

    return { event, sessions };
  }
}
