/**
 * AuditLogsRepository — READ-side helper for `audit_logs`.
 *
 * Writes go exclusively through {@link AuditService} under the INSERT-only
 * `audit_writer` Postgres role (CLAUDE.md "Database conventions → Audit logs";
 * migration 0003). This repo NEVER writes — it only reads, via the read pool
 * (`DrizzleService.dbRead`), newest-first, paginated.
 *
 * City scoping: super_admin / state_admin see everything; city_admin and below
 * see only entries whose actor user shares their city (join `users` on
 * `actor_user_id`). When the requesting actor has no resolvable city we fall
 * back to returning nothing scoped (the controller passes `cityId=undefined`
 * for the unscoped/super path).
 */

import { Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { audit_logs, users } from '../schema';

export interface AuditLogRow {
  id: string;
  actor_user_id: string;
  actor_role: string;
  action: string;
  entity_kind: string;
  entity_id: string;
  ip: string | null;
  user_agent: string | null;
  request_id: string | null;
  created_at: Date;
}

interface ListOpts {
  /** When set, restrict to entries whose actor user belongs to this city. */
  cityId?: string;
  limit?: number;
  offset?: number;
}

@Injectable()
export class AuditLogsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  /**
   * Most-recent-first page of audit entries. When `cityId` is provided, the
   * result is restricted to entries whose actor user is in that city (city_admin
   * scope). Omitting `cityId` returns the platform-wide feed (super/state).
   *
   * We deliberately do NOT select the `before`/`after` JSONB blobs here — the
   * admin list view only needs the coarse who/when/what columns, and the blobs
   * can be large. A detail endpoint can fetch them later if needed.
   */
  async list(opts: ListOpts = {}): Promise<AuditLogRow[]> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);

    const columns = {
      id: audit_logs.id,
      actor_user_id: audit_logs.actor_user_id,
      actor_role: audit_logs.actor_role,
      action: audit_logs.action,
      entity_kind: audit_logs.entity_kind,
      entity_id: audit_logs.entity_id,
      ip: audit_logs.ip,
      user_agent: audit_logs.user_agent,
      request_id: audit_logs.request_id,
      created_at: audit_logs.created_at,
    };

    if (opts.cityId) {
      const rows = await this.drizzle.dbRead
        .select(columns)
        .from(audit_logs)
        .innerJoin(users, eq(users.id, audit_logs.actor_user_id))
        .where(and(eq(users.city_id, opts.cityId)))
        .orderBy(desc(audit_logs.created_at))
        .limit(limit)
        .offset(offset);
      return rows as AuditLogRow[];
    }

    const rows = await this.drizzle.dbRead
      .select(columns)
      .from(audit_logs)
      .orderBy(desc(audit_logs.created_at))
      .limit(limit)
      .offset(offset);
    return rows as AuditLogRow[];
  }
}
