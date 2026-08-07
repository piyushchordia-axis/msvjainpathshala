/**
 * /v1/sessions — frozen attendance route table only (CLAUDE.md).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { ulidSchema, attendanceStatusSchema } from "@workspace/api-zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth, requireAdminPanel } from "../../middlewares/auth";
import { resolveAdminScope } from "../../lib/scope";
import { sessions, batches } from "@workspace/db";
import { eq, sql, inArray, isNull } from "drizzle-orm";
import {
  AttendanceMarkError,
  markAttendance,
  patchAttendanceMark,
} from "../../services/attendance-mark";
import {
  SessionLifecycleError,
  checkInSession,
  checkOutSession,
  cancelSession,
} from "../../services/session-lifecycle";
import { todayIst } from "../../services/session-materialise";
import { loadRostersForSessions } from "../../lib/session-roster";
import { pageSessionsWithAttendanceCounts } from "../../lib/session-page";
import { clampLimit } from "../../lib/route-helpers";

const router: IRouter = Router();
router.use(requireAuth, requireAdminPanel);

const MARKS_MAX = 200;
const MARKS_MAX_MESSAGE =
  "That submission has more than 200 marks. Submit one batch at a time.";

const markItemSchema = z.object({
  student_id: z.string().uuid(),
  status: attendanceStatusSchema,
  notes: z.string().max(500).optional().nullable(),
  client_op_id: ulidSchema,
});

const markBodySchema = z.object({
  submission_op_id: ulidSchema,
  marked_at: z.string().datetime({ offset: true }).or(z.string().datetime()),
  marks: z
    .array(markItemSchema)
    .min(1)
    .max(MARKS_MAX, { message: MARKS_MAX_MESSAGE })
    .superRefine((marks, ctx) => {
      const seen = new Set<string>();
      const dupes = new Set<string>();
      for (const m of marks) {
        if (seen.has(m.student_id)) dupes.add(m.student_id);
        else seen.add(m.student_id);
      }
      if (dupes.size > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate student_id in marks: ${[...dupes].join(", ")}`,
        });
      }
    }),
});

const patchBodySchema = z.object({
  status: attendanceStatusSchema,
  marked_at: z.string().datetime({ offset: true }).or(z.string().datetime()),
  notes: z.string().max(500).optional().nullable(),
  client_op_id: ulidSchema,
  submission_op_id: ulidSchema.optional(),
});

const checkInBodySchema = z.object({
  submission_op_id: ulidSchema,
  // AT32.2 — null when no fix; never invent (0,0).
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
  accuracy_m: z.number().min(0).max(10_000).nullable(),
  batch_id: z.string().uuid().optional(),
});

const checkOutBodySchema = z.object({
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
  accuracy_m: z.number().min(0).max(10_000).nullable().optional(),
});

const cancelBodySchema = z.object({
  reason: z.string().min(10).max(500),
  force_cancel: z.boolean().optional(),
});

function handleMarkError(res: Response, err: unknown): boolean {
  if (err instanceof AttendanceMarkError) {
    fail(res, err.httpStatus, err.code, err.message);
    return true;
  }
  return false;
}

function handleLifecycleError(res: Response, err: unknown): boolean {
  if (err instanceof SessionLifecycleError) {
    fail(res, err.httpStatus, err.code, err.message);
    return true;
  }
  return false;
}

/* GET /v1/sessions/today — today's sessions (IST).
 *
 * Roster policy: include AT4 roster only when the result set is already
 * batch-bounded (shikshak scope) or the caller passes centre_id / batch_id /
 * session_id. City/national callers without a filter get counts only — a
 * full city roster on this list was unbounded N+1 and multi-MB responses.
 * Clients fetch one session via ?session_id= when they need the roster.
 */
router.get("/today", async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const dateRaw =
    typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date
      : null;
  const date = dateRaw ?? todayIst();
  const limit = clampLimit(req.query.limit, 50, 100);
  const onlyId =
    typeof req.query.session_id === "string" && req.query.session_id.length > 0
      ? String(req.query.session_id)
      : null;
  const centreId =
    typeof req.query.centre_id === "string" && req.query.centre_id.length > 0
      ? String(req.query.centre_id)
      : null;
  const batchId =
    typeof req.query.batch_id === "string" && req.query.batch_id.length > 0
      ? String(req.query.batch_id)
      : null;

  if (centreId && scope.centreIds !== null && !scope.centreIds.includes(centreId)) {
    fail(res, 403, "ERR_FORBIDDEN", "Centre not in your scope.");
    return;
  }
  if (batchId && scope.batchIds !== null && !scope.batchIds.includes(batchId)) {
    fail(res, 403, "ERR_FORBIDDEN", "Batch not in your scope.");
    return;
  }

  const filters = [eq(sessions.scheduled_date, date), isNull(batches.deleted_at)];
  if (onlyId) filters.push(eq(sessions.id, onlyId));
  if (batchId) filters.push(eq(sessions.batch_id, batchId));
  if (centreId) filters.push(eq(batches.centre_id, centreId));

  if (scope.batchIds !== null) {
    filters.push(
      scope.batchIds.length === 0 ? sql`false` : inArray(sessions.batch_id, scope.batchIds),
    );
  } else if (scope.centreIds !== null && !centreId) {
    filters.push(
      scope.centreIds.length === 0 ? sql`false` : inArray(batches.centre_id, scope.centreIds),
    );
  }

  const result = await pageSessionsWithAttendanceCounts({
    filters,
    limit,
    windowDays: null,
    forToday: true,
  });

  const includeRoster =
    onlyId !== null ||
    batchId !== null ||
    centreId !== null ||
    scope.batchIds !== null;

  type TodayItem = Omit<
    (typeof result.items)[number],
    "check_in_at" | "check_out_at"
  > & {
    scheduled_date: string;
    check_in_at: string | null;
    check_out_at: string | null;
    conducted_by_name: string | null;
    roster?: Awaited<ReturnType<typeof loadRostersForSessions>> extends Map<string, infer V>
      ? V
      : never;
  };

  function serializeSession(r: (typeof result.items)[number]): Omit<TodayItem, "roster"> {
    const { check_in_at, check_out_at, ...rest } = r;
    return {
      ...rest,
      scheduled_date: r.session_date,
      check_in_at: check_in_at
        ? check_in_at instanceof Date
          ? check_in_at.toISOString()
          : String(check_in_at)
        : null,
      check_out_at: check_out_at
        ? check_out_at instanceof Date
          ? check_out_at.toISOString()
          : String(check_out_at)
        : null,
      conducted_by_name: r.conducted_by_name ?? null,
    };
  }

  let items: TodayItem[];
  if (includeRoster && result.items.length > 0) {
    const rosters = await loadRostersForSessions(
      result.items.map((r) => ({
        session_id: r.id,
        session_date: r.session_date,
        batch_id: r.batch_id,
      })),
    );
    items = result.items.map((r) => ({
      ...serializeSession(r),
      roster: rosters.get(r.id) ?? [],
    }));
  } else {
    items = result.items.map((r) => serializeSession(r));
  }

  ok(
    res,
    { items, date },
    {
      count: items.length,
      has_more: result.hasMore,
      next_cursor: result.nextCursor,
      roster_included: includeRoster,
    },
  );
});

/* POST /v1/sessions/:id/check-in */
router.post("/:id/check-in", async (req: Request, res: Response) => {
  const sessionId = String(req.params.id);
  let body: z.infer<typeof checkInBodySchema>;
  try {
    body = checkInBodySchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid check-in payload.");
    return;
  }

  try {
    const row = await checkInSession({
      sessionId,
      actor: req.authUser!,
      submissionOpId: body.submission_op_id,
      lat: body.lat,
      lng: body.lng,
      accuracy_m: body.accuracy_m,
      batchId: body.batch_id,
    });
    ok(res, row);
  } catch (err) {
    if (handleLifecycleError(res, err)) return;
    throw err;
  }
});

/* POST /v1/sessions/:id/check-out */
router.post("/:id/check-out", async (req: Request, res: Response) => {
  const sessionId = String(req.params.id);
  let body: z.infer<typeof checkOutBodySchema>;
  try {
    body = checkOutBodySchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid check-out payload.");
    return;
  }

  try {
    const row = await checkOutSession({
      sessionId,
      actor: req.authUser!,
      lat: body.lat,
      lng: body.lng,
      accuracy_m: body.accuracy_m,
    });
    ok(res, row);
  } catch (err) {
    if (handleLifecycleError(res, err)) return;
    throw err;
  }
});

/* POST /v1/sessions/:id/cancel */
router.post("/:id/cancel", async (req: Request, res: Response) => {
  const sessionId = String(req.params.id);
  let body: z.infer<typeof cancelBodySchema>;
  try {
    body = cancelBodySchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid cancel payload (reason min 10 chars).");
    return;
  }

  try {
    const row = await cancelSession({
      sessionId,
      actor: req.authUser!,
      reason: body.reason,
      forceCancel: body.force_cancel === true,
    });
    ok(res, row);
  } catch (err) {
    if (handleLifecycleError(res, err)) return;
    throw err;
  }
});

/* POST /v1/sessions/:id/attendance — scope enforced in service (Q2/MSV pattern) */
router.post("/:id/attendance", async (req: Request, res: Response) => {
  const sessionId = String(req.params.id);
  let body: z.infer<typeof markBodySchema>;
  try {
    body = markBodySchema.parse(req.body);
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? (err.issues[0]?.message ?? "Invalid attendance payload.")
        : "Invalid attendance payload.";
    fail(res, 422, "ERR_VALIDATION_FAILED", message);
    return;
  }

  try {
    const result = await markAttendance({
      sessionId,
      userId: req.authUser!.id,
      actor: req.authUser!,
      markedAt: new Date(body.marked_at),
      submissionOpId: body.submission_op_id,
      marks: body.marks.map((m) => ({
        student_id: m.student_id,
        status: m.status,
        notes: m.notes ?? null,
        client_op_id: m.client_op_id,
      })),
    });
    ok(res, result);
  } catch (err) {
    if (handleMarkError(res, err)) return;
    throw err;
  }
});

/* PATCH /v1/sessions/:id/attendance/:student_id */
router.patch("/:id/attendance/:student_id", async (req: Request, res: Response) => {
  const sessionId = String(req.params.id);
  const studentId = String(req.params.student_id);
  let body: z.infer<typeof patchBodySchema>;
  try {
    body = patchBodySchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid attendance patch.");
    return;
  }

  try {
    const result = await patchAttendanceMark({
      sessionId,
      studentId,
      userId: req.authUser!.id,
      actor: req.authUser!,
      markedAt: new Date(body.marked_at),
      status: body.status,
      notes: body.notes ?? null,
      client_op_id: body.client_op_id,
      submissionOpId: body.submission_op_id,
    });
    ok(res, result);
  } catch (err) {
    if (handleMarkError(res, err)) return;
    throw err;
  }
});

export default router;
