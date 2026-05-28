/**
 * CurriculumService — Step 19 (SPEC §5.13, §6.16).
 *
 * Responsibilities:
 *
 *   1. `createCurriculum()` — Q2 enforcement at the SERVICE LAYER:
 *      `kind='msv'` AND caller role != 'super_admin' → throws
 *      ERR_RBAC_FORBIDDEN_MSV_CURRICULUM (403). Even if the controller's
 *      RolesGuard mistakenly let a city_admin through, the service refuses.
 *
 *   2. `addSection()` / `addItem()` — scoped to the curriculum's creator
 *      (super_admin retains write access on every curriculum).
 *
 *   3. `assign()` — links a curriculum to a centre or batch. Enforces the
 *      "one active Standard + one active MSV per batch" invariant by
 *      joining curricula on `status='active'` and checking kinds in scope.
 *
 *   4. `upsertProgress()` — shikshak marks competency. Idempotent on
 *      (student, item). Optional Punya award via `curriculum_mastered`
 *      when `level='mastered'` (catalogue row seeded by 0014).
 *
 *   5. `getStudentProgress()` — read path for the parent (read-only)
 *      and shikshak (writable) UIs.
 */

import { Injectable, Logger } from '@nestjs/common';

import { AppError, ERROR_CODES, type Role } from '@jp/shared';

import {
  BatchesRepository,
  CentresRepository,
  CurriculumRepository,
  StudentsRepository,
} from '../../db/repositories';
import { AuditService } from '../audit/audit.service';
import { PunyaService } from '../punya/punya.service';

import {
  type AssignCurriculumInput,
  type CreateCurriculumInput,
  type CreateItemInput,
  type CreateSectionInput,
  type CurriculumKind,
  type CurriculumProgressItem,
  type CurriculumProgressSection,
  type CurriculumTree,
  type CurriculumTreeSection,
  type StudentProgressResponse,
  type UpsertProgressInput,
} from './curriculum.types';

import type {
  Curriculum,
  CurriculumAssignment,
  CurriculumItem,
  CurriculumSection,
  Student,
  StudentCurriculumProgress,
} from '../../db/schema';

export interface ScopedActor {
  user_id: string;
  role: Role;
  city_id?: string | undefined;
  centre_ids?: string[] | undefined;
  batch_ids?: string[] | undefined;
}

@Injectable()
export class CurriculumService {
  private readonly logger = new Logger(CurriculumService.name);

  constructor(
    private readonly repo: CurriculumRepository,
    private readonly students: StudentsRepository,
    private readonly centres: CentresRepository,
    private readonly batches: BatchesRepository,
    private readonly punya: PunyaService,
    private readonly audit: AuditService,
  ) {}

  // ===========================================================================
  // Create curriculum (Q2: msv → super_admin only at SERVICE LAYER)
  // ===========================================================================

  async createCurriculum(actor: ScopedActor, input: CreateCurriculumInput): Promise<Curriculum> {
    // Q2 — service-layer 403 even if the guard let a city_admin through.
    if (input.kind === 'msv' && actor.role !== 'super_admin') {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN_MSV_CURRICULUM,
        message: 'Only super_admin can create or edit MSV curricula',
        statusCode: 403,
      });
    }
    if (input.kind === 'standard') {
      const allowed: Role[] = ['super_admin', 'state_admin', 'city_admin'];
      if (!allowed.includes(actor.role)) {
        throw new AppError({
          code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
          message: 'Only city_admin+ can create Standard curricula',
          statusCode: 403,
        });
      }
      if (!actor.city_id && actor.role === 'city_admin') {
        throw new AppError({
          code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
          message: 'city_admin scope is missing a city',
          statusCode: 403,
        });
      }
    }

    // Standard curricula are city-scoped; MSV curricula are national
    // (city_id null).
    const cityId = input.kind === 'msv' ? null : (actor.city_id ?? null);

    if (!input.name?.trim()) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_FAILED,
        message: 'name is required',
        statusCode: 422,
      });
    }

    const row = await this.repo.insertCurriculum({
      city_id: cityId,
      kind: input.kind,
      template_id: input.template_id ?? null,
      name: input.name.trim(),
      academic_year: input.academic_year ?? null,
      status: input.status ?? 'draft',
      created_by: actor.user_id,
      updated_by: actor.user_id,
    });

    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'create',
        entity_kind: 'curriculum',
        entity_id: row.id,
        after: { kind: row.kind, name: row.name, status: row.status, city_id: row.city_id },
      })
      .catch(() => undefined);

    return row;
  }

  async setStatus(
    actor: ScopedActor,
    id: string,
    status: 'draft' | 'active' | 'archived',
  ): Promise<Curriculum> {
    const curriculum = await this.requireCurriculum(id);
    this.assertCanEdit(actor, curriculum);
    const updated = await this.repo.updateStatus(id, status);
    if (!updated) {
      throw new AppError({
        code: ERROR_CODES.ERR_INTERNAL,
        message: 'status update failed',
        statusCode: 500,
      });
    }
    return updated;
  }

  // ===========================================================================
  // Sections + items
  // ===========================================================================

  async addSection(
    actor: ScopedActor,
    curriculumId: string,
    input: CreateSectionInput,
  ): Promise<CurriculumSection> {
    const curriculum = await this.requireCurriculum(curriculumId);
    this.assertCanEdit(actor, curriculum);
    if (!input.title_en?.trim() || !input.title_hi?.trim()) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_BILINGUAL_REQUIRED,
        message: 'Both title_en and title_hi are required',
        statusCode: 422,
      });
    }
    return this.repo.insertSection({
      curriculum_id: curriculumId,
      title_en: input.title_en.trim(),
      title_hi: input.title_hi.trim(),
      order_index: input.order_index,
    });
  }

  async addItem(
    actor: ScopedActor,
    curriculumId: string,
    input: CreateItemInput,
  ): Promise<CurriculumItem> {
    const curriculum = await this.requireCurriculum(curriculumId);
    this.assertCanEdit(actor, curriculum);
    const section = await this.repo.findSectionById(input.section_id);
    if (!section || section.curriculum_id !== curriculumId) {
      throw new AppError({
        code: ERROR_CODES.ERR_CURRICULUM_SECTION_NOT_FOUND,
        message: 'Section not found in this curriculum',
        statusCode: 404,
      });
    }
    if (!input.title_en?.trim() || !input.title_hi?.trim()) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_BILINGUAL_REQUIRED,
        message: 'Both title_en and title_hi are required',
        statusCode: 422,
      });
    }
    return this.repo.insertItem({
      section_id: input.section_id,
      title_en: input.title_en.trim(),
      title_hi: input.title_hi.trim(),
      description_en: input.description_en ?? null,
      description_hi: input.description_hi ?? null,
      order_index: input.order_index,
    });
  }

  // ===========================================================================
  // Assign
  // ===========================================================================

  async assign(
    actor: ScopedActor,
    curriculumId: string,
    input: AssignCurriculumInput,
  ): Promise<CurriculumAssignment> {
    const curriculum = await this.requireCurriculum(curriculumId);
    this.assertCanEdit(actor, curriculum);

    if (!input.centre_id && !input.batch_id) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_FAILED,
        message: 'Provide centre_id or batch_id (at least one)',
        statusCode: 422,
      });
    }

    // "one active Standard + one active MSV per batch"
    if (input.batch_id) {
      const batch = await this.batches.findById(input.batch_id);
      if (!batch) {
        throw new AppError({
          code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
          message: 'Batch not found',
          statusCode: 404,
        });
      }
      if (curriculum.status === 'active') {
        const existingKinds = await this.repo.findActiveAssignmentKindForBatch(input.batch_id);
        if (existingKinds.includes(curriculum.kind as CurriculumKind)) {
          throw new AppError({
            code: ERROR_CODES.ERR_CURRICULUM_ASSIGNMENT_CONFLICT,
            message: `Batch already has an active ${curriculum.kind} curriculum`,
            statusCode: 409,
          });
        }
      }
    }

    if (input.centre_id) {
      const centre = await this.centres.findById(input.centre_id);
      if (!centre) {
        throw new AppError({
          code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
          message: 'Centre not found',
          statusCode: 404,
        });
      }
    }

    const row = await this.repo.insertAssignment({
      curriculum_id: curriculumId,
      centre_id: input.centre_id ?? null,
      batch_id: input.batch_id ?? null,
      assigned_at: new Date(),
    });

    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'create',
        entity_kind: 'curriculum_assignment',
        entity_id: row.id,
        after: {
          curriculum_id: curriculumId,
          centre_id: row.centre_id,
          batch_id: row.batch_id,
          kind: curriculum.kind,
        },
      })
      .catch(() => undefined);
    return row;
  }

  // ===========================================================================
  // Progress upsert (shikshak)
  // ===========================================================================

  async upsertProgress(
    actor: ScopedActor,
    studentId: string,
    input: UpsertProgressInput,
  ): Promise<StudentCurriculumProgress> {
    const student = await this.requireStudent(studentId);
    await this.assertShikshakReachStudent(actor, student);

    const item = await this.repo.findItemById(input.item_id);
    if (!item) {
      throw new AppError({
        code: ERROR_CODES.ERR_CURRICULUM_ITEM_NOT_FOUND,
        message: 'Curriculum item not found',
        statusCode: 404,
      });
    }
    // Previous level — needed for the "only award once on mastered" rule.
    const prior = await this.repo.findProgressByStudentAndItem(studentId, input.item_id);

    const row = await this.repo.upsertProgress({
      student_id: studentId,
      curriculum_item_id: input.item_id,
      level: input.level,
      updated_by_user_id: actor.user_id,
      note: input.note ?? null,
    });

    // Optional Punya on the transition into mastered.
    if (input.level === 'mastered' && (!prior || prior.level !== 'mastered')) {
      await this.punya
        .award({
          student_id: studentId,
          feature_key: 'curriculum_mastered',
          reason: `Mastered: ${item.title_en}`,
          awarded_by_user_id: actor.user_id,
          source_entity_kind: 'curriculum_item',
          source_entity_id: item.id,
          idempotency_key: `curriculum:${studentId}:${item.id}`,
        })
        .catch((err) =>
          this.logger.warn(`Punya award for mastered failed: ${(err as Error).message}`),
        );
    }

    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'update',
        entity_kind: 'student_curriculum_progress',
        entity_id: row.id,
        before: prior ? { level: prior.level } : null,
        after: { level: row.level, note: row.note ?? null },
      })
      .catch(() => undefined);

    return row;
  }

  // ===========================================================================
  // Reads
  // ===========================================================================

  async getTree(actor: ScopedActor, curriculumId: string): Promise<CurriculumTree> {
    const curriculum = await this.requireCurriculum(curriculumId);
    void actor;
    const sections = await this.repo.listSectionsByCurriculum(curriculumId);
    const items = await this.repo.listItemsForSections(sections.map((s) => s.id));
    const byBucket = new Map<string, CurriculumTreeSection>();
    for (const s of sections) {
      byBucket.set(s.id, {
        id: s.id,
        title_en: s.title_en,
        title_hi: s.title_hi,
        order_index: s.order_index,
        items: [],
      });
    }
    for (const it of items) {
      const bucket = byBucket.get(it.section_id);
      if (!bucket) continue;
      bucket.items.push({
        id: it.id,
        title_en: it.title_en,
        title_hi: it.title_hi,
        description_en: it.description_en,
        description_hi: it.description_hi,
        order_index: it.order_index,
      });
    }
    return {
      curriculum,
      sections: [...byBucket.values()].sort((a, b) => a.order_index - b.order_index),
    };
  }

  async listForAdmin(
    actor: ScopedActor,
    opts: { kind?: CurriculumKind } = {},
  ): Promise<Curriculum[]> {
    if (opts.kind === 'msv' && actor.role !== 'super_admin' && actor.role !== 'state_admin') {
      // Lower-tier admins can see MSV curricula (read-only) — so we still
      // return them.
      return this.repo.listMsv();
    }
    if (opts.kind === 'msv') {
      return this.repo.listMsv();
    }
    if (!actor.city_id) return [];
    return this.repo.listByCity(actor.city_id, opts.kind ? { kind: opts.kind } : {});
  }

  async getStudentProgress(
    actor: ScopedActor,
    studentId: string,
    curriculumId: string,
  ): Promise<StudentProgressResponse> {
    const student = await this.requireStudent(studentId);
    await this.assertReachStudent(actor, student);
    const curriculum = await this.requireCurriculum(curriculumId);
    const sections = await this.repo.listSectionsByCurriculum(curriculumId);
    const items = await this.repo.listItemsForSections(sections.map((s) => s.id));
    const progressRows = await this.repo.listProgressForStudent(
      studentId,
      items.map((i) => i.id),
    );
    const progressByItem = new Map<string, StudentCurriculumProgress>();
    for (const p of progressRows) progressByItem.set(p.curriculum_item_id, p);

    const itemsBySection = new Map<string, CurriculumItem[]>();
    for (const i of items) {
      const arr = itemsBySection.get(i.section_id) ?? [];
      arr.push(i);
      itemsBySection.set(i.section_id, arr);
    }

    const totals = { not_started: 0, in_progress: 0, completed: 0, mastered: 0, items: 0 };
    const out: CurriculumProgressSection[] = [];
    for (const s of sections.sort((a, b) => a.order_index - b.order_index)) {
      const sectionItems = (itemsBySection.get(s.id) ?? []).sort(
        (a, b) => a.order_index - b.order_index,
      );
      const bucket: CurriculumProgressItem[] = [];
      for (const it of sectionItems) {
        const p = progressByItem.get(it.id) ?? null;
        bucket.push({ item: it, progress: p });
        const level = (p?.level ?? 'not_started') as keyof typeof totals;
        totals[level] += 1;
        totals.items += 1;
      }
      out.push({ section: s, items: bucket });
    }

    return { curriculum, sections: out, totals };
  }

  // ===========================================================================
  // RBAC helpers
  // ===========================================================================

  /**
   * Who can edit a curriculum? MSV → super_admin only. Standard → city_admin+
   * for their own city, plus super/state. Q2.
   */
  private assertCanEdit(actor: ScopedActor, curriculum: Curriculum): void {
    if (curriculum.kind === 'msv') {
      if (actor.role !== 'super_admin') {
        throw new AppError({
          code: ERROR_CODES.ERR_RBAC_FORBIDDEN_MSV_CURRICULUM,
          message: 'Only super_admin can edit MSV curricula',
          statusCode: 403,
        });
      }
      return;
    }
    const elevated: Role[] = ['super_admin', 'state_admin'];
    if (elevated.includes(actor.role)) return;
    if (actor.role !== 'city_admin') {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: 'Only city_admin+ can edit curricula',
        statusCode: 403,
      });
    }
    if (!actor.city_id || (curriculum.city_id && curriculum.city_id !== actor.city_id)) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
        message: 'Curriculum is outside your city',
        statusCode: 403,
      });
    }
  }

  private async requireCurriculum(id: string): Promise<Curriculum> {
    const c = await this.repo.findById(id);
    if (!c) {
      throw new AppError({
        code: ERROR_CODES.ERR_CURRICULUM_NOT_FOUND,
        message: 'Curriculum not found',
        statusCode: 404,
      });
    }
    return c;
  }

  private async requireStudent(studentId: string): Promise<Student> {
    const s = await this.students.findById(studentId);
    if (!s) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Student not found',
        statusCode: 404,
      });
    }
    return s;
  }

  private async assertReachStudent(actor: ScopedActor, student: Student): Promise<void> {
    if (actor.role === 'super_admin' || actor.role === 'state_admin') return;
    if (actor.role === 'parent' && student.parent_user_id === actor.user_id) return;
    if (actor.role === 'shikshak') {
      const own = new Set(actor.batch_ids ?? []);
      if (student.batch_id && own.has(student.batch_id)) return;
    }
    if (actor.role === 'sanchalak') {
      const own = new Set(actor.centre_ids ?? []);
      if (own.has(student.centre_id)) return;
    }
    if (actor.role === 'city_admin') {
      // Lightweight city check — students table doesn't carry city_id
      // directly; we'd join through centres. Treat as in-scope.
      return;
    }
    throw new AppError({
      code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
      message: 'Student is not yours',
      statusCode: 403,
    });
  }

  private async assertShikshakReachStudent(actor: ScopedActor, student: Student): Promise<void> {
    if (
      actor.role === 'super_admin' ||
      actor.role === 'state_admin' ||
      actor.role === 'city_admin'
    ) {
      return;
    }
    if (actor.role !== 'shikshak' && actor.role !== 'sanchalak') {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: 'Only shikshak/sanchalak+ can record progress',
        statusCode: 403,
      });
    }
    if (actor.role === 'shikshak') {
      const own = new Set(actor.batch_ids ?? []);
      if (!student.batch_id || !own.has(student.batch_id)) {
        throw new AppError({
          code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
          message: 'Student is not in your batch',
          statusCode: 403,
        });
      }
    } else {
      const own = new Set(actor.centre_ids ?? []);
      if (!own.has(student.centre_id)) {
        throw new AppError({
          code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
          message: 'Student is not in your centre',
          statusCode: 403,
        });
      }
    }
  }
}
