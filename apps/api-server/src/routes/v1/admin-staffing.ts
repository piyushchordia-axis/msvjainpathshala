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
import { and, asc, count, eq, inArray, isNull, notInArray, or } from "drizzle-orm";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth, requireAdminPanel } from "../../middlewares/auth";
import { resolveAdminScope, inCentreScope } from "../../lib/scope";
import { auditFromReq } from "../../lib/audit";
import { allocateSanchalakCode, allocateShikshakCode } from "../../lib/entity-codes";
import { syncTeamMemberForUser } from "../../lib/team-members-sync";
import type { Role } from "@workspace/api-zod";

const phoneSchema = z.string().regex(/^\+[1-9]\d{6,14}$/, "Phone must be E.164 (+91…)");
const genderSchema = z.enum(["male", "female", "other"]);
const staffRoleSchema = z.enum(["sanchalak", "shikshak"]);

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
  await syncTeamMemberForUser(target.id);
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
  await syncTeamMemberForUser(userId);
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
  const batchAssigns =
    userIds.length === 0
      ? []
      : await db
          .select({
            user_id: shikshak_batch_assignments.user_id,
            batch_id: batches.id,
            batch_name: batches.name,
            is_primary: shikshak_batch_assignments.is_primary,
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
          .orderBy(asc(batches.name));
  const byUser = new Map<
    string,
    { batch_id: string; batch_name: string; is_primary: boolean }[]
  >();
  for (const a of batchAssigns) {
    const list = byUser.get(a.user_id) ?? [];
    list.push({
      batch_id: a.batch_id,
      batch_name: a.batch_name,
      is_primary: a.is_primary,
    });
    byUser.set(a.user_id, list);
  }
  const items = rows.map((r) => {
    const batchesForUser = byUser.get(r.user_id) ?? [];
    return { ...r, batch_count: batchesForUser.length, batches: batchesForUser };
  });
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
  await syncTeamMemberForUser(target.id);
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
  await syncTeamMemberForUser(userId);
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

/* PUT /v1/admin/centres/:id/shikshaks/:userId/batches — atomic reconcile
   (SAN-PRF-02): the web editor issued up to N removes + M adds + a primary
   call serially, leaving partial state whenever one failed mid-way. */
router.put("/centres/:id/shikshaks/:userId/batches", async (req: Request, res: Response) => {
  if (!isSanchalakPlus(req.authUser!.role)) {
    fail(res, 403, "ERR_FORBIDDEN", "You cannot assign shikshaks to batches.");
    return;
  }
  const bodySchema = z.object({
    batch_ids: z.array(z.string().uuid()).max(100),
    primary_batch_id: z.string().uuid().optional(),
  });
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "batch_ids must be a list of batch UUIDs.");
    return;
  }
  if (body.primary_batch_id && !body.batch_ids.includes(body.primary_batch_id)) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "primary_batch_id must be one of batch_ids.");
    return;
  }

  const centre = await loadCentreInScope(req, String(req.params.id));
  if (!centre) {
    fail(res, 404, "ERR_NOT_FOUND", "Centre not found in your scope.");
    return;
  }
  const userId = String(req.params.userId);
  if (!UUID_RE.test(userId)) {
    fail(res, 404, "ERR_NOT_FOUND", "Shikshak not found.");
    return;
  }
  const target = await userWithRole(userId, "shikshak");
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
        eq(shikshak_centre_assignments.centre_id, centre.id),
        eq(shikshak_centre_assignments.is_active, true),
      ),
    )
    .limit(1);
  if (!tagged) {
    fail(res, 422, "ERR_NOT_CENTRE_TAGGED", "Shikshak must be tagged to this centre first.");
    return;
  }

  // Every requested batch must be a live batch OF THIS CENTRE.
  const centreBatchRows = await db
    .select({ id: batches.id })
    .from(batches)
    .where(and(eq(batches.centre_id, centre.id), isNull(batches.deleted_at)));
  const centreBatchIds = new Set(centreBatchRows.map((b) => b.id));
  for (const id of body.batch_ids) {
    if (!centreBatchIds.has(id)) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "All batch_ids must belong to this centre.");
      return;
    }
  }

  const nextIds = new Set(body.batch_ids);
  const result = await db.transaction(async (tx) => {
    const current = await tx
      .select({
        id: shikshak_batch_assignments.id,
        batch_id: shikshak_batch_assignments.batch_id,
        is_active: shikshak_batch_assignments.is_active,
      })
      .from(shikshak_batch_assignments)
      .where(
        and(
          eq(shikshak_batch_assignments.user_id, target.id),
          inArray(shikshak_batch_assignments.batch_id, [...centreBatchIds]),
        ),
      );
    const byBatch = new Map(current.map((c) => [c.batch_id, c]));

    let removed = 0;
    for (const c of current) {
      if (c.is_active && !nextIds.has(c.batch_id)) {
        await tx
          .update(shikshak_batch_assignments)
          .set({ is_active: false, is_primary: false, deactivated_at: new Date(), updated_at: new Date() })
          .where(eq(shikshak_batch_assignments.id, c.id));
        removed += 1;
      }
    }

    let assigned = 0;
    for (const batchId of nextIds) {
      const makePrimary = batchId === body.primary_batch_id;
      if (makePrimary) {
        // Demote whichever assignment currently holds primary on that batch.
        await tx
          .update(shikshak_batch_assignments)
          .set({ is_primary: false, updated_at: new Date() })
          .where(
            and(
              eq(shikshak_batch_assignments.batch_id, batchId),
              eq(shikshak_batch_assignments.is_active, true),
              eq(shikshak_batch_assignments.is_primary, true),
            ),
          );
      }
      const existing = byBatch.get(batchId);
      if (existing) {
        await tx
          .update(shikshak_batch_assignments)
          .set({
            is_active: true,
            is_primary: makePrimary,
            deactivated_at: null,
            assigned_by: req.authUser!.id,
            updated_at: new Date(),
          })
          .where(eq(shikshak_batch_assignments.id, existing.id));
      } else {
        await tx.insert(shikshak_batch_assignments).values({
          user_id: target.id,
          batch_id: batchId,
          is_primary: makePrimary,
          assigned_by: req.authUser!.id,
        });
      }
      assigned += 1;
    }
    return { assigned, removed };
  });

  await auditFromReq(req, {
    action: "assign",
    entityKind: "shikshak_batch_assignment",
    entityId: target.id,
    summary: `Set ${target.full_name}'s batches at ${centre.name}: ${result.assigned} assigned, ${result.removed} removed.`,
    metadata: {
      user_id: target.id,
      centre_id: centre.id,
      batch_ids: body.batch_ids,
      primary_batch_id: body.primary_batch_id ?? null,
    },
  });
  ok(res, { user_id: target.id, centre_id: centre.id, ...result });
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

const createStaffBodySchema = z.object({
  phone: phoneSchema,
  full_name: z.string().min(1).max(200),
  role: staffRoleSchema,
  gender: genderSchema.optional(),
  city_id: z.string().uuid().optional(),
  state_id: z.string().uuid().optional(),
  centre_id: z.string().uuid().optional(),
});

async function insertStaffUser(opts: {
  phone: string;
  full_name: string;
  role: "sanchalak" | "shikshak";
  gender?: "male" | "female" | "other" | null;
  city_id?: string | null;
  state_id?: string | null;
  centre_id_default?: string | null;
}): Promise<
  | { ok: true; user: { id: string; phone: string; full_name: string; role: string; gender: string | null; display_code: string | null } }
  | { ok: false; code: "ERR_DUPLICATE" | "ERR_VALIDATION_FAILED"; message?: string }
> {
  const [dup] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.phone, opts.phone), isNull(users.deleted_at)))
    .limit(1);
  if (dup) return { ok: false, code: "ERR_DUPLICATE" };

  if (!opts.centre_id_default) {
    return {
      ok: false,
      code: "ERR_VALIDATION_FAILED",
      message: "A Pathshala is required to issue a staff ID.",
    };
  }
  const [centre] = await db
    .select({ code: centres.code })
    .from(centres)
    .where(and(eq(centres.id, opts.centre_id_default), isNull(centres.deleted_at)))
    .limit(1);
  if (!centre?.code) {
    return {
      ok: false,
      code: "ERR_VALIDATION_FAILED",
      message: "Pathshala has no code yet — set the centre code first.",
    };
  }

  const display_code =
    opts.role === "shikshak"
      ? await allocateShikshakCode(db, centre.code)
      : await allocateSanchalakCode(db, centre.code);

  const [row] = await db
    .insert(users)
    .values({
      phone: opts.phone,
      full_name: opts.full_name.trim(),
      role: opts.role,
      display_code,
      gender: opts.gender ?? null,
      city_id: opts.city_id ?? null,
      state_id: opts.state_id ?? null,
      centre_id_default: opts.centre_id_default ?? null,
      is_active: true,
      preferred_language: "en",
    })
    .returning({
      id: users.id,
      phone: users.phone,
      full_name: users.full_name,
      role: users.role,
      gender: users.gender,
      display_code: users.display_code,
    });
  return { ok: true, user: row };
}

async function ensureCentreTag(
  role: "sanchalak" | "shikshak",
  userId: string,
  centreId: string,
  assignedBy: string,
): Promise<string> {
  if (role === "sanchalak") {
    const [existing] = await db
      .select({ id: sanchalak_centre_assignments.id, is_active: sanchalak_centre_assignments.is_active })
      .from(sanchalak_centre_assignments)
      .where(
        and(
          eq(sanchalak_centre_assignments.user_id, userId),
          eq(sanchalak_centre_assignments.centre_id, centreId),
        ),
      )
      .limit(1);
    if (existing?.is_active) return existing.id;
    if (existing) {
      const [row] = await db
        .update(sanchalak_centre_assignments)
        .set({
          is_active: true,
          deactivated_at: null,
          assigned_by: assignedBy,
          updated_at: new Date(),
        })
        .where(eq(sanchalak_centre_assignments.id, existing.id))
        .returning({ id: sanchalak_centre_assignments.id });
      return row.id;
    }
    const [row] = await db
      .insert(sanchalak_centre_assignments)
      .values({ user_id: userId, centre_id: centreId, assigned_by: assignedBy })
      .returning({ id: sanchalak_centre_assignments.id });
    return row.id;
  }

  const [existing] = await db
    .select({ id: shikshak_centre_assignments.id, is_active: shikshak_centre_assignments.is_active })
    .from(shikshak_centre_assignments)
    .where(
      and(
        eq(shikshak_centre_assignments.user_id, userId),
        eq(shikshak_centre_assignments.centre_id, centreId),
      ),
    )
    .limit(1);
  if (existing?.is_active) return existing.id;
  if (existing) {
    const [row] = await db
      .update(shikshak_centre_assignments)
      .set({
        is_active: true,
        deactivated_at: null,
        assigned_by: assignedBy,
        updated_at: new Date(),
      })
      .where(eq(shikshak_centre_assignments.id, existing.id))
      .returning({ id: shikshak_centre_assignments.id });
    return row.id;
  }
  const [row] = await db
    .insert(shikshak_centre_assignments)
    .values({ user_id: userId, centre_id: centreId, assigned_by: assignedBy })
    .returning({ id: shikshak_centre_assignments.id });
  return row.id;
}

async function assignBatchesForCentre(opts: {
  userId: string;
  centreId: string;
  batchIds: string[];
  primaryBatchId: string | null;
  assignedBy: string;
}): Promise<{ batch_id: string; is_primary: boolean }[]> {
  const uniqueBatchIds = [...new Set(opts.batchIds)];
  if (uniqueBatchIds.length === 0) return [];

  const centreBatches = await db
    .select({ id: batches.id })
    .from(batches)
    .where(
      and(
        inArray(batches.id, uniqueBatchIds),
        eq(batches.centre_id, opts.centreId),
        isNull(batches.deleted_at),
      ),
    );
  if (centreBatches.length !== uniqueBatchIds.length) {
    throw new Error("ERR_BATCH_CENTRE_MISMATCH");
  }

  const preferredPrimary =
    opts.primaryBatchId && uniqueBatchIds.includes(opts.primaryBatchId)
      ? opts.primaryBatchId
      : uniqueBatchIds[0]!;

  const results: { batch_id: string; is_primary: boolean }[] = [];

  await db.transaction(async (tx) => {
    for (const batchId of uniqueBatchIds) {
      const [existingPrimary] = await tx
        .select({ id: shikshak_batch_assignments.id })
        .from(shikshak_batch_assignments)
        .where(
          and(
            eq(shikshak_batch_assignments.batch_id, batchId),
            eq(shikshak_batch_assignments.is_active, true),
            eq(shikshak_batch_assignments.is_primary, true),
          ),
        )
        .limit(1);

      const isPrimary = batchId === preferredPrimary || !existingPrimary;

      if (isPrimary && existingPrimary) {
        await tx
          .update(shikshak_batch_assignments)
          .set({ is_primary: false, updated_at: new Date() })
          .where(eq(shikshak_batch_assignments.id, existingPrimary.id));
      }

      const [existing] = await tx
        .select({
          id: shikshak_batch_assignments.id,
          is_active: shikshak_batch_assignments.is_active,
        })
        .from(shikshak_batch_assignments)
        .where(
          and(
            eq(shikshak_batch_assignments.user_id, opts.userId),
            eq(shikshak_batch_assignments.batch_id, batchId),
          ),
        )
        .limit(1);

      if (existing?.is_active) {
        await tx
          .update(shikshak_batch_assignments)
          .set({ is_primary: isPrimary, updated_at: new Date() })
          .where(eq(shikshak_batch_assignments.id, existing.id));
      } else if (existing) {
        await tx
          .update(shikshak_batch_assignments)
          .set({
            is_active: true,
            is_primary: isPrimary,
            deactivated_at: null,
            assigned_by: opts.assignedBy,
            updated_at: new Date(),
          })
          .where(eq(shikshak_batch_assignments.id, existing.id));
      } else {
        await tx.insert(shikshak_batch_assignments).values({
          user_id: opts.userId,
          batch_id: batchId,
          is_primary: isPrimary,
          assigned_by: opts.assignedBy,
        });
      }
      results.push({ batch_id: batchId, is_primary: isPrimary });
    }
  });

  return results;
}

/* POST /v1/admin/users/staff — create a sanchalak or shikshak login */
router.post("/users/staff", async (req: Request, res: Response) => {
  let body: z.infer<typeof createStaffBodySchema>;
  try {
    body = createStaffBodySchema.parse(req.body);
  } catch (err) {
    fail(
      res,
      422,
      "ERR_VALIDATION_FAILED",
      err instanceof z.ZodError ? err.issues[0]?.message ?? "Invalid staff data." : "Invalid staff data.",
    );
    return;
  }

  if (body.role === "sanchalak" && !isCityPlus(req.authUser!.role)) {
    fail(res, 403, "ERR_FORBIDDEN", "Only city admins and above can create sanchalaks.");
    return;
  }
  if (body.role === "shikshak" && !isSanchalakPlus(req.authUser!.role)) {
    fail(res, 403, "ERR_FORBIDDEN", "You cannot create shikshaks.");
    return;
  }

  let cityId = body.city_id ?? req.authUser!.city_id ?? null;
  let stateId = body.state_id ?? req.authUser!.state_id ?? null;
  let centreDefault = body.centre_id ?? null;

  if (body.centre_id) {
    const centre = await loadCentreInScope(req, body.centre_id);
    if (!centre) {
      fail(res, 404, "ERR_NOT_FOUND", "Centre not found in your scope.");
      return;
    }
    const [geo] = await db
      .select({ city_id: centres.city_id, state_id: centres.state_id })
      .from(centres)
      .where(eq(centres.id, centre.id))
      .limit(1);
    cityId = geo?.city_id ?? cityId;
    stateId = geo?.state_id ?? stateId;
    centreDefault = centre.id;
  }

  const created = await insertStaffUser({
    phone: body.phone,
    full_name: body.full_name,
    role: body.role,
    gender: body.gender ?? null,
    city_id: cityId,
    state_id: stateId,
    centre_id_default: centreDefault,
  });
  if (!created.ok) {
    if (created.code === "ERR_VALIDATION_FAILED") {
      fail(res, 422, "ERR_VALIDATION_FAILED", created.message ?? "Could not create staff user.");
      return;
    }
    fail(res, 409, "ERR_DUPLICATE", "A user with this phone already exists.");
    return;
  }

  await auditFromReq(req, {
    action: "create",
    entityKind: "user",
    entityId: created.user.id,
    summary: `Created ${body.role} ${created.user.full_name} (${created.user.display_code ?? created.user.phone}).`,
    metadata: { role: body.role, phone: created.user.phone, display_code: created.user.display_code },
  });
  await syncTeamMemberForUser(created.user.id);
  ok(res, created.user);
});

const centreStaffBodySchema = z
  .object({
    role: staffRoleSchema,
    user_id: z.string().uuid().optional(),
    phone: phoneSchema.optional(),
    full_name: z.string().min(1).max(200).optional(),
    gender: genderSchema.optional(),
    batch_ids: z.array(z.string().uuid()).max(50).optional(),
    primary_batch_id: z.string().uuid().optional(),
  })
  .superRefine((val, ctx) => {
    if (!val.user_id && (!val.phone || !val.full_name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide user_id or phone + full_name to create.",
      });
    }
  });

/**
 * POST /v1/admin/centres/:id/staff — create (optional) + tag to centre +
 * (shikshak) assign batches in one step.
 */
router.post("/centres/:id/staff", async (req: Request, res: Response) => {
  let body: z.infer<typeof centreStaffBodySchema>;
  try {
    body = centreStaffBodySchema.parse(req.body);
  } catch (err) {
    fail(
      res,
      422,
      "ERR_VALIDATION_FAILED",
      err instanceof z.ZodError ? err.issues[0]?.message ?? "Invalid staffing payload." : "Invalid staffing payload.",
    );
    return;
  }

  if (body.role === "sanchalak" && !isCityPlus(req.authUser!.role)) {
    fail(res, 403, "ERR_FORBIDDEN", "Only city admins and above can assign sanchalaks.");
    return;
  }
  if (body.role === "shikshak" && !isSanchalakPlus(req.authUser!.role)) {
    fail(res, 403, "ERR_FORBIDDEN", "You cannot assign shikshaks to centres.");
    return;
  }

  const centre = await loadCentreInScope(req, String(req.params.id));
  if (!centre) {
    fail(res, 404, "ERR_NOT_FOUND", "Centre not found in your scope.");
    return;
  }

  const [geo] = await db
    .select({ city_id: centres.city_id, state_id: centres.state_id })
    .from(centres)
    .where(eq(centres.id, centre.id))
    .limit(1);

  let userId = body.user_id ?? null;
  let created = false;

  if (!userId) {
    const inserted = await insertStaffUser({
      phone: body.phone!,
      full_name: body.full_name!,
      role: body.role,
      gender: body.gender ?? null,
      city_id: geo?.city_id ?? req.authUser!.city_id ?? null,
      state_id: geo?.state_id ?? req.authUser!.state_id ?? null,
      centre_id_default: centre.id,
    });
    if (!inserted.ok) {
      if (inserted.code === "ERR_VALIDATION_FAILED") {
        fail(res, 422, "ERR_VALIDATION_FAILED", inserted.message ?? "Could not create staff user.");
        return;
      }
      fail(res, 409, "ERR_DUPLICATE", "A user with this phone already exists.");
      return;
    }
    userId = inserted.user.id;
    created = true;
  } else {
    const target = await userWithRole(userId, body.role);
    if (!target) {
      fail(res, 422, "ERR_WRONG_ROLE", `User must be an active ${body.role}.`);
      return;
    }
  }

  const assignmentId = await ensureCentreTag(body.role, userId, centre.id, req.authUser!.id);

  let batchResults: { batch_id: string; is_primary: boolean }[] = [];
  if (body.role === "shikshak" && (body.batch_ids?.length ?? 0) > 0) {
    try {
      batchResults = await assignBatchesForCentre({
        userId,
        centreId: centre.id,
        batchIds: body.batch_ids!,
        primaryBatchId: body.primary_batch_id ?? null,
        assignedBy: req.authUser!.id,
      });
    } catch (err) {
      if (err instanceof Error && err.message === "ERR_BATCH_CENTRE_MISMATCH") {
        fail(res, 422, "ERR_VALIDATION_FAILED", "All batches must belong to this centre.");
        return;
      }
      throw err;
    }
  }

  const [userRow] = await db
    .select({
      id: users.id,
      phone: users.phone,
      full_name: users.full_name,
      role: users.role,
      gender: users.gender,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  await auditFromReq(req, {
    action: created ? "create" : "assign",
    entityKind: body.role === "sanchalak" ? "sanchalak_centre_assignment" : "shikshak_centre_assignment",
    entityId: assignmentId,
    summary: `${created ? "Created and tagged" : "Tagged"} ${body.role} ${userRow?.full_name ?? userId} to ${centre.name}.`,
    metadata: {
      user_id: userId,
      centre_id: centre.id,
      created,
      batch_ids: batchResults.map((b) => b.batch_id),
    },
  });

  await syncTeamMemberForUser(userId);

  ok(res, {
    user: userRow,
    created,
    centre_id: centre.id,
    assignment_id: assignmentId,
    batches: batchResults,
  });
});

/* GET /v1/admin/users/pick?role=shikshak|sanchalak&centre_id= — role-filtered picker */
router.get("/users/pick", async (req: Request, res: Response) => {
  if (!isSanchalakPlus(req.authUser!.role)) {
    fail(res, 403, "ERR_FORBIDDEN", "Not allowed.");
    return;
  }
  const roleParse = staffRoleSchema.safeParse(req.query.role);
  if (!roleParse.success) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "role must be shikshak or sanchalak.");
    return;
  }
  if (roleParse.data === "sanchalak" && !isCityPlus(req.authUser!.role)) {
    fail(res, 403, "ERR_FORBIDDEN", "Only city admins and above can list sanchalaks.");
    return;
  }

  const centreIdRaw = typeof req.query.centre_id === "string" ? req.query.centre_id : null;
  let excludeIds: string[] = [];
  if (centreIdRaw) {
    if (!UUID_RE.test(centreIdRaw)) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "centre_id must be a UUID.");
      return;
    }
    const centre = await loadCentreInScope(req, centreIdRaw);
    if (!centre) {
      fail(res, 404, "ERR_NOT_FOUND", "Centre not found in your scope.");
      return;
    }
    if (roleParse.data === "sanchalak") {
      const tagged = await db
        .select({ user_id: sanchalak_centre_assignments.user_id })
        .from(sanchalak_centre_assignments)
        .where(
          and(
            eq(sanchalak_centre_assignments.centre_id, centre.id),
            eq(sanchalak_centre_assignments.is_active, true),
          ),
        );
      excludeIds = tagged.map((t) => t.user_id);
    } else {
      const tagged = await db
        .select({ user_id: shikshak_centre_assignments.user_id })
        .from(shikshak_centre_assignments)
        .where(
          and(
            eq(shikshak_centre_assignments.centre_id, centre.id),
            eq(shikshak_centre_assignments.is_active, true),
          ),
        );
      excludeIds = tagged.map((t) => t.user_id);
    }
  }

  const caller = req.authUser!;
  const geoFilter =
    caller.role === "super_admin"
      ? undefined
      : caller.city_id
        ? or(eq(users.city_id, caller.city_id), isNull(users.city_id))
        : caller.state_id
          ? or(eq(users.state_id, caller.state_id), isNull(users.state_id))
          : undefined;

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
        geoFilter,
        excludeIds.length ? notInArray(users.id, excludeIds) : undefined,
      ),
    )
    .orderBy(asc(users.full_name))
    .limit(200);
  ok(res, { items: rows }, { count: rows.length });
});

export default router;
