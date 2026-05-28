/**
 * AuditService — single entry point for emitting audit rows.
 *
 * Two paths:
 *   1. Async (preferred, when `audit.async_enabled=true` and a BullMQ
 *      worker is registered) — enqueue to QUEUES.AUDIT_WRITE. Step 7
 *      lands the matching worker that consumes the queue and inserts
 *      via SET ROLE audit_writer.
 *   2. Sync fallback (Step 5 default — `audit.async_enabled=false`):
 *      INSERT directly via `SET ROLE audit_writer; INSERT …; RESET ROLE;`
 *      on the same connection. Slightly higher latency on the request
 *      path; correctness equivalent.
 *
 * Either way, the application's normal connection role NEVER gets
 * INSERT-ALSO-UPDATE on audit_logs — audit_writer is INSERT-only by
 * design (CLAUDE.md "Database conventions → Audit logs"; migration 0003).
 */

import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';

import { QUEUES, type AuditAction, type Role } from '@jp/shared';

import { DrizzleService } from '../../core/database/drizzle.service';
import { RedisService } from '../../core/redis/redis.service';
import { SystemConfigService } from '../../core/system-config/system-config.service';

export interface AuditEvent {
  actor_user_id: string;
  actor_role: Role;
  action: AuditAction | string; // domain-specific actions allowed beyond the enum
  entity_kind: string;
  entity_id: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ip?: string | null;
  user_agent?: string | null;
  request_id?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  private readonly auditQueue: Queue<AuditEvent>;

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly config: SystemConfigService,
    redis: RedisService,
  ) {
    this.auditQueue = new Queue<AuditEvent>(QUEUES.AUDIT_WRITE, {
      connection: redis.bullmqClient,
    });
  }

  /**
   * Emit an audit row. Returns immediately — the row is durable by the time
   * this promise resolves (either via direct DB insert or via the queue
   * having accepted the job).
   */
  async emit(event: AuditEvent): Promise<void> {
    const asyncEnabled = await this.config.getBoolean('audit.async_enabled');
    if (asyncEnabled) {
      try {
        await this.auditQueue.add('write', event, {
          removeOnComplete: 1000,
          removeOnFail: 5000,
          attempts: 5,
          backoff: { type: 'exponential', delay: 1000 },
        });
        return;
      } catch (err) {
        // Queue unavailable — fall through to direct write so audit is
        // never lost.
        this.logger.warn(
          `audit queue failed (${(err as Error).message}); falling back to direct DB insert`,
        );
      }
    }

    await this.writeDirect(event);
  }

  /**
   * Direct DB write under the audit_writer role. We use `SET LOCAL ROLE`
   * inside a transaction so the role assumption is scoped to the INSERT
   * and reverts on COMMIT — no risk of leaving the connection in
   * audit_writer state.
   */
  private async writeDirect(event: AuditEvent): Promise<void> {
    try {
      const enumAction = this.mapToEnumAction(event.action);
      // Keep the detailed event string alongside in the `after` JSONB so
      // operators can grep by `auth.login.success`, `auth.refresh.rotated`,
      // etc. — the column-level enum is the coarse filter SPEC §5.1 requires.
      const after = { ...(event.after ?? {}), event_kind: event.action };
      await this.drizzle.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE audit_writer`);
        await tx.execute(sql`
          INSERT INTO audit_logs
            (actor_user_id, actor_role, action, entity_kind, entity_id,
             before, after, ip, user_agent, request_id)
          VALUES
            (${event.actor_user_id}, ${event.actor_role}, ${enumAction},
             ${event.entity_kind}, ${event.entity_id},
             ${event.before ? JSON.stringify(event.before) : null}::jsonb,
             ${JSON.stringify(after)}::jsonb,
             ${event.ip ?? null}, ${event.user_agent ?? null}, ${event.request_id ?? null})
        `);
      });
    } catch (err) {
      // Audit MUST NOT silently fail in production; log loudly so the
      // operator sees it. Service code that depends on audit can choose
      // to surface the error to the user.
      this.logger.error(
        `audit write FAILED for action=${event.action} entity=${event.entity_kind}:${event.entity_id}: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  /**
   * Coerce a free-form event string into one of the 9 SPEC §5.1 enum values
   * for the audit_logs.action column. The detailed string is preserved in
   * the JSONB `after.event_kind`.
   *
   * Heuristic prefix mapping — adjust if a new event family doesn't fit.
   */
  private mapToEnumAction(action: string): AuditAction {
    const a = action.toLowerCase();
    if (a.includes('logout')) return 'logout';
    if (
      a.includes('login') ||
      a.includes('refresh.rotated') ||
      a.includes('impersonation.started') ||
      a.includes('impersonation.subject')
    )
      return 'login';
    if (a.includes('config') || a.includes('settings')) return 'config_change';
    if (a.includes('reject') || a.includes('reuse_detected') || a.includes('rate_limited'))
      return 'reject';
    if (a.includes('approve')) return 'approve';
    if (a.includes('transfer')) return 'transfer';
    if (a.includes('delete') || a.includes('revoked')) return 'delete';
    if (a.includes('create') || a.includes('start') || a.includes('issued')) return 'create';
    return 'update';
  }

  /** Used at shutdown to drain in-flight queue connections. */
  async onModuleDestroy(): Promise<void> {
    await this.auditQueue.close().catch(() => undefined);
  }
}
