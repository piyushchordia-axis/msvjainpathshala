/**
 * LibraryRepository — `library_items` + `library_access_logs` (SPEC §5.16).
 *
 * Reads filter by `access_tier`/`msv_only` at the SQL level so the service
 * never has to post-filter. Writes carry the soft-delete column so admin
 * delete is non-destructive.
 *
 * Q7 invariants (enforced by LibraryService BEFORE calling create):
 *   - content_type='video'  → embed_url NOT NULL, asset_id NULL
 *   - content_type in (pdf, audio, image) → asset_id NOT NULL, embed_url NULL
 */

import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { library_access_logs, library_items } from '../schema';

import type { LibraryAccessLog, LibraryItem, NewLibraryAccessLog, NewLibraryItem } from '../schema';
import type { LibraryAccessTier, LibraryContentType } from '@jp/shared';

export interface LibraryListFilter {
  tiers: LibraryAccessTier[];
  /** True only if caller is MSV-approved (or shikshak+). */
  msv_visible: boolean;
  content_type?: LibraryContentType;
  city_id?: string;
  limit?: number;
  offset?: number;
}

@Injectable()
export class LibraryRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  // -------------------------------------------------------------------------
  // library_items
  // -------------------------------------------------------------------------

  async create(input: NewLibraryItem): Promise<LibraryItem> {
    const [row] = await this.drizzle.db.insert(library_items).values(input).returning();
    if (!row) throw new Error('[Library.create] no row returned');
    return row;
  }

  async findById(id: string): Promise<LibraryItem | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(library_items)
      .where(and(eq(library_items.id, id), isNull(library_items.deleted_at)))
      .limit(1);
    return rows[0] ?? null;
  }

  async list(filter: LibraryListFilter): Promise<LibraryItem[]> {
    const where = [isNull(library_items.deleted_at)];
    if (filter.tiers.length > 0) {
      where.push(inArray(library_items.access_tier, filter.tiers));
    } else {
      // Caller can see nothing — short-circuit.
      return [];
    }
    if (!filter.msv_visible) {
      where.push(eq(library_items.msv_only, false));
    }
    if (filter.content_type) {
      where.push(eq(library_items.content_type, filter.content_type));
    }
    if (filter.city_id) {
      where.push(eq(library_items.city_id, filter.city_id));
    }
    const rows = await this.drizzle.dbRead
      .select()
      .from(library_items)
      .where(and(...where))
      .orderBy(desc(library_items.created_at))
      .limit(filter.limit ?? 50)
      .offset(filter.offset ?? 0);
    return rows;
  }

  async softDelete(id: string): Promise<void> {
    await this.drizzle.db
      .update(library_items)
      .set({ deleted_at: new Date(), updated_at: new Date() })
      .where(eq(library_items.id, id));
  }

  // -------------------------------------------------------------------------
  // library_access_logs
  // -------------------------------------------------------------------------

  async logAccess(input: NewLibraryAccessLog): Promise<LibraryAccessLog> {
    const [row] = await this.drizzle.db.insert(library_access_logs).values(input).returning();
    if (!row) throw new Error('[Library.logAccess] no row returned');
    return row;
  }

  /**
   * Counts per item across the trailing N days — used by the admin
   * "popular items" panel on the library management screen.
   */
  async countsByItem(sinceDays = 30): Promise<Array<{ item_id: string; views: number }>> {
    const rows = await this.drizzle.dbRead.execute(sql`
      SELECT item_id, COUNT(*)::int AS views
        FROM library_access_logs
       WHERE at >= now() - (${sinceDays}::text || ' days')::interval
         AND action = 'view'
       GROUP BY item_id
       ORDER BY views DESC
       LIMIT 50
    `);
    return rows as unknown as Array<{ item_id: string; views: number }>;
  }
}
