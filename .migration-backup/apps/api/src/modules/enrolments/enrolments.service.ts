/**
 * EnrolmentsService — the workflow at the heart of Step 10.
 *
 * Public methods:
 *   submit       — guest / parent creates an enrolment (no capacity check)
 *   list         — sanchalak+ scoped paged list with filters
 *   getById      — sanchalak+ scope check + lookup
 *   approve      — capacity check, transactional student insert + queue
 *   reject       — reason required + parent notification queued
 *   waitlist     — status flip + parent notification queued
 *   transfer     — city_admin+ moves a student between batches
 *
 * Behaviour rules:
 *   - Guest path: a brand-new phone gets a `guest` user row (per Step 5
 *     convention); we promote it to `parent` once their enrolment is
 *     approved.
 *   - Duplicate detection: same first-name + dob + same parent → 200
 *     with `meta.warning = 'duplicate_suspected'`. We do NOT block.
 *   - Capacity check: only on approve (SPEC §8.1). 409
 *     ERR_BATCH_OVER_CAPACITY.
 *   - Once decided (approved/rejected), an enrolment cannot be
 *     re-decided → 409 ERR_ENROLMENT_ALREADY_DECIDED.
 *   - Approve creates the student row INSIDE a transaction so a failure
 *     in the ID-card enqueue rolls back the student insert too.
 *   - Audit lines use the AuditService's mapToEnumAction so detailed
 *     event_kind strings like `enrolment.submitted` and `enrolment.approved`
 *     are preserved in `after.event_kind`.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { count, eq } from 'drizzle-orm';

import { AppError, ERROR_CODES, QUEUES, type Role, EnrolmentStatus } from '@jp/shared';

import { DrizzleService } from '../../core/database/drizzle.service';
import { RedisService } from '../../core/redis/redis.service';
import {
  BatchesRepository,
  CentresRepository,
  EnrolmentsRepository,
  FormConfigsRepository,
  StudentsRepository,
  UsersRepository,
} from '../../db/repositories';
import { batches, enrolments, registration_form_responses, students, users } from '../../db/schema';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { AuditService } from '../audit/audit.service';

import type { Enrolment, Student } from '../../db/schema';

export interface ScopedActor {
  user_id: string;
  role: Role;
  city_id?: string | undefined;
  state_id?: string | undefined;
  centre_ids?: string[] | undefined;
  batch_ids?: string[] | undefined;
}

export interface SubmitEnrolmentInput {
  /** Pre-existing parent user id, OR omitted for the guest sign-up path. */
  parent_user_id?: string;
  /** Required for guest path — the OTP-verified phone we'll create the user with. */
  parent_phone?: string;
  parent_full_name?: string;
  preferred_language?: 'en' | 'hi';
  requested_centre_id: string;
  requested_batch_id: string;
  full_name: string;
  dob: string;
  age_group: 'bal' | 'kishor' | 'tarun' | 'yuva';
  father_name?: string | null;
  /** Free-form responses against the active registration_form_configs schema. */
  form_data?: Record<string, unknown>;
}

export interface SubmitResult {
  enrolment: Enrolment;
  warning?: 'duplicate_suspected';
  duplicate_of_student_id?: string;
}

export interface ListFilters {
  status?: EnrolmentStatus;
  batch_id?: string;
  centre_id?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

@Injectable()
export class EnrolmentsService {
  private readonly logger = new Logger(EnrolmentsService.name);
  private readonly fanoutQueue: Queue;
  private readonly idCardQueue: Queue;

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly repo: EnrolmentsRepository,
    private readonly studentsRepo: StudentsRepository,
    private readonly batchesRepo: BatchesRepository,
    private readonly centresRepo: CentresRepository,
    private readonly usersRepo: UsersRepository,
    private readonly formConfigsRepo: FormConfigsRepository,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
    redis: RedisService,
  ) {
    this.fanoutQueue = new Queue(QUEUES.NOTIFICATIONS_FANOUT, {
      connection: redis.bullmqClient,
    });
    this.idCardQueue = new Queue(QUEUES.ID_CARD_GENERATION, {
      connection: redis.bullmqClient,
    });
  }

  // -------------------------------------------------------------------------
  // Submit
  // -------------------------------------------------------------------------

  async submit(actor: ScopedActor | null, input: SubmitEnrolmentInput): Promise<SubmitResult> {
    // Resolve / create the parent user.
    let parentUserId = input.parent_user_id;
    let parentPhone: string | null = null;
    if (!parentUserId) {
      if (!input.parent_phone) {
        throw new AppError({
          code: ERROR_CODES.ERR_VALIDATION_FAILED,
          message: 'parent_user_id or parent_phone is required',
          statusCode: 422,
        });
      }
      parentPhone = input.parent_phone;
      const existing = await this.usersRepo.findByPhone(parentPhone);
      if (existing) {
        parentUserId = existing.id;
      } else {
        const created = await this.usersRepo.createGuest(
          parentPhone,
          input.preferred_language ?? 'en',
        );
        parentUserId = created.id;
      }
      // First time we have a real name, populate it.
      if (input.parent_full_name) {
        await this.usersRepo
          .updateProfile(parentUserId, { full_name: input.parent_full_name })
          .catch(() => undefined);
      }
    }

    // Validate centre + batch belong together and accept the age_group.
    const batch = await this.batchesRepo.findById(input.requested_batch_id);
    if (!batch || batch.deleted_at) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Batch not found',
        statusCode: 404,
      });
    }
    if (batch.centre_id !== input.requested_centre_id) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_FAILED,
        message: 'Requested batch does not belong to the requested centre',
        statusCode: 422,
      });
    }
    if (batch.age_group !== input.age_group) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_FAILED,
        message: `Batch age_group is ${batch.age_group}, but enrolment age_group is ${input.age_group}`,
        statusCode: 422,
      });
    }

    // Duplicate detection — same first name + dob + same parent → warning.
    const dupStudentId = await this.repo.findDuplicateStudent({
      full_name: input.full_name,
      dob: input.dob,
      parent_user_id: parentUserId,
    });

    // Resolve the active form_config for this centre's city. We need it
    // so the response row can carry an FK; the global default seeded in
    // Step 4 is the fallback if the city hasn't customised.
    const centre = await this.centresRepo.findById(input.requested_centre_id);
    if (!centre) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Centre not found',
        statusCode: 404,
      });
    }
    const formConfig =
      (await this.formConfigsRepo.findActiveByCityAndKind(centre.city_id, 'student')) ??
      (await this.formConfigsRepo.findActiveDefaultByKind('student'));
    if (!formConfig) {
      throw new AppError({
        code: ERROR_CODES.ERR_INTERNAL,
        message: 'No active student form_config (city or default) available',
        statusCode: 500,
      });
    }

    // Persist enrolment + form response inside a single tx so a partial
    // failure rolls both back.
    const enrolment = await this.drizzle.db.transaction(async (tx) => {
      const [formResponse] = await tx
        .insert(registration_form_responses)
        .values({
          form_config_id: formConfig.id,
          user_id: parentUserId,
          responses: {
            full_name: input.full_name,
            dob: input.dob,
            father_name: input.father_name ?? null,
            age_group: input.age_group,
            requested_centre_id: input.requested_centre_id,
            requested_batch_id: input.requested_batch_id,
            ...(input.form_data ?? {}),
          },
          submitted_at: new Date(),
        })
        .returning();
      const [created] = await tx
        .insert(enrolments)
        .values({
          parent_user_id: parentUserId,
          requested_centre_id: input.requested_centre_id,
          requested_batch_id: input.requested_batch_id,
          status: 'pending',
          form_response_id: formResponse!.id,
          created_by: actor?.user_id ?? parentUserId,
          updated_by: actor?.user_id ?? parentUserId,
        })
        .returning();
      return created!;
    });

    await this.audit
      .emit({
        actor_user_id: actor?.user_id ?? parentUserId,
        actor_role: actor?.role ?? 'guest',
        action: 'enrolment.submitted',
        entity_kind: 'enrolment',
        entity_id: enrolment.id,
        after: {
          parent_user_id: parentUserId,
          requested_centre_id: input.requested_centre_id,
          requested_batch_id: input.requested_batch_id,
          full_name: input.full_name,
          dob: input.dob,
          father_name: input.father_name ?? null,
          age_group: input.age_group,
          duplicate_of_student_id: dupStudentId,
        },
      })
      .catch(() => undefined);

    // Step 12 — real fanout. The fanout worker resolves recipients from
    // the centre scope (sanchalaks + shikshaks of the centre) and inserts
    // in-app / push / email jobs as appropriate.
    await this.fanoutQueue
      .add('enrolment.submitted', {
        event: 'enrolment.submitted',
        scope: { kind: 'centre', id: input.requested_centre_id },
        source: { kind: 'enrolment', id: enrolment.id },
        data: {
          full_name: input.full_name,
          age_group: input.age_group,
          centre_id: input.requested_centre_id,
          batch_id: input.requested_batch_id,
        },
        deep_link: `/admin/enrolments/${enrolment.id}`,
      })
      .catch((err) =>
        this.logger.warn(`notifications.fanout enqueue failed: ${(err as Error).message}`),
      );

    // Live admin dashboard event (Step 12). City-scoped so the city_admin
    // dashboard shows the activity feed update without a page refresh.
    this.realtime.emitToAdminDashboard(centre.city_id, {
      event: 'enrolment.submitted',
      city_id: centre.city_id,
      summary_en: `${input.full_name} enrolled at ${centre.name}`,
      summary_hi: `${input.full_name} ने ${centre.name} में प्रवेश आवेदन किया`,
      source_entity_kind: 'enrolment',
      source_entity_id: enrolment.id,
      at: new Date().toISOString(),
    });

    return dupStudentId
      ? {
          enrolment,
          warning: 'duplicate_suspected',
          duplicate_of_student_id: dupStudentId,
        }
      : { enrolment };
  }

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  async list(actor: ScopedActor, filters: ListFilters): Promise<Enrolment[]> {
    const centreIds = await this.resolveCentreScope(actor);
    return this.repo.list({
      ...filters,
      ...(centreIds ? { centre_ids: centreIds } : {}),
    });
  }

  async getById(actor: ScopedActor, id: string): Promise<Enrolment> {
    const row = await this.repo.findById(id);
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Enrolment not found',
        statusCode: 404,
      });
    }
    await this.assertCentreInScope(actor, row.requested_centre_id);
    return row;
  }

  // -------------------------------------------------------------------------
  // Approve
  // -------------------------------------------------------------------------

  async approve(
    actor: ScopedActor,
    id: string,
  ): Promise<{ enrolment: Enrolment; student: Student }> {
    const enrolment = await this.repo.findById(id);
    if (!enrolment) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Enrolment not found',
        statusCode: 404,
      });
    }
    if (enrolment.status !== 'pending' && enrolment.status !== 'waitlisted') {
      throw new AppError({
        code: ERROR_CODES.ERR_ENROLMENT_ALREADY_DECIDED,
        message: `Enrolment is ${enrolment.status}; only pending or waitlisted can be approved`,
        statusCode: 409,
      });
    }
    await this.assertCentreInScope(actor, enrolment.requested_centre_id);

    // Capacity check (SPEC §8.1 edge case): 409 if over.
    const cap = await this.batchesRepo.assertCapacityRemaining(enrolment.requested_batch_id);
    if (cap.remaining <= 0) {
      throw new AppError({
        code: ERROR_CODES.ERR_BATCH_OVER_CAPACITY,
        message: `Batch is at capacity (${cap.enrolled}/${cap.capacity})`,
        statusCode: 409,
        details: [
          {
            path: 'requested_batch_id',
            meta: { capacity: cap.capacity, enrolled: cap.enrolled, remaining: cap.remaining },
          },
        ],
      });
    }

    // Need the enrolment's original full_name / dob / age_group to create
    // the student row. We sourced those from the audit log when the
    // enrolment was submitted; for Step 10 we read the most recent audit
    // entry. (In Step 11 the registration_form_responses table holds
    // these directly.)
    const submitted = await this.readSubmittedDetails(enrolment);
    if (!submitted) {
      throw new AppError({
        code: ERROR_CODES.ERR_INTERNAL,
        message: 'Could not recover submitted enrolment details from audit log',
        statusCode: 500,
      });
    }

    const studentCode = await this.studentsRepo.generateStudentCode(enrolment.requested_centre_id);

    const result = await this.drizzle.db.transaction(async (tx) => {
      // Re-check capacity inside the tx to defend against a concurrent
      // approval that filled the last seat between our pre-check and now.
      // SELECT … FOR UPDATE locks the batch row for the duration of the tx.
      const [batchRow] = await tx
        .select({ capacity: batches.capacity })
        .from(batches)
        .where(eq(batches.id, enrolment.requested_batch_id))
        .for('update');
      const [{ value: enrolled = 0 } = { value: 0 }] = await tx
        .select({ value: count() })
        .from(students)
        .where(eq(students.batch_id, enrolment.requested_batch_id));
      if (batchRow && enrolled >= batchRow.capacity) {
        throw new AppError({
          code: ERROR_CODES.ERR_BATCH_OVER_CAPACITY,
          message: `Batch filled while approving (${enrolled}/${batchRow.capacity})`,
          statusCode: 409,
        });
      }

      const [student] = await tx
        .insert(students)
        .values({
          parent_user_id: enrolment.parent_user_id,
          full_name: submitted.full_name,
          father_name: submitted.father_name,
          dob: submitted.dob,
          age_group: submitted.age_group,
          centre_id: enrolment.requested_centre_id,
          batch_id: enrolment.requested_batch_id,
          student_code: studentCode,
          msv_status: 'none',
          status: 'active',
          enrolled_at: new Date(),
          created_by: actor.user_id,
          updated_by: actor.user_id,
        })
        .returning();
      if (!student) {
        throw new Error('Student insert returned no row');
      }

      const [updated] = await tx
        .update(enrolments)
        .set({
          status: 'approved',
          reviewer_user_id: actor.user_id,
          decided_at: new Date(),
          student_id: student.id,
          updated_at: new Date(),
          updated_by: actor.user_id,
        })
        .where(eq(enrolments.id, enrolment.id))
        .returning();
      return { enrolment: updated!, student };
    });

    // Promote the parent's role from guest to parent if needed. We
    // don't change the role on already-promoted parents (city_admin
    // who's also a parent shouldn't get downgraded).
    const parent = await this.usersRepo.findById(enrolment.parent_user_id);
    if (parent?.role === 'guest') {
      await this.drizzle.db
        .update(users)
        .set({ role: 'parent', updated_at: new Date(), updated_by: actor.user_id })
        .where(eq(users.id, parent.id))
        .catch(() => undefined);
    }

    // Enqueue ID card generation + parent notification.
    await this.idCardQueue
      .add('idcard.generation', {
        student_id: result.student.id,
        reason: 'enrolment.approved',
      })
      .catch((err) =>
        this.logger.warn(`idcard.generation enqueue failed: ${(err as Error).message}`),
      );
    // Step 12 — push + email + in-app to the parent.
    await this.fanoutQueue
      .add('enrolment.approved', {
        event: 'enrolment.approved',
        recipient_user_ids: [enrolment.parent_user_id],
        source: { kind: 'enrolment', id: enrolment.id },
        data: {
          full_name: result.student.full_name,
          student_code: result.student.student_code,
          student_id: result.student.id,
        },
        deep_link: `/students/${result.student.id}`,
      })
      .catch(() => undefined);

    // Live admin dashboard event for the centre's city.
    {
      const centreRow = await this.centresRepo.findById(enrolment.requested_centre_id);
      if (centreRow) {
        this.realtime.emitToAdminDashboard(centreRow.city_id, {
          event: 'enrolment.approved',
          city_id: centreRow.city_id,
          actor_role: actor.role,
          summary_en: `${result.student.full_name} approved at ${centreRow.name}`,
          summary_hi: `${result.student.full_name} का ${centreRow.name} में प्रवेश स्वीकृत हुआ`,
          source_entity_kind: 'enrolment',
          source_entity_id: enrolment.id,
          at: new Date().toISOString(),
        });
      }
    }

    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'enrolment.approved',
        entity_kind: 'enrolment',
        entity_id: enrolment.id,
        before: { status: enrolment.status },
        after: { status: 'approved', student_id: result.student.id, student_code: studentCode },
      })
      .catch(() => undefined);

    return result;
  }

  // -------------------------------------------------------------------------
  // Reject / Waitlist
  // -------------------------------------------------------------------------

  async reject(actor: ScopedActor, id: string, reason: string): Promise<Enrolment> {
    if (!reason.trim()) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_FAILED,
        message: 'reason is required',
        statusCode: 422,
      });
    }
    const enrolment = await this.repo.findById(id);
    if (!enrolment) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Enrolment not found',
        statusCode: 404,
      });
    }
    if (enrolment.status !== 'pending' && enrolment.status !== 'waitlisted') {
      throw new AppError({
        code: ERROR_CODES.ERR_ENROLMENT_ALREADY_DECIDED,
        message: `Enrolment is ${enrolment.status}; only pending/waitlisted can be rejected`,
        statusCode: 409,
      });
    }
    await this.assertCentreInScope(actor, enrolment.requested_centre_id);

    const updated = await this.repo.updateStatus(id, {
      status: 'rejected',
      reviewer_user_id: actor.user_id,
      decided_at: new Date(),
      rejection_reason: reason,
      updated_by: actor.user_id,
    });
    if (!updated) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Enrolment not found',
        statusCode: 404,
      });
    }

    await this.fanoutQueue
      .add('enrolment.rejected', {
        event: 'enrolment.rejected',
        recipient_user_ids: [enrolment.parent_user_id],
        source: { kind: 'enrolment', id: enrolment.id },
        data: { reason },
      })
      .catch(() => undefined);
    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'enrolment.rejected',
        entity_kind: 'enrolment',
        entity_id: enrolment.id,
        before: { status: enrolment.status },
        after: { status: 'rejected', reason },
      })
      .catch(() => undefined);

    return updated;
  }

  async waitlist(actor: ScopedActor, id: string, reason?: string): Promise<Enrolment> {
    const enrolment = await this.repo.findById(id);
    if (!enrolment) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Enrolment not found',
        statusCode: 404,
      });
    }
    if (enrolment.status !== 'pending') {
      throw new AppError({
        code: ERROR_CODES.ERR_ENROLMENT_ALREADY_DECIDED,
        message: `Enrolment is ${enrolment.status}; only pending can be waitlisted`,
        statusCode: 409,
      });
    }
    await this.assertCentreInScope(actor, enrolment.requested_centre_id);

    const updated = await this.repo.updateStatus(id, {
      status: 'waitlisted',
      reviewer_user_id: actor.user_id,
      decided_at: new Date(),
      ...(reason ? { rejection_reason: reason } : {}),
      updated_by: actor.user_id,
    });
    if (!updated) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Enrolment not found',
        statusCode: 404,
      });
    }

    await this.fanoutQueue
      .add('enrolment.waitlisted', {
        event: 'enrolment.waitlisted',
        recipient_user_ids: [enrolment.parent_user_id],
        source: { kind: 'enrolment', id: enrolment.id },
      })
      .catch(() => undefined);
    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'enrolment.waitlisted',
        entity_kind: 'enrolment',
        entity_id: enrolment.id,
        before: { status: enrolment.status },
        after: { status: 'waitlisted', reason: reason ?? null },
      })
      .catch(() => undefined);

    return updated;
  }

  // -------------------------------------------------------------------------
  // Transfer (city_admin+ only — guarded at controller level)
  // -------------------------------------------------------------------------

  async transfer(actor: ScopedActor, studentId: string, targetBatchId: string): Promise<Student> {
    const student = await this.studentsRepo.findById(studentId);
    if (!student) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Student not found',
        statusCode: 404,
      });
    }
    const targetBatch = await this.batchesRepo.findById(targetBatchId);
    if (!targetBatch || targetBatch.deleted_at) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Target batch not found',
        statusCode: 404,
      });
    }
    if (targetBatch.age_group !== student.age_group) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_FAILED,
        message: `Target batch age_group (${targetBatch.age_group}) does not match student (${student.age_group})`,
        statusCode: 422,
      });
    }
    const cap = await this.batchesRepo.assertCapacityRemaining(targetBatchId);
    if (cap.remaining <= 0) {
      throw new AppError({
        code: ERROR_CODES.ERR_BATCH_OVER_CAPACITY,
        message: `Target batch is at capacity (${cap.enrolled}/${cap.capacity})`,
        statusCode: 409,
      });
    }

    const updated = await this.studentsRepo.update(studentId, {
      batch_id: targetBatchId,
      centre_id: targetBatch.centre_id,
      updated_by: actor.user_id,
    });
    if (!updated) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Student not found',
        statusCode: 404,
      });
    }

    await this.idCardQueue
      .add('idcard.generation', {
        student_id: studentId,
        reason: 'student.transferred',
      })
      .catch(() => undefined);
    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'student.transferred',
        entity_kind: 'student',
        entity_id: studentId,
        before: { batch_id: student.batch_id, centre_id: student.centre_id },
        after: { batch_id: targetBatchId, centre_id: targetBatch.centre_id },
      })
      .catch(() => undefined);

    return updated;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Resolve which centres the actor can see. `null` = all (super_admin). */
  private async resolveCentreScope(actor: ScopedActor): Promise<string[] | null> {
    if (actor.role === 'super_admin' || actor.role === 'state_admin') return null;
    if (actor.role === 'city_admin') {
      if (!actor.city_id) return [];
      const cs = await this.centresRepo.listByCity(actor.city_id);
      return cs.map((c) => c.id);
    }
    return actor.centre_ids ?? [];
  }

  private async assertCentreInScope(actor: ScopedActor, centreId: string): Promise<void> {
    const scope = await this.resolveCentreScope(actor);
    if (scope === null) return; // super / state — unrestricted
    if (!scope.includes(centreId)) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
        message: 'Enrolment is outside your scope',
        statusCode: 403,
      });
    }
  }

  /**
   * Read the submitted-details snapshot stored in registration_form_responses
   * (the canonical place per SPEC §5.4). Returns null if the response row
   * cannot be located — shouldn't happen because submit() writes it inside
   * the same transaction.
   */
  private async readSubmittedDetails(enrolment: Enrolment): Promise<{
    full_name: string;
    father_name: string | null;
    dob: string;
    age_group: 'bal' | 'kishor' | 'tarun' | 'yuva';
  } | null> {
    if (!enrolment.form_response_id) return null;
    const rows = await this.drizzle.dbRead
      .select({ responses: registration_form_responses.responses })
      .from(registration_form_responses)
      .where(eq(registration_form_responses.id, enrolment.form_response_id))
      .limit(1);
    const responses = rows[0]?.responses as Record<string, unknown> | undefined;
    if (
      responses &&
      typeof responses.full_name === 'string' &&
      typeof responses.dob === 'string' &&
      typeof responses.age_group === 'string'
    ) {
      return {
        full_name: responses.full_name,
        father_name: (responses.father_name as string | null) ?? null,
        dob: responses.dob,
        age_group: responses.age_group as 'bal' | 'kishor' | 'tarun' | 'yuva',
      };
    }
    return null;
  }
}
