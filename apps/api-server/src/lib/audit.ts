/**
 * Append-only audit trail writer.
 * When called with a transaction handle, failures abort that transaction so
 * marks and audit commit together. Without a tx, best-effort (log + swallow)
 * so unrelated callers keep their prior behaviour.
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

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = typeof db | Tx;

function auditRowValues(input: AuditInput) {
  return {
    actor_user_id: input.actorId ?? null,
    actor_role: input.actorRole ?? null,
    action: input.action,
    entity_kind: input.entityKind,
    entity_id: input.entityId ?? null,
    summary: input.summary ?? null,
    metadata: input.metadata ?? null,
    ip: input.ip ?? null,
  };
}

export async function writeAudit(input: AuditInput, tx?: Tx): Promise<void> {
  const client: DbOrTx = tx ?? db;
  try {
    await client.insert(audit_logs).values(auditRowValues(input));
  } catch (err) {
    if (tx) throw err;
    logger.warn({ err, action: input.action, entityKind: input.entityKind }, "audit write failed");
  }
}

/** One INSERT for many rows (PERF #11 bulk grade). Empty input is a no-op. */
export async function writeAudits(inputs: AuditInput[], tx?: Tx): Promise<void> {
  if (inputs.length === 0) return;
  const client: DbOrTx = tx ?? db;
  try {
    await client.insert(audit_logs).values(inputs.map(auditRowValues));
  } catch (err) {
    if (tx) throw err;
    logger.warn({ err, count: inputs.length }, "audit batch write failed");
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
