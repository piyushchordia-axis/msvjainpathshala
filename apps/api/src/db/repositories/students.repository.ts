/**
 * StudentsRepository — query helpers for `students` (CLAUDE.md Q11:
 * students are NEVER hard-deleted; we use `status='inactive'` +
 * `deactivated_at`).
 *
 * Key methods:
 *   - findById, findByParent (parent's children including inactive)
 *   - list (sanchalak+ scoped)
 *   - create, update, deactivate, reactivate
 *   - generateStudentCode (deterministic, centre-prefixed)
 *
 * `generateStudentCode` reads `centres.code` (the alpha code seeded in
 * Step 6) and the per-centre counter to produce e.g. `MSV-AHM-00123`.
 */

import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { centres, cities, students } from '../schema';

import type { NewStudent, Student } from '../schema';
import type { StudentStatus } from '@jp/shared';

interface ListFilters {
  centre_id?: string;
  batch_id?: string;
  status?: StudentStatus;
  /** Restrict to students whose centre is in this list. */
  centre_ids?: string[];
  limit?: number;
  offset?: number;
}

@Injectable()
export class StudentsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async findById(id: string): Promise<Student | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(students)
      .where(and(eq(students.id, id), isNull(students.deleted_at)))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Parent's children — INCLUDES inactive per Step 10 prompt. The parent
   * needs to see deactivated students so they can ask for reactivation.
   */
  async findByParent(parentUserId: string): Promise<Student[]> {
    return this.drizzle.dbRead
      .select()
      .from(students)
      .where(and(eq(students.parent_user_id, parentUserId), isNull(students.deleted_at)))
      .orderBy(desc(students.enrolled_at));
  }

  async list(filters: ListFilters): Promise<Student[]> {
    const where = [isNull(students.deleted_at)];
    if (filters.centre_id) where.push(eq(students.centre_id, filters.centre_id));
    if (filters.batch_id) where.push(eq(students.batch_id, filters.batch_id));
    if (filters.status) where.push(eq(students.status, filters.status));
    if (filters.centre_ids?.length) where.push(inArray(students.centre_id, filters.centre_ids));

    const limit = Math.min(filters.limit ?? 50, 200);
    const offset = filters.offset ?? 0;

    return this.drizzle.dbRead
      .select()
      .from(students)
      .where(and(...where))
      .orderBy(desc(students.enrolled_at))
      .limit(limit)
      .offset(offset);
  }

  async create(input: NewStudent): Promise<Student> {
    const [row] = await this.drizzle.db.insert(students).values(input).returning();
    if (!row) {
      throw new Error('[StudentsRepository.create] INSERT … RETURNING produced no row');
    }
    return row;
  }

  async update(
    id: string,
    patch: Partial<Omit<NewStudent, 'id' | 'created_at' | 'parent_user_id'>>,
  ): Promise<Student | null> {
    const [row] = await this.drizzle.db
      .update(students)
      .set({ ...patch, updated_at: new Date() })
      .where(and(eq(students.id, id), isNull(students.deleted_at)))
      .returning();
    return row ?? null;
  }

  /**
   * Set `status='inactive'` + `deactivated_at`. Q11: NEVER hard-delete.
   * Re-activation reopens the student via {@link reactivate}.
   */
  async deactivate(id: string, deactivatedBy: string): Promise<Student | null> {
    const [row] = await this.drizzle.db
      .update(students)
      .set({
        status: 'inactive',
        deactivated_at: new Date(),
        updated_at: new Date(),
        updated_by: deactivatedBy,
      })
      .where(and(eq(students.id, id), isNull(students.deleted_at)))
      .returning();
    return row ?? null;
  }

  async reactivate(id: string, reactivatedBy: string): Promise<Student | null> {
    const [row] = await this.drizzle.db
      .update(students)
      .set({
        status: 'active',
        deactivated_at: null,
        updated_at: new Date(),
        updated_by: reactivatedBy,
      })
      .where(and(eq(students.id, id), isNull(students.deleted_at)))
      .returning();
    return row ?? null;
  }

  /**
   * Deterministic student code per centre. Format: `MSV-<CITY_CODE>-<NNNNN>`
   * where NNNNN is the next per-centre counter (5 digits, zero-padded).
   *
   * `centres` doesn't carry its own code column — we use the parent
   * city's `code` (seeded in Step 6 as e.g. 'AHM' for Ahmedabad). If a
   * city has no code we fall back to 'CTR' so the code is always
   * generable.
   *
   * Counter is the current row count for the centre — we expect callers
   * to invoke this inside the approve-enrolment transaction so two
   * concurrent approvals don't race on the same code.
   */
  async generateStudentCode(centreId: string): Promise<string> {
    const cityRow = await this.drizzle.db
      .select({ code: cities.code })
      .from(centres)
      .leftJoin(cities, eq(cities.id, centres.city_id))
      .where(eq(centres.id, centreId))
      .limit(1);
    const cityCode = (cityRow[0]?.code ?? 'CTR').toUpperCase();

    const [{ value: n } = { value: 0 }] = await this.drizzle.db
      .select({ value: count() })
      .from(students)
      .where(eq(students.centre_id, centreId));
    const seq = (n + 1).toString().padStart(5, '0');
    return `MSV-${cityCode}-${seq}`;
  }
}
