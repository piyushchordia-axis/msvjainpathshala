/**
 * Append-only audit trail writer. Best-effort: never throws, never blocks the
 * request path. Call on sensitive mutations (approvals, rejections, awards,
 * assignments, config changes, etc.).
 */
import type { Request } from "express";
import { db, audit_logs } from "@workspace/db";
import { AUDIT_ACTIONS } from "@workspace/db/enums";
import type { Role } from "@workspace/api-zod";
import { logger } from "./logger";

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditInput {
  actorId?: string | null;
  actorRole?: Role | null;
  action: AuditAction;
  entityKind: string;
  entityId?: string | null;
  summary?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    await db.insert(audit_logs).values({
      actor_user_id: input.actorId ?? null,
      actor_role: input.actorRole ?? null,
      action: input.action,
      entity_kind: input.entityKind,
      entity_id: input.entityId ?? null,
      summary: input.summary ?? null,
      metadata: input.metadata ?? null,
      ip: input.ip ?? null,
    });
  } catch (err) {
    logger.warn({ err, action: input.action, entityKind: input.entityKind }, "audit write failed");
  }
}

/** Convenience wrapper that pulls actor + ip from the authed request. */
export async function auditFromReq(
  req: Request,
  input: Omit<AuditInput, "actorId" | "actorRole" | "ip">,
): Promise<void> {
  await writeAudit({
    ...input,
    actorId: req.authUser?.id ?? null,
    actorRole: (req.authUser?.role as Role | undefined) ?? null,
    ip: req.ip ?? null,
  });
}
