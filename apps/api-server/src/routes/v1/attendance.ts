/**
 * /v1/attendance — session + attendance management for shikshak and above.
 *
 * Sessions belong to a batch (which belongs to a centre); every read and
 * mutation is scoped to the caller's admin centre scope. GPS-required sessions
 * enforce a haversine geofence against the centre's configured lat/lng/radius
 * before any attendance row is written.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, sessions, attendance, batches, centres, students } from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth, requireAdminPanel } from "../../middlewares/auth";
import { resolveAdminScope, inBatchWriteScope, type AdminScope } from "../../lib/scope";
import { auditFromReq } from "../../lib/audit";
import { clampLimit, inScope, scopedCentreFilter } from "../../lib/route-helpers";

const router: IRouter = Router();
router.use(requireAuth, requireAdminPanel);

function scopedBatchFilter(scope: AdminScope, column: PgColumn) {
  if (scope.batchIds === null) return undefined;
  if (scope.batchIds.length === 0) return sql`false`;
  return inArray(column, scope.batchIds);
}

/* GET /v1/attendance/sessions?batch_id=&limit= — scoped list with present/total counts */
router.get("/sessions", async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const limit = clampLimit(req.query.limit, 50, 200);
  const centreFilter = scopedCentreFilter(scope, batches.centre_id);
  const batchScopeFilter = scopedBatchFilter(scope, sessions.batch_id);

  const batchIdRaw = req.query.batch_id;
  const batchIdParse = z.string().uuid().safeParse(batchIdRaw);
  const batchFilter = batchIdParse.success ? eq(sessions.batch_id, batchIdParse.data) : undefined;

  const rows = await db
    .select({
      id: sessions.id,
      session_date: sessions.scheduled_date,
      status: sessions.status,
      topic: sessions.topic,
      gps_required: sessions.gps_required,
      batch_id: sessions.batch_id,
      batch_name: batches.name,
      centre_name: centres.name,
      present_count: sql<number>`count(${attendance.id}) filter (where ${attendance.status} in ('present','late'))::int`,
      total_count: sql<number>`count(${attendance.id})::int`,
    })
    .from(sessions)
    .innerJoin(batches, eq(batches.id, sessions.batch_id))
    .innerJoin(centres, eq(centres.id, batches.centre_id))
    .leftJoin(attendance, eq(attendance.session_id, sessions.id))
    .where(and(centreFilter, batchScopeFilter, batchFilter))
    .groupBy(sessions.id, batches.name, centres.name)
    .orderBy(desc(sessions.scheduled_date))
    .limit(limit);
  ok(res, { items: rows }, { count: rows.length });
});

const createSessionSchema = z.object({
  batch_id: z.string().uuid(),
  session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  topic: z.string().max(200).optional(),
  gps_required: z.boolean().optional(),
});

/* POST /v1/attendance/sessions */
router.post("/sessions", async (req: Request, res: Response) => {
  let body: z.infer<typeof createSessionSchema>;
  try { body = createSessionSchema.parse(req.body); }
  catch { fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid session data."); return; }

  const scope = await resolveAdminScope(req.authUser!);
  const [batch] = await db
    .select({ id: batches.id, centre_id: batches.centre_id })
    .from(batches)
    .where(eq(batches.id, body.batch_id))
    .limit(1);
  if (!batch || !inBatchWriteScope(scope, batch.id, batch.centre_id)) {
    fail(res, 403, "ERR_FORBIDDEN", "Batch not in your scope."); return;
  }

  const [row] = await db.insert(sessions).values({
    batch_id: batch.id,
    scheduled_date: body.session_date,
    topic: body.topic ?? null,
    gps_required: body.gps_required ?? false,
    status: "scheduled",
    conducted_by: req.authUser!.id,
  }).returning({
    id: sessions.id,
    batch_id: sessions.batch_id,
    session_date: sessions.scheduled_date,
  });

  await auditFromReq(req, {
    action: "create",
    entityKind: "attendance_session",
    entityId: row.id,
    summary: `Created session for ${body.session_date}.`,
    metadata: { batch_id: batch.id, session_date: body.session_date, gps_required: body.gps_required ?? false },
  });

  ok(res, row);
});

/* GET /v1/attendance/sessions/:id — session detail + roster (active students of the batch) */
router.get("/sessions/:id", async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const id = String(req.params.id);
  const [session] = await db
    .select({
      id: sessions.id,
      batch_id: sessions.batch_id,
      session_date: sessions.scheduled_date,
      status: sessions.status,
      topic: sessions.topic,
      gps_required: sessions.gps_required,
      centre_id: batches.centre_id,
      batch_name: batches.name,
      centre_name: centres.name,
      centre_lat: centres.lat,
      centre_lng: centres.lng,
    })
    .from(sessions)
    .innerJoin(batches, eq(batches.id, sessions.batch_id))
    .innerJoin(centres, eq(centres.id, batches.centre_id))
    .where(eq(sessions.id, id))
    .limit(1);
  if (!session || !inScope(scope, session.centre_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Session not found."); return;
  }

  const roster = await db
    .select({
      student_id: students.id,
      full_name: students.full_name,
      student_code: students.student_code,
      status: attendance.status,
      marked_method: attendance.marked_method,
    })
    .from(students)
    .leftJoin(
      attendance,
      and(eq(attendance.student_id, students.id), eq(attendance.session_id, session.id)),
    )
    .where(and(eq(students.batch_id, session.batch_id), eq(students.status, "active")))
    .orderBy(students.full_name);

  ok(res, {
    session: {
      id: session.id,
      batch_id: session.batch_id,
      session_date: session.session_date,
      status: session.status,
      topic: session.topic,
      gps_required: session.gps_required,
      batch_name: session.batch_name,
      centre_name: session.centre_name,
      has_gps: session.centre_lat !== null && session.centre_lng !== null,
    },
    roster,
  });
});

/* Legacy POST /v1/attendance/sessions/:id/mark removed — use POST /v1/sessions/:id/attendance. */

const cancelSchema = z.object({
  reason: z.string().max(300).optional(),
});

/* POST /v1/attendance/sessions/:id/cancel */
router.post("/sessions/:id/cancel", async (req: Request, res: Response) => {
  let body: z.infer<typeof cancelSchema>;
  try { body = cancelSchema.parse(req.body); }
  catch { fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid cancellation data."); return; }

  const scope = await resolveAdminScope(req.authUser!);
  const id = String(req.params.id);
  const [session] = await db
    .select({ id: sessions.id, batch_id: sessions.batch_id, centre_id: batches.centre_id })
    .from(sessions)
    .innerJoin(batches, eq(batches.id, sessions.batch_id))
    .where(eq(sessions.id, id))
    .limit(1);
  if (!session || !inBatchWriteScope(scope, session.batch_id, session.centre_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Session not found."); return;
  }

  await db
    .update(sessions)
    .set({
      status: "cancelled",
      cancelled_at: new Date(),
      cancellation_reason: body.reason ?? null,
      cancellation_by: req.authUser!.id,
    })
    .where(eq(sessions.id, session.id));

  ok(res, { id: session.id, status: "cancelled" });
});

export default router;
