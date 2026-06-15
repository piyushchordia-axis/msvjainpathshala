/**
 * /v1/attendance — session + attendance management for shikshak and above.
 *
 * Sessions belong to a batch (which belongs to a centre); every read and
 * mutation is scoped to the caller's admin centre scope. GPS-required sessions
 * enforce a haversine geofence against the centre's configured lat/lng/radius
 * before any attendance row is written.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, sessions, attendance, session_cancellations, batches, centres, students } from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth, requireAdminPanel } from "../../middlewares/auth";
import { resolveAdminScope, type AdminScope } from "../../lib/scope";
import { auditFromReq } from "../../lib/audit";

const router: IRouter = Router();
router.use(requireAuth, requireAdminPanel);

/* ---- local helpers copy-pasted into every admin route file ---- */
function scopedCentreFilter(scope: AdminScope, column: PgColumn) {
  if (scope.centreIds === null) return undefined;
  if (scope.centreIds.length === 0) return sql`false`;
  return inArray(column, scope.centreIds);
}
function inScope(scope: AdminScope, centreId: string | null): boolean {
  if (scope.centreIds === null) return true;
  if (!centreId) return false;
  return scope.centreIds.includes(centreId);
}
function clampLimit(raw: unknown, fallback: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

/* Great-circle distance between two WGS84 points, in metres. */
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // earth radius in metres
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/* GET /v1/attendance/sessions?batch_id=&limit= — scoped list with present/total counts */
router.get("/sessions", async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const limit = clampLimit(req.query.limit, 50, 200);
  const centreFilter = scopedCentreFilter(scope, batches.centre_id);

  const batchIdRaw = req.query.batch_id;
  const batchIdParse = z.string().uuid().safeParse(batchIdRaw);
  const batchFilter = batchIdParse.success ? eq(sessions.batch_id, batchIdParse.data) : undefined;

  const rows = await db
    .select({
      id: sessions.id,
      session_date: sessions.session_date,
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
    .where(and(centreFilter, batchFilter))
    .groupBy(sessions.id, batches.name, centres.name)
    .orderBy(desc(sessions.session_date))
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
  if (!batch || !inScope(scope, batch.centre_id)) {
    fail(res, 403, "ERR_FORBIDDEN", "Batch not in your scope."); return;
  }

  const [row] = await db.insert(sessions).values({
    batch_id: batch.id,
    session_date: body.session_date,
    topic: body.topic ?? null,
    gps_required: body.gps_required ?? false,
    status: "scheduled",
    conducted_by: req.authUser!.id,
  }).returning({ id: sessions.id, batch_id: sessions.batch_id, session_date: sessions.session_date });

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
      session_date: sessions.session_date,
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

const markSchema = z.object({
  records: z
    .array(
      z.object({
        student_id: z.string().uuid(),
        status: z.enum(["present", "absent", "late", "excused"]),
      }),
    )
    .min(1),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

/* POST /v1/attendance/sessions/:id/mark — upsert attendance rows, geofence-checked */
router.post("/sessions/:id/mark", async (req: Request, res: Response) => {
  let body: z.infer<typeof markSchema>;
  try { body = markSchema.parse(req.body); }
  catch { fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid attendance data."); return; }

  const scope = await resolveAdminScope(req.authUser!);
  const id = String(req.params.id);
  const [session] = await db
    .select({
      id: sessions.id,
      batch_id: sessions.batch_id,
      status: sessions.status,
      gps_required: sessions.gps_required,
      centre_id: batches.centre_id,
      centre_lat: centres.lat,
      centre_lng: centres.lng,
      gps_radius_m: centres.gps_radius_m,
    })
    .from(sessions)
    .innerJoin(batches, eq(batches.id, sessions.batch_id))
    .innerJoin(centres, eq(centres.id, batches.centre_id))
    .where(eq(sessions.id, id))
    .limit(1);
  if (!session || !inScope(scope, session.centre_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Session not found."); return;
  }
  // A cancelled session must not be marked (doing so would un-cancel it).
  if (session.status === "cancelled") {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Session is cancelled."); return;
  }

  const hasCoords = body.lat !== undefined && body.lng !== undefined;
  let distance: number | null = null;

  // The method reflects whether a geofence was actually ENFORCED. Only a
  // gps_required session validates client coords against the centre; for a
  // non-geofenced session client coords are untrusted and ignored entirely.
  if (session.gps_required) {
    const cLat = session.centre_lat !== null ? Number(session.centre_lat) : null;
    const cLng = session.centre_lng !== null ? Number(session.centre_lng) : null;
    if (!hasCoords || cLat === null || cLng === null || !Number.isFinite(cLat) || !Number.isFinite(cLng)) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "GPS location is required for this session."); return;
    }
    distance = haversine(cLat, cLng, body.lat!, body.lng!);
    if (distance > session.gps_radius_m) {
      fail(res, 403, "ERR_FORBIDDEN", "Outside centre geofence."); return;
    }
  }

  // Every record's student must belong to this session's batch.
  const studentIds = [...new Set(body.records.map((r) => r.student_id))];
  const validRows = await db
    .select({ id: students.id })
    .from(students)
    .where(and(eq(students.batch_id, session.batch_id), inArray(students.id, studentIds)));
  const validSet = new Set(validRows.map((r) => r.id));
  if (studentIds.some((sid) => !validSet.has(sid))) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "One or more students do not belong to this session's batch."); return;
  }

  // gps only when a geofence was enforced; otherwise manual with no coords stored.
  const method = session.gps_required ? "gps" : "manual";
  const markedLat = session.gps_required ? String(body.lat) : null;
  const markedLng = session.gps_required ? String(body.lng) : null;
  const markedDistance = session.gps_required && distance !== null ? Math.round(distance) : null;
  const now = new Date();

  // Atomic: all attendance upserts AND the status flip succeed or none do.
  await db.transaction(async (tx) => {
    for (const rec of body.records) {
      await tx
        .insert(attendance)
        .values({
          session_id: session.id,
          student_id: rec.student_id,
          status: rec.status,
          marked_by: req.authUser!.id,
          marked_at: now,
          marked_method: method,
          marked_lat: markedLat,
          marked_lng: markedLng,
          marked_distance_m: markedDistance,
        })
        .onConflictDoUpdate({
          target: [attendance.session_id, attendance.student_id],
          set: {
            status: rec.status,
            marked_by: req.authUser!.id,
            marked_at: now,
            marked_method: method,
            marked_lat: markedLat,
            marked_lng: markedLng,
            marked_distance_m: markedDistance,
          },
        });
    }

    // Guaranteed non-cancelled by the guard above, so completing is safe.
    await tx.update(sessions).set({ status: "completed" }).where(eq(sessions.id, session.id));
  });

  await auditFromReq(req, {
    action: "update",
    entityKind: "attendance_session",
    entityId: session.id,
    summary: `Marked attendance for ${body.records.length} student(s) (${method}).`,
    metadata: { batch_id: session.batch_id, marked: body.records.length, method },
  });

  ok(res, { session_id: session.id, marked: body.records.length, method });
});

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
    .select({ id: sessions.id, centre_id: batches.centre_id })
    .from(sessions)
    .innerJoin(batches, eq(batches.id, sessions.batch_id))
    .where(eq(sessions.id, id))
    .limit(1);
  if (!session || !inScope(scope, session.centre_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Session not found."); return;
  }

  await db.insert(session_cancellations).values({
    session_id: session.id,
    reason: body.reason ?? null,
    cancelled_by: req.authUser!.id,
  });
  await db.update(sessions).set({ status: "cancelled" }).where(eq(sessions.id, session.id));

  ok(res, { id: session.id, status: "cancelled" });
});

export default router;
