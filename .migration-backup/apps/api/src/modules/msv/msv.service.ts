/**
 * MsvService — Megh Sanskar Vatika programme application + admin
 * approval workflow.
 *
 * Q1: NO eligibility validation. No age checks. No score thresholds.
 * Admins decide purely on their discretion.
 *
 * Workflow:
 *   1. Parent applies via POST /v1/msv/enrolments { student_id, note }.
 *      Status starts at 'applied'.
 *   2. city_admin+ lists `/v1/msv/enrolments?status=applied`.
 *   3. city_admin+ decides via approve / reject. Approve flips the
 *      student's `msv_status` to 'approved' and enqueues an ID card
 *      regeneration (the MSV badge appears on the card).
 *
 * Notifying the parent + ID card regeneration are enqueued; the
 * workers themselves land per the relevant feature step.
 */

import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';

import { AppError, ERROR_CODES, QUEUES, type Role, MsvStatus } from '@jp/shared';

import { DrizzleService } from '../../core/database/drizzle.service';
import { RedisService } from '../../core/redis/redis.service';
import {
  CentresRepository,
  MsvEnrolmentsRepository,
  StudentsRepository,
} from '../../db/repositories';
import { students } from '../../db/schema';
import { AuditService } from '../audit/audit.service';

import type { MsvEnrolment } from '../../db/schema';

export interface ScopedActor {
  user_id: string;
  role: Role;
  city_id?: string | undefined;
  centre_ids?: string[] | undefined;
}

export interface ApplyInput {
  student_id: string;
  note?: string;
}

export interface ListFilters {
  status?: MsvStatus;
  limit?: number;
  offset?: number;
}

@Injectable()
export class MsvService {
  private readonly fanoutQueue: Queue;
  private readonly idCardQueue: Queue;

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly repo: MsvEnrolmentsRepository,
    private readonly studentsRepo: StudentsRepository,
    private readonly centresRepo: CentresRepository,
    private readonly audit: AuditService,
    redis: RedisService,
  ) {
    this.fanoutQueue = new Queue(QUEUES.NOTIFICATIONS_FANOUT, {
      connection: redis.bullmqClient,
    });
    this.idCardQueue = new Queue(QUEUES.ID_CARD_GENERATION, {
      connection: redis.bullmqClient,
    });
  }

  // ---- Parent submit ----------------------------------------------------

  async apply(actor: ScopedActor, input: ApplyInput): Promise<MsvEnrolment> {
    const student = await this.studentsRepo.findById(input.student_id);
    if (!student) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Student not found',
        statusCode: 404,
      });
    }
    if (actor.role === 'parent' && student.parent_user_id !== actor.user_id) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
        message: 'You can only apply for your own children',
        statusCode: 403,
      });
    }

    // Duplicate-application guard: only one open application per student
    // at a time. Already-rejected / revoked rows don't block a re-apply.
    const existing = await this.repo.findActiveByStudent(input.student_id);
    if (existing) {
      throw new AppError({
        code: ERROR_CODES.ERR_DUPLICATE_RESOURCE,
        message: `An MSV application already exists (status: ${existing.status})`,
        statusCode: 409,
      });
    }

    const created = await this.repo.create({
      student_id: input.student_id,
      status: 'applied',
      motivation_statement_redacted: input.note ?? null,
      created_by: actor.user_id,
      updated_by: actor.user_id,
    });

    await this.fanoutQueue
      .add('msv.applied', {
        event: 'msv.applied',
        msv_enrolment_id: created.id,
        student_id: input.student_id,
        parent_user_id: student.parent_user_id,
      })
      .catch(() => undefined);
    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'msv.applied',
        entity_kind: 'msv_enrolment',
        entity_id: created.id,
        after: { student_id: input.student_id, note: input.note ?? null },
      })
      .catch(() => undefined);

    return created;
  }

  // ---- Admin list / decisions ------------------------------------------

  async list(actor: ScopedActor, filters: ListFilters): Promise<MsvEnrolment[]> {
    const scope = await this.resolveCentreScope(actor);
    return this.repo.list({
      ...filters,
      ...(scope ? { centre_ids: scope } : {}),
    });
  }

  async getById(actor: ScopedActor, id: string): Promise<MsvEnrolment> {
    const row = await this.repo.findById(id);
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'MSV application not found',
        statusCode: 404,
      });
    }
    const student = await this.studentsRepo.findById(row.student_id);
    if (student) {
      const scope = await this.resolveCentreScope(actor);
      if (scope !== null && !scope.includes(student.centre_id)) {
        throw new AppError({
          code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
          message: 'Application is outside your scope',
          statusCode: 403,
        });
      }
    }
    return row;
  }

  async approve(actor: ScopedActor, id: string, notes?: string): Promise<MsvEnrolment> {
    return this.decide(actor, id, 'approved', notes);
  }

  async reject(actor: ScopedActor, id: string, notes: string): Promise<MsvEnrolment> {
    if (!notes.trim()) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_FAILED,
        message: 'notes (reason) is required for reject',
        statusCode: 422,
      });
    }
    return this.decide(actor, id, 'rejected', notes);
  }

  async waitlist(actor: ScopedActor, id: string, notes?: string): Promise<MsvEnrolment> {
    return this.decide(actor, id, 'waitlisted', notes);
  }

  // ---- Internal ---------------------------------------------------------

  private async decide(
    actor: ScopedActor,
    id: string,
    decision: 'approved' | 'rejected' | 'waitlisted',
    notes?: string,
  ): Promise<MsvEnrolment> {
    const before = await this.repo.findById(id);
    if (!before) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'MSV application not found',
        statusCode: 404,
      });
    }
    // Q1: no eligibility checks. Just walk the state machine.
    if (before.status !== 'applied' && before.status !== 'waitlisted') {
      throw new AppError({
        code: ERROR_CODES.ERR_ENROLMENT_ALREADY_DECIDED,
        message: `Application is ${before.status}; only applied/waitlisted can be decided`,
        statusCode: 409,
      });
    }
    const student = await this.studentsRepo.findById(before.student_id);
    if (student) {
      const scope = await this.resolveCentreScope(actor);
      if (scope !== null && !scope.includes(student.centre_id)) {
        throw new AppError({
          code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
          message: 'Application is outside your scope',
          statusCode: 403,
        });
      }
    }

    const updated = await this.repo.updateStatus(id, {
      status: decision,
      reviewer_user_id: actor.user_id,
      decided_at: new Date(),
      notes: notes ?? null,
      updated_by: actor.user_id,
    });
    if (!updated) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'MSV application not found',
        statusCode: 404,
      });
    }

    if (decision === 'approved' && student) {
      // Flip the student's MSV status and regen the ID card so the
      // MSV badge appears.
      await this.drizzle.db
        .update(students)
        .set({ msv_status: 'approved', updated_at: new Date(), updated_by: actor.user_id })
        .where(eq(students.id, student.id))
        .catch(() => undefined);
      await this.idCardQueue
        .add('idcard.generation', {
          student_id: student.id,
          reason: 'msv.approved',
        })
        .catch(() => undefined);
    } else if (decision === 'rejected' && student) {
      await this.drizzle.db
        .update(students)
        .set({ msv_status: 'rejected', updated_at: new Date(), updated_by: actor.user_id })
        .where(eq(students.id, student.id))
        .catch(() => undefined);
    } else if (decision === 'waitlisted' && student) {
      await this.drizzle.db
        .update(students)
        .set({ msv_status: 'waitlisted', updated_at: new Date(), updated_by: actor.user_id })
        .where(eq(students.id, student.id))
        .catch(() => undefined);
    }

    await this.fanoutQueue
      .add(`msv.${decision}`, {
        event: `msv.${decision}`,
        msv_enrolment_id: id,
        student_id: student?.id,
        parent_user_id: student?.parent_user_id,
        notes: notes ?? null,
      })
      .catch(() => undefined);
    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: `msv.${decision}`,
        entity_kind: 'msv_enrolment',
        entity_id: id,
        before: { status: before.status },
        after: { status: decision, notes: notes ?? null },
      })
      .catch(() => undefined);

    return updated;
  }

  private async resolveCentreScope(actor: ScopedActor): Promise<string[] | null> {
    if (actor.role === 'super_admin' || actor.role === 'state_admin') return null;
    if (actor.role === 'city_admin') {
      if (!actor.city_id) return [];
      const cs = await this.centresRepo.listByCity(actor.city_id);
      return cs.map((c) => c.id);
    }
    return actor.centre_ids ?? [];
  }
}
