/**
 * EnrolmentsRepository — query helpers for the `enrolments` table.
 *
 * Notes:
 *   - We use `dbRead` for queries that don't need transactional consistency,
 *     and `db` (write pool) inside transactions handed in via `tx`.
 *   - All lookups exclude soft-deleted rows by default.
 *   - Duplicate detection lives here (Step 10): same first_name + dob +
 *     parent_phone → meta.warning. The service decides whether to flag
 *     or block.
 */

import { Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, inArray, isNull, sql } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { enrolments, students, users } from '../schema';

import type { Enrolment, NewEnrolment } from '../schema';
import type { EnrolmentStatus } from '@jp/shared';

interface ListFilters {
  status?: EnrolmentStatus;
  batch_id?: string;
  centre_id?: string;
  /** Restrict to enrolments whose requested_centre_id is in this list. */
  centre_ids?: string[];
  /** Optional case-insensitive substring search on parent phone / display name. */
  search?: string;
  limit?: number;
  offset?: number;
}

interface DuplicateCriteria {
  full_name: string;
  dob: string; // YYYY-MM-DD
  parent_user_id: string;
}

@Injectable()
export class EnrolmentsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async findById(id: string): Promise<Enrolment | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(enrolments)
      .where(and(eq(enrolments.id, id), isNull(enrolments.deleted_at)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Insert + return. Used both for guest sign-up and parent add-child. */
  async create(input: NewEnrolment): Promise<Enrolment> {
    const [row] = await this.drizzle.db.insert(enrolments).values(input).returning();
    if (!row) {
      throw new Error('[EnrolmentsRepository.create] INSERT … RETURNING produced no row');
    }
    return row;
  }

  /**
   * Sanchalak+ list with optional filters. The service is responsible for
   * passing `centre_ids` derived from the actor's scope.
   */
  async list(filters: ListFilters): Promise<Enrolment[]> {
    const where = [isNull(enrolments.deleted_at)];
    if (filters.status) where.push(eq(enrolments.status, filters.status));
    if (filters.batch_id) where.push(eq(enrolments.requested_batch_id, filters.batch_id));
    if (filters.centre_id) where.push(eq(enrolments.requested_centre_id, filters.centre_id));
    if (filters.centre_ids?.length) {
      where.push(inArray(enrolments.requested_centre_id, filters.centre_ids));
    }
    if (filters.search) {
      where.push(ilike(users.phone, `%${filters.search}%`));
    }

    const limit = Math.min(filters.limit ?? 50, 200);
    const offset = filters.offset ?? 0;

    const rows = await this.drizzle.dbRead
      .select({ e: enrolments })
      .from(enrolments)
      .leftJoin(users, eq(users.id, enrolments.parent_user_id))
      .where(and(...where))
      .orderBy(desc(enrolments.created_at))
      .limit(limit)
      .offset(offset);

    return rows.map((r) => r.e);
  }

  /**
   * Duplicate detection (Step 10 prompt): same first_name + dob + same
   * parent. We compare against `students` rather than `enrolments` so a
   * previously-approved sibling triggers the warning, not a still-pending
   * application. Returns the matching student id if any.
   */
  async findDuplicateStudent({
    full_name,
    dob,
    parent_user_id,
  }: DuplicateCriteria): Promise<string | null> {
    // Compare on the first token of full_name (the prompt says "first_name").
    // Postgres' split_part is stable on UTF-8 so this works for Devanagari too.
    const rows = await this.drizzle.dbRead
      .select({ id: students.id })
      .from(students)
      .where(
        and(
          eq(students.parent_user_id, parent_user_id),
          eq(students.dob, dob),
          sql`lower(split_part(${students.full_name}, ' ', 1)) = lower(split_part(${full_name}, ' ', 1))`,
          isNull(students.deleted_at),
        ),
      )
      .limit(1);
    return rows[0]?.id ?? null;
  }

  async updateStatus(
    id: string,
    patch: Partial<{
      status: EnrolmentStatus;
      reviewer_user_id: string;
      decided_at: Date;
      rejection_reason: string | null;
      student_id: string | null;
      updated_by: string;
    }>,
  ): Promise<Enrolment | null> {
    const [row] = await this.drizzle.db
      .update(enrolments)
      .set({ ...patch, updated_at: new Date() })
      .where(and(eq(enrolments.id, id), isNull(enrolments.deleted_at)))
      .returning();
    return row ?? null;
  }
}
