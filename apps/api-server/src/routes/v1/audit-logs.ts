/**
 * /v1/audit-logs — read-only access to the append-only audit trail.
 *
 * High-trust, org-wide: restricted to super_admin and state_admin. Writes
 * happen elsewhere via lib/audit.ts (auditFromReq); this module never mutates.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, audit_logs, users } from "@workspace/db";
import { AUDIT_ACTIONS } from "@workspace/db/enums";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { ok } from "../../lib/envelope";
import { requireAuth, requireRole } from "../../middlewares/auth";

const router: IRouter = Router();
router.use(requireAuth, requireRole("super_admin", "state_admin"));

function clampLimit(raw: unknown, fallback: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

const actionSchema = z.enum(AUDIT_ACTIONS);
const entityKindSchema = z.string().min(1).max(120);

/* GET /v1/audit-logs?action?&entity_kind?&limit= — newest first */
router.get("/", async (req: Request, res: Response) => {
  // Parse the two filters INDEPENDENTLY so an invalid action does not also
  // discard a valid entity_kind filter (and vice versa).
  const actionParsed = actionSchema.safeParse(req.query.action);
  const entityKindParsed = entityKindSchema.safeParse(req.query.entity_kind);

  const limit = clampLimit(req.query.limit, 100, 300);

  const conditions = [];
  if (actionParsed.success) conditions.push(eq(audit_logs.action, actionParsed.data));
  if (entityKindParsed.success)
    conditions.push(eq(audit_logs.entity_kind, entityKindParsed.data));
  const where = conditions.length ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: audit_logs.id,
      actor_user_id: audit_logs.actor_user_id,
      actor_name: users.full_name,
      actor_role: audit_logs.actor_role,
      action: audit_logs.action,
      entity_kind: audit_logs.entity_kind,
      entity_id: audit_logs.entity_id,
      summary: audit_logs.summary,
      created_at: audit_logs.created_at,
    })
    .from(audit_logs)
    .leftJoin(users, eq(users.id, audit_logs.actor_user_id))
    .where(where)
    .orderBy(desc(audit_logs.created_at))
    .limit(limit);

  const items = rows.map((r) => ({ ...r, created_at: r.created_at.toISOString() }));
  ok(res, { items }, { count: items.length });
});

/* GET /v1/audit-logs/actions — distinct audit action enum values (filter UI) */
router.get("/actions", async (_req: Request, res: Response) => {
  const items = [...AUDIT_ACTIONS];
  ok(res, { items }, { count: items.length });
});

export default router;
