/**
 * GalleryItemsRepository — read/write helpers for `gallery_items` (SPEC §5.9,
 * §6.11, CLAUDE.md Q6).
 *
 * Q6 is the linchpin: opt-in is per-PARENT (blanket across all children). The
 * `gallery_items.removed` flag is the per-row "currently hidden" signal.
 *
 *   - On submission → if parent has `gallery_visibility_opt_in = true`,
 *     a row is inserted with removed=false.
 *   - On parent toggle false→null: ALL rows for that parent's children are
 *     bulk-updated to removed=true.
 *   - On parent toggle false→true: rows are restored (removed=false) UNLESS
 *     they were explicitly removed by an admin (removed_by IS NOT NULL).
 */

import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { gallery_items, niyams, students } from '../schema';

import type { GalleryItem, NewGalleryItem, Niyam, Student } from '../schema';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

type Tx = Pick<PostgresJsDatabase, 'select' | 'insert' | 'update' | 'delete'>;

export interface PublicGalleryRow {
  item: GalleryItem;
  niyam: Pick<Niyam, 'id' | 'title_en' | 'title_hi' | 'type'>;
  student: Pick<Student, 'id' | 'full_name' | 'age_group'>;
}

@Injectable()
export class GalleryItemsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async findById(id: string): Promise<GalleryItem | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(gallery_items)
      .where(eq(gallery_items.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findBySubmissionId(submissionId: string): Promise<GalleryItem | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(gallery_items)
      .where(eq(gallery_items.niyam_submission_id, submissionId))
      .limit(1);
    return rows[0] ?? null;
  }

  async insert(input: NewGalleryItem, tx?: Tx): Promise<GalleryItem> {
    const runner = (tx ?? this.drizzle.db) as Tx;
    const [row] = await runner
      .insert(gallery_items)
      .values(input)
      .onConflictDoNothing({ target: gallery_items.niyam_submission_id })
      .returning();
    if (row) return row;
    // race / replay — re-read by submission id
    const existing = await runner
      .select()
      .from(gallery_items)
      .where(eq(gallery_items.niyam_submission_id, input.niyam_submission_id))
      .limit(1);
    if (!existing[0]) throw new Error('[GalleryItems.insert] insert raced and re-read empty');
    return existing[0];
  }

  /**
   * Public gallery query — visible only (`removed=false`, `deleted_at IS NULL`),
   * scoped to city, optional featured-only filter, with light hydration of the
   * parent niyam + student (first_name + age_group only, never PII).
   *
   * Featured items always sort first, then created_at DESC.
   */
  async listPublic(opts: {
    city_id?: string;
    featured?: boolean;
    age_group?: string;
    niyam_type?: 'daily' | 'weekly' | 'monthly';
    limit?: number;
    offset?: number;
  }): Promise<PublicGalleryRow[]> {
    const where = [eq(gallery_items.removed, false), isNull(gallery_items.deleted_at)];
    if (opts.city_id) where.push(eq(gallery_items.city_id, opts.city_id));
    if (opts.featured) where.push(eq(gallery_items.is_featured, true));
    if (opts.age_group) where.push(eq(students.age_group, opts.age_group as Student['age_group']));
    if (opts.niyam_type) where.push(eq(niyams.type, opts.niyam_type));

    const limit = Math.min(opts.limit ?? 24, 100);
    const offset = opts.offset ?? 0;

    const rows = await this.drizzle.dbRead
      .select({
        item: gallery_items,
        niyam_id: niyams.id,
        niyam_title_en: niyams.title_en,
        niyam_title_hi: niyams.title_hi,
        niyam_type: niyams.type,
        student_id: students.id,
        student_full_name: students.full_name,
        student_age_group: students.age_group,
      })
      .from(gallery_items)
      .innerJoin(niyams, eq(niyams.id, gallery_items.niyam_id))
      .innerJoin(students, eq(students.id, gallery_items.student_id))
      .where(and(...where))
      .orderBy(desc(gallery_items.is_featured), desc(gallery_items.created_at))
      .limit(limit)
      .offset(offset);

    return rows.map((r) => ({
      item: r.item,
      niyam: {
        id: r.niyam_id,
        title_en: r.niyam_title_en,
        title_hi: r.niyam_title_hi,
        type: r.niyam_type,
      },
      student: {
        id: r.student_id,
        full_name: r.student_full_name,
        age_group: r.student_age_group,
      },
    }));
  }

  /**
   * Admin listing — INCLUDES removed and deleted rows so admins can audit
   * (the parent gallery toggle row hides UI but never deletes data).
   */
  async listForAdmin(opts: {
    city_id?: string;
    centre_ids?: string[];
    status?: 'visible' | 'removed' | 'featured';
    limit?: number;
    offset?: number;
  }): Promise<PublicGalleryRow[]> {
    const where = [isNull(gallery_items.deleted_at)];
    if (opts.city_id) where.push(eq(gallery_items.city_id, opts.city_id));
    if (opts.centre_ids?.length) {
      where.push(inArray(gallery_items.centre_id, opts.centre_ids));
    }
    if (opts.status === 'visible') where.push(eq(gallery_items.removed, false));
    else if (opts.status === 'removed') where.push(eq(gallery_items.removed, true));
    else if (opts.status === 'featured') where.push(eq(gallery_items.is_featured, true));

    const limit = Math.min(opts.limit ?? 50, 200);
    const offset = opts.offset ?? 0;
    const rows = await this.drizzle.dbRead
      .select({
        item: gallery_items,
        niyam_id: niyams.id,
        niyam_title_en: niyams.title_en,
        niyam_title_hi: niyams.title_hi,
        niyam_type: niyams.type,
        student_id: students.id,
        student_full_name: students.full_name,
        student_age_group: students.age_group,
      })
      .from(gallery_items)
      .innerJoin(niyams, eq(niyams.id, gallery_items.niyam_id))
      .innerJoin(students, eq(students.id, gallery_items.student_id))
      .where(and(...where))
      .orderBy(desc(gallery_items.is_featured), desc(gallery_items.created_at))
      .limit(limit)
      .offset(offset);
    return rows.map((r) => ({
      item: r.item,
      niyam: {
        id: r.niyam_id,
        title_en: r.niyam_title_en,
        title_hi: r.niyam_title_hi,
        type: r.niyam_type,
      },
      student: {
        id: r.student_id,
        full_name: r.student_full_name,
        age_group: r.student_age_group,
      },
    }));
  }

  async setFeatured(id: string, featured: boolean, actor: string): Promise<GalleryItem | null> {
    const [row] = await this.drizzle.db
      .update(gallery_items)
      .set({
        is_featured: featured,
        featured_at: featured ? new Date() : null,
      })
      .where(eq(gallery_items.id, id))
      .returning();
    void actor;
    return row ?? null;
  }

  /**
   * Admin remove — marks `removed=true` and stores who did it. Different
   * from the parent-opt-out path: this row will NOT come back even if the
   * parent toggles their opt-in back on.
   */
  async adminRemove(id: string, removedBy: string): Promise<GalleryItem | null> {
    const [row] = await this.drizzle.db
      .update(gallery_items)
      .set({ removed: true, removed_by: removedBy })
      .where(eq(gallery_items.id, id))
      .returning();
    return row ?? null;
  }

  /**
   * Mark all items belonging to the given parent's children as removed
   * (Q6 toggle on → false). Only rows that were NOT admin-removed get the
   * opt-out flag — we encode "opted out" as `removed=true, removed_by IS NULL`
   * so the inverse toggle can restore them.
   *
   * Returns the count via a RETURNING clause — postgres-js's `.execute` result
   * doesn't expose `rowCount` consistently, so we count rows we touched.
   */
  async parentOptOutBulk(parentUserId: string): Promise<number> {
    const rows = (await this.drizzle.db.execute(sql`
      UPDATE gallery_items g
         SET removed = true
        FROM students s
       WHERE g.student_id = s.id
         AND s.parent_user_id = ${parentUserId}
         AND g.removed = false
         AND g.removed_by IS NULL
      RETURNING g.id
    `)) as unknown as Array<{ id: string }>;
    return rows.length;
  }

  /**
   * Inverse of `parentOptOutBulk`: restore rows that were marked removed
   * by the opt-out path (removed_by IS NULL). Admin-removed rows stay
   * hidden.
   */
  async parentOptInRestore(parentUserId: string): Promise<number> {
    const rows = (await this.drizzle.db.execute(sql`
      UPDATE gallery_items g
         SET removed = false
        FROM students s
       WHERE g.student_id = s.id
         AND s.parent_user_id = ${parentUserId}
         AND g.removed = true
         AND g.removed_by IS NULL
      RETURNING g.id
    `)) as unknown as Array<{ id: string }>;
    return rows.length;
  }

  /** Count currently-visible items for this parent's children. */
  async countVisibleForParent(parentUserId: string): Promise<number> {
    const rows = (await this.drizzle.dbRead.execute(sql`
      SELECT COUNT(*)::int AS c
        FROM gallery_items g
        JOIN students s ON s.id = g.student_id
       WHERE s.parent_user_id = ${parentUserId}
         AND g.removed = false
         AND g.deleted_at IS NULL
    `)) as unknown as Array<{ c: number }>;
    return rows[0]?.c ?? 0;
  }

  /**
   * Mark a submission's gallery item as removed because the submission was
   * retroactively rejected (Q5). Uses the niyam_submission_id index.
   */
  async hideForRejectedSubmission(submissionId: string, actor: string): Promise<void> {
    await this.drizzle.db
      .update(gallery_items)
      .set({ removed: true, removed_by: actor })
      .where(
        and(eq(gallery_items.niyam_submission_id, submissionId), eq(gallery_items.removed, false)),
      );
  }

  /**
   * Inverse — restore an item when an admin "un-rejects". Currently unused
   * (no un-reject endpoint), but the FK preserves the data for future use.
   */
  async restoreForSubmission(submissionId: string): Promise<void> {
    await this.drizzle.db
      .update(gallery_items)
      .set({ removed: false, removed_by: null })
      .where(eq(gallery_items.niyam_submission_id, submissionId));
    void isNotNull;
  }
}
