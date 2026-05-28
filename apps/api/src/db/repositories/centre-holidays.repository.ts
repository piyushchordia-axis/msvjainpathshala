/**
 * CentreHolidaysRepository — per-centre closure dates.
 *
 * §5.6 — list filtered by an optional [from, to] window for the public
 * calendar surface. Step 6 service emits the `notifications.fanout` queue
 * job on create so parents get an in-app + push notification.
 */

import { Injectable } from '@nestjs/common';
import { and, asc, between, eq, gte, lte } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { centre_holidays } from '../schema';

import type { CentreHoliday, NewCentreHoliday } from '../schema';

@Injectable()
export class CentreHolidaysRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async findById(id: string): Promise<CentreHoliday | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(centre_holidays)
      .where(eq(centre_holidays.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Holidays overlapping the inclusive [from, to] window. */
  async listForCentre(
    centreId: string,
    opts: { from?: string; to?: string } = {},
  ): Promise<CentreHoliday[]> {
    const filters = [eq(centre_holidays.centre_id, centreId)];
    if (opts.from && opts.to) {
      // Overlap predicate: holiday's start_date ≤ to AND end_date ≥ from.
      filters.push(lte(centre_holidays.start_date, opts.to));
      filters.push(gte(centre_holidays.end_date, opts.from));
    } else if (opts.from) {
      filters.push(gte(centre_holidays.end_date, opts.from));
    } else if (opts.to) {
      filters.push(lte(centre_holidays.start_date, opts.to));
    }
    // `between` is imported for completeness; not used here.
    void between;
    return this.drizzle.dbRead
      .select()
      .from(centre_holidays)
      .where(and(...filters))
      .orderBy(asc(centre_holidays.start_date));
  }

  async create(input: NewCentreHoliday): Promise<CentreHoliday> {
    const [row] = await this.drizzle.db.insert(centre_holidays).values(input).returning();
    if (!row) throw new Error('[CentreHolidays.create] insert returned no row');
    return row;
  }

  async delete(id: string): Promise<void> {
    await this.drizzle.db.delete(centre_holidays).where(eq(centre_holidays.id, id));
  }
}
