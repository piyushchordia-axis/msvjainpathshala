/**
 * ServiceRequestsRepository — SPEC §5.15.
 *
 * `service_requests` is parent-facing: parent submits, sanchalak or
 * city_admin owns it (escalation chain: sanchalak → city_admin →
 * state_admin → super_admin). `service_request_messages` is the thread.
 *
 * Indexed (city_id, status) for the admin grid and
 * (parent_user_id, created_at desc) for the parent's "my requests" list.
 */

import { Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { service_request_messages, service_requests } from '../schema';

import type {
  NewServiceRequest,
  NewServiceRequestMessage,
  ServiceRequest,
  ServiceRequestMessage,
} from '../schema';
import type { ServiceRequestStatus } from '@jp/shared';

export interface SrAdminListFilter {
  city_id?: string;
  centre_id?: string;
  status?: ServiceRequestStatus;
  assigned_to_user_id?: string;
  limit?: number;
  offset?: number;
}

@Injectable()
export class ServiceRequestsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  // -------------------------------------------------------------------------
  // service_requests
  // -------------------------------------------------------------------------

  async create(input: NewServiceRequest): Promise<ServiceRequest> {
    const [row] = await this.drizzle.db.insert(service_requests).values(input).returning();
    if (!row) throw new Error('[ServiceRequests.create] no row returned');
    return row;
  }

  async findById(id: string): Promise<ServiceRequest | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(service_requests)
      .where(eq(service_requests.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async listForParent(parentUserId: string, limit = 50, offset = 0): Promise<ServiceRequest[]> {
    return this.drizzle.dbRead
      .select()
      .from(service_requests)
      .where(eq(service_requests.parent_user_id, parentUserId))
      .orderBy(desc(service_requests.created_at))
      .limit(limit)
      .offset(offset);
  }

  async listForAdmin(filter: SrAdminListFilter): Promise<ServiceRequest[]> {
    const where = [];
    if (filter.city_id) where.push(eq(service_requests.city_id, filter.city_id));
    if (filter.centre_id) where.push(eq(service_requests.centre_id, filter.centre_id));
    if (filter.status) where.push(eq(service_requests.status, filter.status));
    if (filter.assigned_to_user_id) {
      where.push(eq(service_requests.assigned_to_user_id, filter.assigned_to_user_id));
    }
    const q = this.drizzle.dbRead.select().from(service_requests);
    const filtered = where.length > 0 ? q.where(and(...where)) : q;
    return filtered
      .orderBy(desc(service_requests.created_at))
      .limit(filter.limit ?? 50)
      .offset(filter.offset ?? 0);
  }

  async setStatus(
    id: string,
    status: ServiceRequestStatus,
    resolvedAt: Date | null,
  ): Promise<ServiceRequest> {
    const [row] = await this.drizzle.db
      .update(service_requests)
      .set({
        status,
        resolved_at: resolvedAt,
        updated_at: new Date(),
      })
      .where(eq(service_requests.id, id))
      .returning();
    if (!row) throw new Error(`[ServiceRequests.setStatus] no row for id=${id}`);
    return row;
  }

  async reassign(id: string, userId: string | null): Promise<ServiceRequest> {
    const [row] = await this.drizzle.db
      .update(service_requests)
      .set({
        assigned_to_user_id: userId,
        updated_at: new Date(),
      })
      .where(eq(service_requests.id, id))
      .returning();
    if (!row) throw new Error(`[ServiceRequests.reassign] no row for id=${id}`);
    return row;
  }

  async touchLastResponse(id: string): Promise<void> {
    await this.drizzle.db
      .update(service_requests)
      .set({ last_response_at: new Date(), updated_at: new Date() })
      .where(eq(service_requests.id, id));
  }

  async openCountByCity(cityId: string): Promise<number> {
    const rows = await this.drizzle.dbRead.execute(sql`
      SELECT COUNT(*)::int AS c
        FROM service_requests
       WHERE city_id = ${cityId}
         AND status IN ('submitted', 'in_review')
    `);
    return (rows as unknown as Array<{ c: number }>)[0]?.c ?? 0;
  }

  // -------------------------------------------------------------------------
  // service_request_messages
  // -------------------------------------------------------------------------

  async addMessage(input: NewServiceRequestMessage): Promise<ServiceRequestMessage> {
    const [row] = await this.drizzle.db.insert(service_request_messages).values(input).returning();
    if (!row) throw new Error('[ServiceRequests.addMessage] no row returned');
    return row;
  }

  async listMessages(requestId: string): Promise<ServiceRequestMessage[]> {
    return this.drizzle.dbRead
      .select()
      .from(service_request_messages)
      .where(eq(service_request_messages.request_id, requestId))
      .orderBy(service_request_messages.created_at);
  }
}
