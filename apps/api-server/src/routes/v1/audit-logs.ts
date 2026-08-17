/**
 * /v1/audit-logs — read-only access to the append-only audit trail.
 *
 * High-trust, org-wide: restricted to super_admin and state_admin. Writes
 * happen elsewhere via lib/audit.ts (auditFromReq); this module never mutates.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, audit_logs, users } from "@workspace/db";
import { AUDIT_ACTIONS } from "@workspace/db/enums";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { z } from "zod";
import { ok } from "../../lib/envelope";
import { requireAuth, requireRole } from "../../middlewares/auth";
import { clampLimit } from "../../lib/route-helpers";

const router: IRouter = Router();
router.use(requireAuth, requireRole("super_admin", "state_admin"));


const actionSchema = z.enum(AUDIT_ACTIONS);
const entityKindSchema = z.string().min(1).max(120);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function decodeCursor(raw: unknown): { ts: Date; id: string } | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const [tsIso, id] = Buffer.from(raw, "base64url").toString("utf8").split("|");
    if (!tsIso || !id || !UUID_RE.test(id)) return null;
    const ts = new Date(tsIso);
    if (!Number.isFinite(ts.getTime())) return null;
    return { ts, id };
  } catch {
    return null;
  }
}

function encodeCursor(ts: Date, id: string): string {
  return Buffer.from(`${ts.toISOString()}|${id}`, "utf8").toString("base64url");
}

/* GET /v1/audit-logs?action?&entity_kind?&limit?&cursor? — newest first.
   Keyset cursor (STA-API-01): the hard 200-row cap meant nothing before the
   newest page was ever reachable. */
router.get("/", async (req: Request, res: Response) => {
  // Parse the two filters INDEPENDENTLY so an invalid action does not also
  // discard a valid entity_kind filter (and vice versa).
  const actionParsed = actionSchema.safeParse(req.query.action);
  const entityKindParsed = entityKindSchema.safeParse(req.query.entity_kind);

  const limit = clampLimit(req.query.limit, 100, 300);
  const cursor = decodeCursor(req.query.cursor);

  const conditions = [];
  if (actionParsed.success) conditions.push(eq(audit_logs.action, actionParsed.data));
  if (entityKindParsed.success)
    conditions.push(eq(audit_logs.entity_kind, entityKindParsed.data));
  if (cursor) {
    conditions.push(
      or(
        lt(audit_logs.created_at, cursor.ts),
        and(eq(audit_logs.created_at, cursor.ts), lt(audit_logs.id, cursor.id)),
      )!,
    );
  }
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
    .orderBy(desc(audit_logs.created_at), desc(audit_logs.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const items = page.map((r) => ({ ...r, created_at: r.created_at.toISOString() }));
  ok(
    res,
    { items },
    {
      count: items.length,
      has_more: hasMore,
      next_cursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
    },
  );
});

/* GET /v1/audit-logs/actions — distinct audit action enum values (filter UI) */
router.get("/actions", async (_req: Request, res: Response) => {
  const items = [...AUDIT_ACTIONS];
  ok(res, { items }, { count: items.length });
});

export default router;
