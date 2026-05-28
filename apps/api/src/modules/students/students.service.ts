/**
 * StudentsService — scoped reads + PATCH + soft-deactivate (Q11).
 *
 * Q11: students are NEVER hard-deleted. `deactivate` flips `status` to
 * 'inactive' and stamps `deactivated_at`; `reactivate` reverses it.
 *
 * Scope:
 *   - super_admin / state_admin: unrestricted
 *   - city_admin:                 students whose centre is in their city
 *   - sanchalak:                  students whose centre is in their assigned set
 *   - shikshak:                   students whose batch is in their assigned set
 *   - parent:                     only their own children
 *   - student-view:               only the student in view
 */

import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import { AppError, ERROR_CODES, QUEUES, type Role, StudentStatus } from '@jp/shared';

import { RedisService } from '../../core/redis/redis.service';
import { CentresRepository, StudentsRepository } from '../../db/repositories';
import { AuditService } from '../audit/audit.service';

import type { Student } from '../../db/schema';

export interface ScopedActor {
  user_id: string;
  role: Role;
  city_id?: string | undefined;
  centre_ids?: string[] | undefined;
  batch_ids?: string[] | undefined;
  view_context?: 'parent' | 'student';
  view_student_id?: string | undefined;
}

export interface ListFilters {
  centre_id?: string;
  batch_id?: string;
  status?: StudentStatus;
  limit?: number;
  offset?: number;
}

export interface UpdatableStudentFields {
  full_name?: string;
  father_name?: string | null;
  profile_photo_asset_id?: string | null;
  student_view_enabled?: boolean;
}

@Injectable()
export class StudentsService {
  private readonly logger = new Logger(StudentsService.name);
  private readonly idCardQueue: Queue;

  constructor(
    private readonly repo: StudentsRepository,
    private readonly centresRepo: CentresRepository,
    private readonly audit: AuditService,
    redis: RedisService,
  ) {
    this.idCardQueue = new Queue(QUEUES.ID_CARD_GENERATION, {
      connection: redis.bullmqClient,
    });
  }

  // ---- Reads ------------------------------------------------------------

  async listForActor(actor: ScopedActor, filters: ListFilters): Promise<Student[]> {
    const scope = await this.resolveCentreScope(actor);
    return this.repo.list({
      ...filters,
      ...(scope ? { centre_ids: scope } : {}),
    });
  }

  async getById(actor: ScopedActor, id: string): Promise<Student> {
    const row = await this.repo.findById(id);
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Student not found',
        statusCode: 404,
      });
    }
    await this.assertInScope(actor, row);
    return row;
  }

  /** Parent's own children. Includes inactive (Q11 / Step 10 prompt). */
  async listForParent(parentUserId: string): Promise<Student[]> {
    return this.repo.findByParent(parentUserId);
  }

  // ---- Mutations --------------------------------------------------------

  async update(actor: ScopedActor, id: string, patch: UpdatableStudentFields): Promise<Student> {
    const before = await this.repo.findById(id);
    if (!before) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Student not found',
        statusCode: 404,
      });
    }
    await this.assertCanMutate(actor, before);
    const updated = await this.repo.update(id, { ...patch, updated_by: actor.user_id });
    if (!updated) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Student not found',
        statusCode: 404,
      });
    }

    // Photo changes regenerate the ID card (Step 11 prompt — "Regenerate
    // triggers: transfer (new batch), MSV approval, photo update").
    if (
      patch.profile_photo_asset_id !== undefined &&
      patch.profile_photo_asset_id !== before.profile_photo_asset_id
    ) {
      await this.idCardQueue
        .add('idcard.generation', {
          student_id: id,
          reason: 'photo.updated',
        })
        .catch((err) =>
          this.logger.warn(
            `idcard.generation enqueue (photo.updated) failed: ${(err as Error).message}`,
          ),
        );
    }
    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'student.updated',
        entity_kind: 'student',
        entity_id: id,
        before: {
          full_name: before.full_name,
          father_name: before.father_name,
          profile_photo_asset_id: before.profile_photo_asset_id,
          student_view_enabled: before.student_view_enabled,
        },
        after: { ...patch } as Record<string, unknown>,
      })
      .catch(() => undefined);
    return updated;
  }

  /**
   * Soft deactivate (Q11). Cannot hard-delete. We also force-clear the
   * `batch_id` so capacity counts free up for the next approval.
   */
  async deactivate(actor: ScopedActor, id: string, reason: string): Promise<Student> {
    const before = await this.repo.findById(id);
    if (!before) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Student not found',
        statusCode: 404,
      });
    }
    if (before.status === 'inactive') {
      throw new AppError({
        code: ERROR_CODES.ERR_CONFLICT_STATE_TRANSITION,
        message: 'Student is already inactive',
        statusCode: 409,
      });
    }
    await this.assertCanAdminMutate(actor, before);

    const updated = await this.repo.deactivate(id, actor.user_id);
    if (!updated) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Student not found',
        statusCode: 404,
      });
    }
    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'student.deactivated',
        entity_kind: 'student',
        entity_id: id,
        before: { status: before.status },
        after: { status: 'inactive', reason },
      })
      .catch(() => undefined);
    return updated;
  }

  async reactivate(actor: ScopedActor, id: string): Promise<Student> {
    const before = await this.repo.findById(id);
    if (!before) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Student not found',
        statusCode: 404,
      });
    }
    if (before.status === 'active') {
      throw new AppError({
        code: ERROR_CODES.ERR_CONFLICT_STATE_TRANSITION,
        message: 'Student is already active',
        statusCode: 409,
      });
    }
    await this.assertCanAdminMutate(actor, before);
    const updated = await this.repo.reactivate(id, actor.user_id);
    if (!updated) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Student not found',
        statusCode: 404,
      });
    }
    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'student.reactivated',
        entity_kind: 'student',
        entity_id: id,
        before: { status: before.status },
        after: { status: 'active' },
      })
      .catch(() => undefined);
    return updated;
  }

  // ---- Scope helpers ----------------------------------------------------

  private async resolveCentreScope(actor: ScopedActor): Promise<string[] | null> {
    if (actor.role === 'super_admin' || actor.role === 'state_admin') return null;
    if (actor.role === 'city_admin') {
      if (!actor.city_id) return [];
      const cs = await this.centresRepo.listByCity(actor.city_id);
      return cs.map((c) => c.id);
    }
    if (actor.role === 'sanchalak') return actor.centre_ids ?? [];
    // shikshak: derive centres from assigned batches — for Step 10 we
    // approximate via centre_ids (the JWT carries both).
    if (actor.role === 'shikshak') return actor.centre_ids ?? [];
    return [];
  }

  private async assertInScope(actor: ScopedActor, student: Student): Promise<void> {
    if (actor.role === 'parent') {
      if (student.parent_user_id !== actor.user_id) {
        throw new AppError({
          code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
          message: 'Student is not yours',
          statusCode: 403,
        });
      }
      return;
    }
    if (actor.view_context === 'student' && actor.view_student_id) {
      if (student.id !== actor.view_student_id) {
        throw new AppError({
          code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
          message: 'Student-view is restricted to the selected child',
          statusCode: 403,
        });
      }
      return;
    }
    const scope = await this.resolveCentreScope(actor);
    if (scope === null) return;
    if (!scope.includes(student.centre_id)) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
        message: 'Student is outside your scope',
        statusCode: 403,
      });
    }
  }

  /** Parents can PATCH their own child's name/photo; admins beyond. */
  private async assertCanMutate(actor: ScopedActor, student: Student): Promise<void> {
    if (actor.role === 'parent' && student.parent_user_id === actor.user_id) return;
    await this.assertCanAdminMutate(actor, student);
  }

  /** Sanchalak+ for state-changing actions (deactivate, reactivate). */
  private async assertCanAdminMutate(actor: ScopedActor, student: Student): Promise<void> {
    if (actor.role === 'super_admin' || actor.role === 'state_admin') return;
    const scope = await this.resolveCentreScope(actor);
    if (scope === null) return;
    if (!scope.includes(student.centre_id)) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
        message: 'Student is outside your scope',
        statusCode: 403,
      });
    }
  }
}
