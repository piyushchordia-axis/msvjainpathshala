/**
 * CurriculumRepository — write/read helpers for curriculum_templates,
 * curricula, sections, items, assignments and student progress
 * (SPEC §5.13, §6.16).
 *
 * Houses six logical tables under one class to keep the wiring lean — the
 * service module needs all of them and they're tightly coupled anyway.
 */

import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import {
  curricula,
  curriculum_assignments,
  curriculum_items,
  curriculum_sections,
  curriculum_templates,
  student_curriculum_progress,
} from '../schema';

import type {
  Curriculum,
  CurriculumAssignment,
  CurriculumItem,
  CurriculumSection,
  CurriculumTemplate,
  NewCurriculum,
  NewCurriculumAssignment,
  NewCurriculumItem,
  NewCurriculumSection,
  NewCurriculumTemplate,
  NewStudentCurriculumProgress,
  StudentCurriculumProgress,
} from '../schema';

export type CurriculumKind = 'standard' | 'msv';

@Injectable()
export class CurriculumRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  // ===========================================================================
  // Templates (super_admin masters)
  // ===========================================================================

  async insertTemplate(input: NewCurriculumTemplate): Promise<CurriculumTemplate> {
    const [row] = await this.drizzle.db.insert(curriculum_templates).values(input).returning();
    if (!row) throw new Error('[Curriculum.insertTemplate] no row returned');
    return row;
  }

  async findTemplateById(id: string): Promise<CurriculumTemplate | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(curriculum_templates)
      .where(eq(curriculum_templates.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  // ===========================================================================
  // Curricula
  // ===========================================================================

  async insertCurriculum(input: NewCurriculum): Promise<Curriculum> {
    const [row] = await this.drizzle.db.insert(curricula).values(input).returning();
    if (!row) throw new Error('[Curriculum.insertCurriculum] no row returned');
    return row;
  }

  async findById(id: string): Promise<Curriculum | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(curricula)
      .where(eq(curricula.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async listByCity(cityId: string, opts: { kind?: CurriculumKind } = {}): Promise<Curriculum[]> {
    const where = [eq(curricula.city_id, cityId)];
    if (opts.kind) where.push(eq(curricula.kind, opts.kind));
    return this.drizzle.dbRead
      .select()
      .from(curricula)
      .where(and(...where))
      .orderBy(asc(curricula.name));
  }

  async listMsv(): Promise<Curriculum[]> {
    return this.drizzle.dbRead
      .select()
      .from(curricula)
      .where(eq(curricula.kind, 'msv'))
      .orderBy(asc(curricula.name));
  }

  async updateStatus(id: string, status: string): Promise<Curriculum | null> {
    const [row] = await this.drizzle.db
      .update(curricula)
      .set({ status, updated_at: new Date() })
      .where(eq(curricula.id, id))
      .returning();
    return row ?? null;
  }

  // ===========================================================================
  // Sections
  // ===========================================================================

  async insertSection(input: NewCurriculumSection): Promise<CurriculumSection> {
    const [row] = await this.drizzle.db.insert(curriculum_sections).values(input).returning();
    if (!row) throw new Error('[Curriculum.insertSection] no row returned');
    return row;
  }

  async listSectionsByCurriculum(curriculumId: string): Promise<CurriculumSection[]> {
    return this.drizzle.dbRead
      .select()
      .from(curriculum_sections)
      .where(eq(curriculum_sections.curriculum_id, curriculumId))
      .orderBy(asc(curriculum_sections.order_index));
  }

  async findSectionById(id: string): Promise<CurriculumSection | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(curriculum_sections)
      .where(eq(curriculum_sections.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  // ===========================================================================
  // Items
  // ===========================================================================

  async insertItem(input: NewCurriculumItem): Promise<CurriculumItem> {
    const [row] = await this.drizzle.db.insert(curriculum_items).values(input).returning();
    if (!row) throw new Error('[Curriculum.insertItem] no row returned');
    return row;
  }

  async findItemById(id: string): Promise<CurriculumItem | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(curriculum_items)
      .where(eq(curriculum_items.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async listItemsForSections(sectionIds: string[]): Promise<CurriculumItem[]> {
    if (sectionIds.length === 0) return [];
    return this.drizzle.dbRead
      .select()
      .from(curriculum_items)
      .where(inArray(curriculum_items.section_id, sectionIds))
      .orderBy(asc(curriculum_items.order_index));
  }

  // ===========================================================================
  // Assignments
  // ===========================================================================

  async insertAssignment(input: NewCurriculumAssignment): Promise<CurriculumAssignment> {
    const [row] = await this.drizzle.db.insert(curriculum_assignments).values(input).returning();
    if (!row) throw new Error('[Curriculum.insertAssignment] no row returned');
    return row;
  }

  async listAssignmentsForBatch(batchId: string): Promise<CurriculumAssignment[]> {
    return this.drizzle.dbRead
      .select()
      .from(curriculum_assignments)
      .where(eq(curriculum_assignments.batch_id, batchId));
  }

  /**
   * Service-layer enforcement of "one active Standard + one active MSV per
   * batch" — returns the colliding curriculum.kind, if any.
   *
   * "Active" means `curricula.status = 'active'` (NULL is treated as draft).
   */
  async findActiveAssignmentKindForBatch(batchId: string): Promise<CurriculumKind[]> {
    const rows = await this.drizzle.dbRead
      .select({ kind: curricula.kind })
      .from(curriculum_assignments)
      .innerJoin(curricula, eq(curricula.id, curriculum_assignments.curriculum_id))
      .where(and(eq(curriculum_assignments.batch_id, batchId), eq(curricula.status, 'active')));
    return rows.map((r) => r.kind as CurriculumKind);
  }

  /** Active curricula (id + kind) assigned to a batch — used to resolve a
   *  student's curriculum for the parent-facing progress view. */
  async findActiveCurriculaForBatch(
    batchId: string,
  ): Promise<Array<{ curriculum_id: string; kind: CurriculumKind }>> {
    const rows = await this.drizzle.dbRead
      .select({ curriculum_id: curriculum_assignments.curriculum_id, kind: curricula.kind })
      .from(curriculum_assignments)
      .innerJoin(curricula, eq(curricula.id, curriculum_assignments.curriculum_id))
      .where(and(eq(curriculum_assignments.batch_id, batchId), eq(curricula.status, 'active')));
    return rows.map((r) => ({ curriculum_id: r.curriculum_id, kind: r.kind as CurriculumKind }));
  }

  // ===========================================================================
  // Progress
  // ===========================================================================

  async upsertProgress(input: NewStudentCurriculumProgress): Promise<StudentCurriculumProgress> {
    const [row] = await this.drizzle.db
      .insert(student_curriculum_progress)
      .values(input)
      .onConflictDoUpdate({
        target: [
          student_curriculum_progress.student_id,
          student_curriculum_progress.curriculum_item_id,
        ],
        set: {
          level: input.level,
          updated_by_user_id: input.updated_by_user_id,
          note: input.note ?? null,
          updated_at: new Date(),
        },
      })
      .returning();
    if (!row) throw new Error('[Curriculum.upsertProgress] no row returned');
    return row;
  }

  async findProgressByStudentAndItem(
    studentId: string,
    itemId: string,
  ): Promise<StudentCurriculumProgress | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(student_curriculum_progress)
      .where(
        and(
          eq(student_curriculum_progress.student_id, studentId),
          eq(student_curriculum_progress.curriculum_item_id, itemId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async listProgressForStudent(
    studentId: string,
    itemIds: string[],
  ): Promise<StudentCurriculumProgress[]> {
    if (itemIds.length === 0) return [];
    return this.drizzle.dbRead
      .select()
      .from(student_curriculum_progress)
      .where(
        and(
          eq(student_curriculum_progress.student_id, studentId),
          inArray(student_curriculum_progress.curriculum_item_id, itemIds),
        ),
      );
  }

  /** Recently-touched progress rows, used by tests. */
  async recentProgressRowsForStudent(
    studentId: string,
    limit = 100,
  ): Promise<StudentCurriculumProgress[]> {
    return this.drizzle.dbRead
      .select()
      .from(student_curriculum_progress)
      .where(eq(student_curriculum_progress.student_id, studentId))
      .orderBy(sql`${student_curriculum_progress.updated_at} DESC`)
      .limit(limit);
  }
}
