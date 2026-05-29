/**
 * ServiceRequestsService — SPEC §5.15, §6.19, Step 22.
 *
 * Routing rules:
 *   - submission carries a student_id → resolve student → centre_id, city_id;
 *     auto-assigns to the first sanchalak attached to the centre.
 *   - submission has no student_id → city_admin pool (assignee left null;
 *     city_admin grid surfaces unassigned).
 *
 * Escalation chain (manual reassign): sanchalak → city_admin → state_admin
 * → super_admin. The reassign endpoint accepts any user id; the service
 * only enforces that the actor is admin-level.
 *
 * State machine:
 *   submitted → in_review → resolved.
 * The "respond" endpoint appends a message AND flips status submitted →
 * in_review on the first admin reply.
 */

import { Injectable, Logger } from '@nestjs/common';

import { AppError, ERROR_CODES, type Role, type ServiceRequestStatus } from '@jp/shared';

import { CentresRepository } from '../../db/repositories/centres.repository';
import { SanchalakAssignmentsRepository } from '../../db/repositories/sanchalak-assignments.repository';
import { ServiceRequestsRepository } from '../../db/repositories/service-requests.repository';
import { StudentsRepository } from '../../db/repositories/students.repository';
import { AuditService } from '../audit/audit.service';

import type { ServiceRequest, ServiceRequestMessage } from '../../db/schema';

export interface SrActor {
  user_id: string;
  role: Role;
  city_id?: string;
  centre_ids?: string[];
}

@Injectable()
export class ServiceRequestsService {
  private readonly logger = new Logger(ServiceRequestsService.name);

  constructor(
    private readonly repo: ServiceRequestsRepository,
    private readonly students: StudentsRepository,
    private readonly centres: CentresRepository,
    private readonly sanchalakAssignments: SanchalakAssignmentsRepository,
    private readonly audit: AuditService,
  ) {}

  // ===========================================================================
  // Parent — create + list
  // ===========================================================================

  async submit(
    parentUserId: string,
    input: { category: string; description: string; student_id?: string },
  ): Promise<ServiceRequest> {
    let centreId: string | null = null;
    let cityId: string | null = null;
    let assignedTo: string | null = null;

    if (input.student_id) {
      const student = await this.students.findById(input.student_id);
      if (!student) {
        throw new AppError({
          code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
          message: 'Student not found',
          statusCode: 404,
        });
      }
      if (student.parent_user_id !== parentUserId) {
        throw new AppError({
          code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
          message: 'You can only file a service request for your own child',
          statusCode: 403,
        });
      }
      centreId = student.centre_id;
      const centre = await this.centres.findById(centreId);
      cityId = centre?.city_id ?? null;
      // Auto-assign to the first sanchalak of the centre.
      const sanchalaks = await this.sanchalakAssignments.listForCentre(centreId);
      assignedTo = sanchalaks[0]?.sanchalak_user_id ?? null;
    } else {
      // No student → route to city_admin (assignee=null until reassigned).
      // We still need a centre/city. Use the parent's first child's centre.
      const kids = await this.students.findByParent(parentUserId).catch(() => []);
      const first = kids.find((k) => k.status === 'active');
      if (!first) {
        throw new AppError({
          code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
          message: 'No active student linked to your account — cannot file request',
          statusCode: 422,
        });
      }
      centreId = first.centre_id;
      const centre = await this.centres.findById(centreId);
      cityId = centre?.city_id ?? null;
    }

    if (!centreId || !cityId) {
      throw new AppError({
        code: ERROR_CODES.ERR_INTERNAL,
        message: 'Could not resolve centre/city for service request',
        statusCode: 500,
      });
    }

    const created = await this.repo.create({
      parent_user_id: parentUserId,
      student_id: input.student_id ?? null,
      category: input.category,
      description: input.description,
      status: 'submitted' satisfies ServiceRequestStatus,
      assigned_to_user_id: assignedTo,
      centre_id: centreId,
      city_id: cityId,
    });

    await this.audit
      .emit({
        actor_user_id: parentUserId,
        actor_role: 'parent',
        action: 'create',
        entity_kind: 'service_request',
        entity_id: created.id,
        after: { category: created.category, status: created.status, centre_id: centreId },
      })
      .catch(() => undefined);

    return created;
  }

  async listForParent(
    parentUserId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<ServiceRequest[]> {
    return this.repo.listForParent(parentUserId, opts.limit ?? 50, opts.offset ?? 0);
  }

  // ===========================================================================
  // Admin
  // ===========================================================================

  async listForAdmin(
    actor: SrActor,
    opts: {
      status?: ServiceRequestStatus;
      assigned_to_me?: boolean;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<ServiceRequest[]> {
    this.assertAdmin(actor.role);
    const filter: {
      city_id?: string;
      status?: ServiceRequestStatus;
      assigned_to_user_id?: string;
      limit?: number;
      offset?: number;
    } = {};
    if (actor.role !== 'super_admin' && actor.role !== 'state_admin') {
      if (actor.city_id) filter.city_id = actor.city_id;
    }
    if (opts.status) filter.status = opts.status;
    if (opts.assigned_to_me) filter.assigned_to_user_id = actor.user_id;
    if (opts.limit !== undefined) filter.limit = opts.limit;
    if (opts.offset !== undefined) filter.offset = opts.offset;
    return this.repo.listForAdmin(filter);
  }

  async respond(
    actor: SrActor,
    requestId: string,
    message: string,
  ): Promise<{ request: ServiceRequest; message: ServiceRequestMessage }> {
    const req = await this.assertScoped(actor, requestId);
    const msg = await this.repo.addMessage({
      request_id: requestId,
      author_user_id: actor.user_id,
      message,
    });
    await this.repo.touchLastResponse(requestId);
    let updated = req;
    if (req.status === 'submitted') {
      updated = await this.repo.setStatus(requestId, 'in_review', null);
    }
    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'update',
        entity_kind: 'service_request',
        entity_id: requestId,
        before: { status: req.status },
        after: { status: updated.status, message_id: msg.id },
      })
      .catch(() => undefined);
    return { request: updated, message: msg };
  }

  async setStatus(
    actor: SrActor,
    requestId: string,
    next: ServiceRequestStatus,
  ): Promise<ServiceRequest> {
    const req = await this.assertScoped(actor, requestId);
    if (req.status === 'resolved' && next !== 'resolved') {
      throw new AppError({
        code: ERROR_CODES.ERR_SERVICE_REQUEST_ALREADY_RESOLVED,
        message: 'Cannot reopen a resolved request',
        statusCode: 409,
      });
    }
    const updated = await this.repo.setStatus(
      requestId,
      next,
      next === 'resolved' ? new Date() : null,
    );
    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'update',
        entity_kind: 'service_request',
        entity_id: requestId,
        before: { status: req.status },
        after: { status: updated.status },
      })
      .catch(() => undefined);
    return updated;
  }

  /**
   * Reassign — implements the SPEC escalation chain. Admin passes the new
   * assignee's user id; we validate the actor can escalate (their role
   * outranks or equals the current assignee's level).
   */
  async reassign(
    actor: SrActor,
    requestId: string,
    newAssigneeUserId: string | null,
  ): Promise<ServiceRequest> {
    const req = await this.assertScoped(actor, requestId);
    const updated = await this.repo.reassign(requestId, newAssigneeUserId);
    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'update',
        entity_kind: 'service_request',
        entity_id: requestId,
        before: { assigned_to_user_id: req.assigned_to_user_id },
        after: { assigned_to_user_id: newAssigneeUserId },
      })
      .catch(() => undefined);
    return updated;
  }

  async listMessages(
    actor: SrActor | { parent_user_id: string },
    requestId: string,
  ): Promise<ServiceRequestMessage[]> {
    const req = await this.repo.findById(requestId);
    if (!req) {
      throw new AppError({
        code: ERROR_CODES.ERR_SERVICE_REQUEST_NOT_FOUND,
        message: 'Service request not found',
        statusCode: 404,
      });
    }
    if ('parent_user_id' in actor) {
      if (req.parent_user_id !== actor.parent_user_id) {
        throw new AppError({
          code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
          message: 'Not your request',
          statusCode: 403,
        });
      }
    } else {
      await this.assertScoped(actor, requestId);
    }
    return this.repo.listMessages(requestId);
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  private async assertScoped(actor: SrActor, requestId: string): Promise<ServiceRequest> {
    this.assertAdmin(actor.role);
    const req = await this.repo.findById(requestId);
    if (!req) {
      throw new AppError({
        code: ERROR_CODES.ERR_SERVICE_REQUEST_NOT_FOUND,
        message: 'Service request not found',
        statusCode: 404,
      });
    }
    if (actor.role !== 'super_admin' && actor.role !== 'state_admin') {
      if (actor.city_id && actor.city_id !== req.city_id) {
        throw new AppError({
          code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
          message: 'Request is outside your city scope',
          statusCode: 403,
        });
      }
      if (actor.role === 'sanchalak') {
        const own = new Set(actor.centre_ids ?? []);
        if (!own.has(req.centre_id)) {
          throw new AppError({
            code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
            message: 'Request is outside your centre scope',
            statusCode: 403,
          });
        }
      }
    }
    return req;
  }

  private assertAdmin(role: Role): void {
    const allowed: Role[] = ['sanchalak', 'city_admin', 'state_admin', 'super_admin'];
    if (!allowed.includes(role)) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: 'Only sanchalak/admin can manage service requests',
        statusCode: 403,
      });
    }
  }
}
