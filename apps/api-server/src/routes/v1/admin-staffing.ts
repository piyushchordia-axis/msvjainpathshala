/**
 * /v1/admin staffing — sanchalak↔centre, shikshak↔centre, shikshak↔batch.
 *
 * Soft-deactivate only (is_active=false). Primary is display/default only.
 * Shikshak must be centre-tagged before any batch assignment (never auto-create).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  users,
  centres,
  batches,
  sanchalak_centre_assignments,
  shikshak_centre_assignments,
  shikshak_batch_assignments,
} from "@workspace/db";
import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth, requireAdminPanel } from "../../middlewares/auth";
import { resolveAdminScope, inCentreScope } from "../../lib/scope";
import { auditFromReq } from "../../lib/audit";
import type { Role } from "@workspace/api-zod";

const router: IRouter = Router();
router.use(requireAuth, requireAdminPanel);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CITY_PLUS: Role[] = ["super_admin", "state_admin", "city_admin"];
const SANCHALAK_PLUS: Role[] = [...CITY_PLUS, "sanchalak"];

function isCityPlus(role: string): boolean {
  return CITY_PLUS.includes(role as Role);
}
function isSanchalakPlus(role: string): boolean {
  return SANCHALAK_PLUS.includes(role as Role);
}

async function loadCentreInScope(
  req: Request,
  centreId: string,
): Promise<{ id: string; name: string } | null> {
  if (!UUID_RE.test(centreId)) return null;
  const scope = await resolveAdminScope(req.authUser!);
  const [row] = await db
    .select({ id: centres.id, name: centres.name })
    .from(centres)
    .where(and(eq(centres.id, centreId), isNull(centres.deleted_at)))
    .limit(1);
  if (!row || !inCentreScope(scope, row.id)) return null;
  return row;
}

async function loadBatchInScope(
  req: Request,
  batchId: string,
): Promise<{ id: string; name: string; centre_id: string } | null> {
  if (!UUID_RE.test(batchId)) return null;
  const scope = await resolveAdminScope(req.authUser!);
  const [row] = await db
    .select({ id: batches.id, name: batches.name, centre_id: batches.centre_id })
    .from(batches)
    .where(and(eq(batches.id, batchId), isNull(batches.deleted_at)))
    .limit(1);
  if (!row || !inCentreScope(scope, row.centre_id)) return null;
  return row;
}

async function userWithRole(userId: string, role: string) {
  const [u] = await db
    .select({ id: users.id, role: users.role, full_name: users.full_name, gender: users.gender })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deleted_at), eq(users.is_active, true)))
    .limit(1);
  if (!u) return null;
  if (u.role !== role) return null;
  return u;
}

const assignBody = z.object({ user_id: z.string().uuid() });

/* ─── Sanchalaks on a centre ─── */

/* GET /v1/admin/centres/:id/sanchalaks */
router.get("/centres/:id/sanchalaks", async (req: Request, res: Response) => {
  const centre = await loadCentreInScope(req, String(req.params.id));
  if (!centre) {
    fail(res, 404, "ERR_NOT_FOUND", "Centre not found in your scope.");
    return;
  }
  const rows = await db
    .select({
      id: sanchalak_centre_assignments.id,
      user_id: users.id,
      full_name: users.full_name,
      phone: users.phone,
      is_active: sanchalak_centre_assignments.is_active,
      assigned_at: sanchalak_centre_assignments.created_at,
    })
    .from(sanchalak_centre_assignments)
    .innerJoin(users, eq(users.id, sanchalak_centre_assignments.user_id))
    .where(
      and(
        eq(sanchalak_centre_assignments.centre_id, centre.id),
        eq(sanchalak_centre_assignments.is_active, true),
      ),
    )
    .orderBy(asc(users.full_name));
  ok(res, { items: rows }, { count: rows.length });
});

/* POST /v1/admin/centres/:id/sanchalaks — city_admin+ only */
router.post("/centres/:id/sanchalaks", async (req: Request, res: Response) => {
  if (!isCityPlus(req.authUser!.role)) {
    fail(res, 403, "ERR_FORBIDDEN", "Only city admins and above can assign sanchalaks.");
    return;
  }
  let body: z.infer<typeof assignBody>;
  try {
    body = assignBody.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "user_id is required.");
    return;
  }
  const centre = await loadCentreInScope(req, String(req.params.id));
  if (!centre) {
    fail(res, 404, "ERR_NOT_FOUND", "Centre not found in your scope.");
    return;
  }
  const target = await userWithRole(body.user_id, "sanchalak");
  if (!target) {
    fail(res, 422, "ERR_WRONG_ROLE", "User must be an active sanchalak.");
    return;
  }

  const [existing] = await db
    .select({ id: sanchalak_centre_assignments.id, is_active: sanchalak_centre_assignments.is_active })
    .from(sanchalak_centre_assignments)
    .where(
      and(
        eq(sanchalak_centre_assignments.user_id, target.id),
        eq(sanchalak_centre_assignments.centre_id, centre.id),
      ),
    )
    .limit(1);

  let assignmentId: string;
  if (existing?.is_active) {
    assignmentId = existing.id;
  } else if (existing) {
    const [row] = await db
      .update(sanchalak_centre_assignments)
      .set({
        is_active: true,
        deactivated_at: null,
        assigned_by: req.authUser!.id,
        updated_at: new Date(),
      })
      .where(eq(sanchalak_centre_assignments.id, existing.id))
      .returning({ id: sanchalak_centre_assignments.id });
    assignmentId = row.id;
  } else {
    const [row] = await db
      .insert(sanchalak_centre_assignments)
      .values({
        user_id: target.id,
        centre_id: centre.id,
        assigned_by: req.authUser!.id,
      })
      .returning({ id: sanchalak_centre_assignments.id });
    assignmentId = row.id;
  }

  await auditFromReq(req, {
    action: "assign",
    entityKind: "sanchalak_centre_assignment",
    entityId: assignmentId,
    summary: `Assigned sanchalak ${target.full_name} to ${centre.name}.`,
    metadata: { user_id: target.id, centre_id: centre.id },
  });
  ok(res, { id: assignmentId, user_id: target.id, centre_id: centre.id });
});

/* POST /v1/admin/centres/:id/sanchalaks/:userId/remove — city_admin+; reject last */
router.post("/centres/:id/sanchalaks/:userId/remove", async (req: Request, res: Response) => {
  if (!isCityPlus(req.authUser!.role)) {
    fail(res, 403, "ERR_FORBIDDEN", "Only city admins and above can remove sanchalaks.");
    return;
  }
  const centre = await loadCentreInScope(req, String(req.params.id));
  if (!centre) {
    fail(res, 404, "ERR_NOT_FOUND", "Centre not found in your scope.");
    return;
  }
  const userId = String(req.params.userId);
  if (!UUID_RE.test(userId)) {
    fail(res, 404, "ERR_NOT_FOUND", "Assignment not found.");
    return;
  }

  const [{ activeCount }] = await db
    .select({ activeCount: count() })
    .from(sanchalak_centre_assignments)
    .where(
      and(
        eq(sanchalak_centre_assignments.centre_id, centre.id),
        eq(sanchalak_centre_assignments.is_active, true),
      ),
    );
  if (Number(activeCount) <= 1) {
    const [only] = await db
      .select({ user_id: sanchalak_centre_assignments.user_id })
      .from(sanchalak_centre_assignments)
      .where(
        and(
          eq(sanchalak_centre_assignments.centre_id, centre.id),
          eq(sanchalak_centre_assignments.is_active, true),
        ),
      )
      .limit(1);
    if (only?.user_id === userId) {
      fail(res, 422, "ERR_LAST_SANCHALAK", "A centre must keep at least one active sanchalak.");
      return;
    }
  }

  const [row] = await db
    .update(sanchalak_centre_assignments)
    .set({
      is_active: false,
      deactivated_at: new Date(),
      updated_at: new Date(),
    })
    .where(
      and(
        eq(sanchalak_centre_assignments.centre_id, centre.id),
        eq(sanchalak_centre_assignments.user_id, userId),
        eq(sanchalak_centre_assignments.is_active, true),
      ),
    )
    .returning({ id: sanchalak_centre_assignments.id });
  if (!row) {
    fail(res, 404, "ERR_NOT_FOUND", "Active sanchalak assignment not found.");
    return;
  }

  await auditFromReq(req, {
    action: "assign",
    entityKind: "sanchalak_centre_assignment",
    entityId: row.id,
    summary: `Removed sanchalak from ${centre.name}.`,
    metadata: { user_id: userId, centre_id: centre.id, removed: true },
  });
  ok(res, { id: row.id, removed: true });
});

/* ─── Shikshaks on a centre ─── */

/* GET /v1/admin/centres/:id/shikshaks */
router.get("/centres/:id/shikshaks", async (req: Request, res: Response) => {
  const centre = await loadCentreInScope(req, String(req.params.id));
  if (!centre) {
    fail(res, 404, "ERR_NOT_FOUND", "Centre not found in your scope.");
    return;
  }
  const role = req.authUser!.role;
  const rows = await db
    .select({
      id: shikshak_centre_assignments.id,
      user_id: users.id,
      full_name: users.full_name,
      phone: users.phone,
      gender: users.gender,
      is_active: shikshak_centre_assignments.is_active,
    })
    .from(shikshak_centre_assignments)
    .innerJoin(users, eq(users.id, shikshak_centre_assignments.user_id))
    .where(
      and(
        eq(shikshak_centre_assignments.centre_id, centre.id),
        eq(shikshak_centre_assignments.is_active, true),
        role === "shikshak" ? eq(shikshak_centre_assignments.user_id, req.authUser!.id) : undefined,
      ),
    )
    .orderBy(asc(users.full_name));

  const userIds = rows.map((r) => r.user_id);
  const counts =
    userIds.length === 0
      ? []
      : await db
          .select({
            user_id: shikshak_batch_assignments.user_id,
            batch_count: count(),
          })
          .from(shikshak_batch_assignments)
          .innerJoin(batches, eq(batches.id, shikshak_batch_assignments.batch_id))
          .where(
            and(
              inArray(shikshak_batch_assignments.user_id, userIds),
              eq(shikshak_batch_assignments.is_active, true),
              eq(batches.centre_id, centre.id),
              isNull(batches.deleted_at),
            ),
          )
          .groupBy(shikshak_batch_assignments.user_id);
  const countMap = new Map(counts.map((c) => [c.user_id, Number(c.batch_count)]));
  const items = rows.map((r) => ({ ...r, batch_count: countMap.get(r.user_id) ?? 0 }));
  ok(res, { items }, { count: items.length });
});

/* POST /v1/admin/centres/:id/shikshaks */
router.post("/centres/:id/shikshaks", async (req: Request, res: Response) => {
  if (!isSanchalakPlus(req.authUser!.role)) {
    fail(res, 403, "ERR_FORBIDDEN", "You cannot assign shikshaks to centres.");
    return;
  }
  let body: z.infer<typeof assignBody>;
  try {
    body = assignBody.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "user_id is required.");
    return;
  }
  const centre = await loadCentreInScope(req, String(req.params.id));
  if (!centre) {
    fail(res, 404, "ERR_NOT_FOUND", "Centre not found in your scope.");
    return;
  }
  const target = await userWithRole(body.user_id, "shikshak");
  if (!target) {
    fail(res, 422, "ERR_WRONG_ROLE", "User must be an active shikshak.");
    return;
  }

  const [existing] = await db
    .select({ id: shikshak_centre_assignments.id, is_active: shikshak_centre_assignments.is_active })
    .from(shikshak_centre_assignments)
    .where(
      and(
        eq(shikshak_centre_assignments.user_id, target.id),
        eq(shikshak_centre_assignments.centre_id, centre.id),
      ),
    )
    .limit(1);

  let assignmentId: string;
  if (existing?.is_active) {
    assignmentId = existing.id;
  } else if (existing) {
    const [row] = await db
      .update(shikshak_centre_assignments)
      .set({
        is_active: true,
        deactivated_at: null,
        assigned_by: req.authUser!.id,
        updated_at: new Date(),
      })
      .where(eq(shikshak_centre_assignments.id, existing.id))
      .returning({ id: shikshak_centre_assignments.id });
    assignmentId = row.id;
  } else {
    const [row] = await db
      .insert(shikshak_centre_assignments)
      .values({
        user_id: target.id,
        centre_id: centre.id,
        assigned_by: req.authUser!.id,
      })
      .returning({ id: shikshak_centre_assignments.id });
    assignmentId = row.id;
  }

  await auditFromReq(req, {
    action: "assign",
    entityKind: "shikshak_centre_assignment",
    entityId: assignmentId,
    summary: `Tagged shikshak ${target.full_name} to ${centre.name}.`,
    metadata: { user_id: target.id, centre_id: centre.id },
  });
  ok(res, { id: assignmentId, user_id: target.id, centre_id: centre.id });
});

/* POST /v1/admin/centres/:id/shikshaks/:userId/remove — also deactivates batch assignments in this centre */
router.post("/centres/:id/shikshaks/:userId/remove", async (req: Request, res: Response) => {
  if (!isSanchalakPlus(req.authUser!.role)) {
    fail(res, 403, "ERR_FORBIDDEN", "You cannot remove shikshak centre tags.");
    return;
  }
  const centre = await loadCentreInScope(req, String(req.params.id));
  if (!centre) {
    fail(res, 404, "ERR_NOT_FOUND", "Centre not found in your scope.");
    return;
  }
  const userId = String(req.params.userId);
  if (!UUID_RE.test(userId)) {
    fail(res, 404, "ERR_NOT_FOUND", "Assignment not found.");
    return;
  }

  const result = await db.transaction(async (tx) => {
    const [centreRow] = await tx
      .update(shikshak_centre_assignments)
      .set({
        is_active: false,
        deactivated_at: new Date(),
        updated_at: new Date(),
      })
      .where(
        and(
          eq(shikshak_centre_assignments.centre_id, centre.id),
          eq(shikshak_centre_assignments.user_id, userId),
          eq(shikshak_centre_assignments.is_active, true),
        ),
      )
      .returning({ id: shikshak_centre_assignments.id });
    if (!centreRow) return null;

    const batchRows = await tx
      .select({
        id: shikshak_batch_assignments.id,
        batch_id: shikshak_batch_assignments.batch_id,
        is_primary: shikshak_batch_assignments.is_primary,
      })
      .from(shikshak_batch_assignments)
      .innerJoin(batches, eq(batches.id, shikshak_batch_assignments.batch_id))
      .where(
        and(
          eq(shikshak_batch_assignments.user_id, userId),
          eq(shikshak_batch_assignments.is_active, true),
          eq(batches.centre_id, centre.id),
        ),
      );

    const batchIds = batchRows.map((r) => r.batch_id);
    const primaryBatchIds = batchRows.filter((r) => r.is_primary).map((r) => r.batch_id);

    if (batchIds.length > 0) {
      await tx
        .update(shikshak_batch_assignments)
        .set({
          is_active: false,
          is_primary: false,
          deactivated_at: new Date(),
          updated_at: new Date(),
        })
        .where(
          and(
            eq(shikshak_batch_assignments.user_id, userId),
            eq(shikshak_batch_assignments.is_active, true),
            inArray(shikshak_batch_assignments.batch_id, batchIds),
          ),
        );
    }

    return {
      id: centreRow.id,
      deactivated_batch_ids: batchIds,
      primary_batch_ids: primaryBatchIds,
    };
  });

  if (!result) {
    fail(res, 404, "ERR_NOT_FOUND", "Active shikshak centre assignment not found.");
    return;
  }

  await auditFromReq(req, {
    action: "assign",
    entityKind: "shikshak_centre_assignment",
    entityId: result.id,
    summary: `Removed shikshak from ${centre.name}; cleared ${result.deactivated_batch_ids.length} batch assignment(s).`,
    metadata: {
      user_id: userId,
      centre_id: centre.id,
      deactivated_batch_ids: result.deactivated_batch_ids,
      primary_batch_ids: result.primary_batch_ids,
    },
  });
  ok(res, result);
});

/* ─── Shikshaks on a batch ─── */

/* GET /v1/admin/batches/:id/shikshaks */
router.get("/batches/:id/shikshaks", async (req: Request, res: Response) => {
  const batch = await loadBatchInScope(req, String(req.params.id));
  if (!batch) {
    fail(res, 404, "ERR_NOT_FOUND", "Batch not found in your scope.");
    return;
  }
  const role = req.authUser!.role;
  const baseWhere = and(
    eq(shikshak_batch_assignments.batch_id, batch.id),
    eq(shikshak_batch_assignments.is_active, true),
    role === "shikshak" ? eq(shikshak_batch_assignments.user_id, req.authUser!.id) : undefined,
  );

  const rows = await db
    .select({
      id: shikshak_batch_assignments.id,
      user_id: users.id,
      full_name: users.full_name,
      phone: users.phone,
      gender: users.gender,
      is_primary: shikshak_batch_assignments.is_primary,
    })
    .from(shikshak_batch_assignments)
    .innerJoin(users, eq(users.id, shikshak_batch_assignments.user_id))
    .where(baseWhere)
    .orderBy(asc(users.full_name));
  ok(res, { items: rows, centre_id: batch.centre_id }, { count: rows.length });
});

/* POST /v1/admin/batches/:id/shikshaks — requires centre tag */
router.post("/batches/:id/shikshaks", async (req: Request, res: Response) => {
  if (!isSanchalakPlus(req.authUser!.role)) {
    fail(res, 403, "ERR_FORBIDDEN", "You cannot assign shikshaks to batches.");
    return;
  }
  const bodySchema = z.object({
    user_id: z.string().uuid(),
    is_primary: z.boolean().optional(),
  });
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "user_id is required.");
    return;
  }
  const batch = await loadBatchInScope(req, String(req.params.id));
  if (!batch) {
    fail(res, 404, "ERR_NOT_FOUND", "Batch not found in your scope.");
    return;
  }
  const target = await userWithRole(body.user_id, "shikshak");
  if (!target) {
    fail(res, 422, "ERR_WRONG_ROLE", "User must be an active shikshak.");
    return;
  }

  const [tagged] = await db
    .select({ id: shikshak_centre_assignments.id })
    .from(shikshak_centre_assignments)
    .where(
      and(
        eq(shikshak_centre_assignments.user_id, target.id),
        eq(shikshak_centre_assignments.centre_id, batch.centre_id),
        eq(shikshak_centre_assignments.is_active, true),
      ),
    )
    .limit(1);
  if (!tagged) {
    fail(
      res,
      422,
      "ERR_NOT_CENTRE_TAGGED",
      "Shikshak must be tagged to this batch's centre before batch assignment.",
    );
    return;
  }

  const makePrimary = body.is_primary === true;
  const assignmentId = await db.transaction(async (tx) => {
    if (makePrimary) {
      await tx
        .update(shikshak_batch_assignments)
        .set({ is_primary: false, updated_at: new Date() })
        .where(
          and(
            eq(shikshak_batch_assignments.batch_id, batch.id),
            eq(shikshak_batch_assignments.is_active, true),
            eq(shikshak_batch_assignments.is_primary, true),
          ),
        );
    }

    const [existing] = await tx
      .select({
        id: shikshak_batch_assignments.id,
        is_active: shikshak_batch_assignments.is_active,
      })
      .from(shikshak_batch_assignments)
      .where(
        and(
          eq(shikshak_batch_assignments.user_id, target.id),
          eq(shikshak_batch_assignments.batch_id, batch.id),
        ),
      )
      .limit(1);

    if (existing?.is_active) {
      if (makePrimary) {
        await tx
          .update(shikshak_batch_assignments)
          .set({ is_primary: true, updated_at: new Date() })
          .where(eq(shikshak_batch_assignments.id, existing.id));
      }
      return existing.id;
    }
    if (existing) {
      const [row] = await tx
        .update(shikshak_batch_assignments)
        .set({
          is_active: true,
          is_primary: makePrimary,
          deactivated_at: null,
          assigned_by: req.authUser!.id,
          updated_at: new Date(),
        })
        .where(eq(shikshak_batch_assignments.id, existing.id))
        .returning({ id: shikshak_batch_assignments.id });
      return row.id;
    }
    const [row] = await tx
      .insert(shikshak_batch_assignments)
      .values({
        user_id: target.id,
        batch_id: batch.id,
        is_primary: makePrimary,
        assigned_by: req.authUser!.id,
      })
      .returning({ id: shikshak_batch_assignments.id });
    return row.id;
  });

  await auditFromReq(req, {
    action: "assign",
    entityKind: "shikshak_batch_assignment",
    entityId: assignmentId,
    summary: `Assigned shikshak ${target.full_name} to batch ${batch.name}${makePrimary ? " as primary" : ""}.`,
    metadata: { user_id: target.id, batch_id: batch.id, is_primary: makePrimary },
  });
  ok(res, { id: assignmentId, user_id: target.id, batch_id: batch.id, is_primary: makePrimary });
});

/* POST /v1/admin/batches/:id/shikshaks/:userId/remove */
router.post("/batches/:id/shikshaks/:userId/remove", async (req: Request, res: Response) => {
  if (!isSanchalakPlus(req.authUser!.role)) {
    fail(res, 403, "ERR_FORBIDDEN", "You cannot remove shikshak batch assignments.");
    return;
  }
  const batch = await loadBatchInScope(req, String(req.params.id));
  if (!batch) {
    fail(res, 404, "ERR_NOT_FOUND", "Batch not found in your scope.");
    return;
  }
  const userId = String(req.params.userId);
  if (!UUID_RE.test(userId)) {
    fail(res, 404, "ERR_NOT_FOUND", "Assignment not found.");
    return;
  }

  const [existing] = await db
    .select({
      id: shikshak_batch_assignments.id,
      is_primary: shikshak_batch_assignments.is_primary,
    })
    .from(shikshak_batch_assignments)
    .where(
      and(
        eq(shikshak_batch_assignments.batch_id, batch.id),
        eq(shikshak_batch_assignments.user_id, userId),
        eq(shikshak_batch_assignments.is_active, true),
      ),
    )
    .limit(1);
  if (!existing) {
    fail(res, 404, "ERR_NOT_FOUND", "Active batch assignment not found.");
    return;
  }

  await db
    .update(shikshak_batch_assignments)
    .set({
      is_active: false,
      is_primary: false,
      deactivated_at: new Date(),
      updated_at: new Date(),
    })
    .where(eq(shikshak_batch_assignments.id, existing.id));

  await auditFromReq(req, {
    action: "assign",
    entityKind: "shikshak_batch_assignment",
    entityId: existing.id,
    summary: `Removed shikshak from batch ${batch.name}.`,
    metadata: { user_id: userId, batch_id: batch.id, was_primary: existing.is_primary },
  });
  ok(res, { id: existing.id, removed: true, was_primary: existing.is_primary });
});

/* POST /v1/admin/batches/:id/primary — promote; demote previous in same txn */
router.post("/batches/:id/primary", async (req: Request, res: Response) => {
  if (!isSanchalakPlus(req.authUser!.role)) {
    fail(res, 403, "ERR_FORBIDDEN", "You cannot set the primary shikshak.");
    return;
  }
  let body: z.infer<typeof assignBody>;
  try {
    body = assignBody.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "user_id is required.");
    return;
  }
  const batch = await loadBatchInScope(req, String(req.params.id));
  if (!batch) {
    fail(res, 404, "ERR_NOT_FOUND", "Batch not found in your scope.");
    return;
  }

  const [assignment] = await db
    .select({ id: shikshak_batch_assignments.id })
    .from(shikshak_batch_assignments)
    .where(
      and(
        eq(shikshak_batch_assignments.batch_id, batch.id),
        eq(shikshak_batch_assignments.user_id, body.user_id),
        eq(shikshak_batch_assignments.is_active, true),
      ),
    )
    .limit(1);
  if (!assignment) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "User is not an active shikshak on this batch.");
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(shikshak_batch_assignments)
      .set({ is_primary: false, updated_at: new Date() })
      .where(
        and(
          eq(shikshak_batch_assignments.batch_id, batch.id),
          eq(shikshak_batch_assignments.is_active, true),
          eq(shikshak_batch_assignments.is_primary, true),
        ),
      );
    await tx
      .update(shikshak_batch_assignments)
      .set({ is_primary: true, updated_at: new Date() })
      .where(eq(shikshak_batch_assignments.id, assignment.id));
  });

  await auditFromReq(req, {
    action: "assign",
    entityKind: "shikshak_batch_assignment",
    entityId: assignment.id,
    summary: `Set primary shikshak on batch ${batch.name}.`,
    metadata: { user_id: body.user_id, batch_id: batch.id },
  });
  ok(res, { batch_id: batch.id, user_id: body.user_id, is_primary: true });
});

/* GET /v1/admin/staffing/me — centres + batches for the caller (or ?user_id= for admins) */
router.get("/staffing/me", async (req: Request, res: Response) => {
  const role = req.authUser!.role;
  let userId = req.authUser!.id;
  const qUser = typeof req.query.user_id === "string" ? req.query.user_id : null;
  if (qUser && UUID_RE.test(qUser)) {
    if (!isSanchalakPlus(role)) {
      fail(res, 403, "ERR_FORBIDDEN", "You can only view your own staffing.");
      return;
    }
    userId = qUser;
  }

  const centreRows = await db
    .select({
      centre_id: shikshak_centre_assignments.centre_id,
      centre_name: centres.name,
    })
    .from(shikshak_centre_assignments)
    .innerJoin(centres, eq(centres.id, shikshak_centre_assignments.centre_id))
    .where(
      and(
        eq(shikshak_centre_assignments.user_id, userId),
        eq(shikshak_centre_assignments.is_active, true),
        isNull(centres.deleted_at),
      ),
    )
    .orderBy(asc(centres.name));

  const batchRows = await db
    .select({
      batch_id: shikshak_batch_assignments.batch_id,
      batch_name: batches.name,
      centre_id: batches.centre_id,
      is_primary: shikshak_batch_assignments.is_primary,
    })
    .from(shikshak_batch_assignments)
    .innerJoin(batches, eq(batches.id, shikshak_batch_assignments.batch_id))
    .where(
      and(
        eq(shikshak_batch_assignments.user_id, userId),
        eq(shikshak_batch_assignments.is_active, true),
        isNull(batches.deleted_at),
      ),
    )
    .orderBy(asc(batches.name));

  // Also surface sanchalak centres when viewing self as sanchalak
  let sanchalakCentres: { centre_id: string; centre_name: string }[] = [];
  if (role === "sanchalak" && userId === req.authUser!.id) {
    sanchalakCentres = await db
      .select({
        centre_id: sanchalak_centre_assignments.centre_id,
        centre_name: centres.name,
      })
      .from(sanchalak_centre_assignments)
      .innerJoin(centres, eq(centres.id, sanchalak_centre_assignments.centre_id))
      .where(
        and(
          eq(sanchalak_centre_assignments.user_id, userId),
          eq(sanchalak_centre_assignments.is_active, true),
          isNull(centres.deleted_at),
        ),
      )
      .orderBy(asc(centres.name));
  }

  ok(res, {
    user_id: userId,
    centres: centreRows,
    batches: batchRows,
    sanchalak_centres: sanchalakCentres,
  });
});

/* GET /v1/admin/users/pick?role=shikshak|sanchalak — role-filtered picker for staffing UIs */
router.get("/users/pick", async (req: Request, res: Response) => {
  if (!isSanchalakPlus(req.authUser!.role)) {
    fail(res, 403, "ERR_FORBIDDEN", "Not allowed.");
    return;
  }
  const roleParse = z.enum(["shikshak", "sanchalak"]).safeParse(req.query.role);
  if (!roleParse.success) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "role must be shikshak or sanchalak.");
    return;
  }
  if (roleParse.data === "sanchalak" && !isCityPlus(req.authUser!.role)) {
    fail(res, 403, "ERR_FORBIDDEN", "Only city admins and above can list sanchalaks.");
    return;
  }
  const rows = await db
    .select({
      id: users.id,
      full_name: users.full_name,
      phone: users.phone,
      gender: users.gender,
      role: users.role,
    })
    .from(users)
    .where(
      and(
        eq(users.role, roleParse.data),
        eq(users.is_active, true),
        isNull(users.deleted_at),
      ),
    )
    .orderBy(asc(users.full_name))
    .limit(200);
  ok(res, { items: rows }, { count: rows.length });
});

export default router;
