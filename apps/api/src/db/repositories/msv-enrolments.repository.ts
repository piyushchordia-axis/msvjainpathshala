/**
 * MsvEnrolmentsRepository — query helpers for `msv_enrolments`.
 *
 * CLAUDE.md Q1: MSV decisions are PURELY admin discretion. No
 * eligibility validation, no age checks, no auto-eligibility. The
 * service layer just walks the state machine.
 */

import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { msv_enrolments, students } from '../schema';

import type { MsvEnrolment, NewMsvEnrolment } from '../schema';
import type { MsvStatus } from '@jp/shared';

interface ListFilters {
  status?: MsvStatus;
  centre_ids?: string[];
  limit?: number;
  offset?: number;
}

@Injectable()
export class MsvEnrolmentsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async findById(id: string): Promise<MsvEnrolment | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(msv_enrolments)
      .where(eq(msv_enrolments.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findActiveByStudent(studentId: string): Promise<MsvEnrolment | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(msv_enrolments)
      .where(
        and(
          eq(msv_enrolments.student_id, studentId),
          // not-yet-finally-decided rows we'd refuse to duplicate
          inArray(msv_enrolments.status, ['applied', 'waitlisted', 'approved']),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async create(input: NewMsvEnrolment): Promise<MsvEnrolment> {
    const [row] = await this.drizzle.db.insert(msv_enrolments).values(input).returning();
    if (!row) {
      throw new Error('[MsvEnrolmentsRepository.create] INSERT … RETURNING produced no row');
    }
    return row;
  }

  /** city_admin+ list. Service filters by scope (`centre_ids`). */
  async list(filters: ListFilters): Promise<MsvEnrolment[]> {
    const where = [];
    if (filters.status) where.push(eq(msv_enrolments.status, filters.status));
    if (filters.centre_ids?.length) {
      // Join via the student → centre.
      const out = await this.drizzle.dbRead
        .select({ m: msv_enrolments })
        .from(msv_enrolments)
        .leftJoin(students, eq(students.id, msv_enrolments.student_id))
        .where(
          and(
            inArray(students.centre_id, filters.centre_ids),
            isNull(students.deleted_at),
            ...where,
          ),
        )
        .orderBy(desc(msv_enrolments.created_at))
        .limit(Math.min(filters.limit ?? 50, 200))
        .offset(filters.offset ?? 0);
      return out.map((r) => r.m);
    }
    return this.drizzle.dbRead
      .select()
      .from(msv_enrolments)
      .where(and(...where))
      .orderBy(desc(msv_enrolments.created_at))
      .limit(Math.min(filters.limit ?? 50, 200))
      .offset(filters.offset ?? 0);
  }

  async updateStatus(
    id: string,
    patch: Partial<{
      status: MsvStatus;
      reviewer_user_id: string;
      decided_at: Date;
      notes: string | null;
      updated_by: string;
    }>,
  ): Promise<MsvEnrolment | null> {
    const [row] = await this.drizzle.db
      .update(msv_enrolments)
      .set({ ...patch, updated_at: new Date() })
      .where(eq(msv_enrolments.id, id))
      .returning();
    return row ?? null;
  }
}
