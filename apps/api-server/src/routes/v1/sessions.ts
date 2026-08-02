/**
 * /v1/sessions/:id/attendance — bulk + single mark (frozen route table).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { ulidSchema, attendanceStatusSchema } from "@workspace/api-zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth, requireAdminPanel } from "../../middlewares/auth";
import { resolveAdminScope, inBatchWriteScope } from "../../lib/scope";
import { db, sessions, batches } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  AttendanceMarkError,
  markAttendance,
  patchAttendanceMark,
} from "../../services/attendance-mark";

const router: IRouter = Router();
router.use(requireAuth, requireAdminPanel);

const markBodySchema = z.object({
  submission_op_id: ulidSchema,
  marked_at: z.string().datetime({ offset: true }).or(z.string().datetime()),
  marks: z
    .array(
      z.object({
        student_id: z.string().uuid(),
        status: attendanceStatusSchema,
        notes: z.string().max(500).optional().nullable(),
        client_op_id: ulidSchema,
      }),
    )
    .min(1),
});

const patchBodySchema = z.object({
  status: attendanceStatusSchema,
  marked_at: z.string().datetime({ offset: true }).or(z.string().datetime()),
  notes: z.string().max(500).optional().nullable(),
  client_op_id: ulidSchema,
  submission_op_id: ulidSchema.optional(),
});

async function assertSessionWriteScope(req: Request, sessionId: string): Promise<boolean> {
  const scope = await resolveAdminScope(req.authUser!);
  const [row] = await db
    .select({ batch_id: sessions.batch_id, centre_id: batches.centre_id })
    .from(sessions)
    .innerJoin(batches, eq(batches.id, sessions.batch_id))
    .where(eq(sessions.id, sessionId))
    .limit(1);
  if (!row) return false;
  return inBatchWriteScope(scope, row.batch_id, row.centre_id);
}

function handleMarkError(res: Response, err: unknown): boolean {
  if (err instanceof AttendanceMarkError) {
    fail(res, err.httpStatus, err.code, err.message);
    return true;
  }
  return false;
}

/* POST /v1/sessions/:id/attendance */
router.post("/:id/attendance", async (req: Request, res: Response) => {
  const sessionId = String(req.params.id);
  let body: z.infer<typeof markBodySchema>;
  try {
    body = markBodySchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid attendance payload.");
    return;
  }

  if (!(await assertSessionWriteScope(req, sessionId))) {
    fail(res, 404, "ERR_NOT_FOUND", "Session not found.");
    return;
  }

  try {
    const result = await markAttendance({
      sessionId,
      userId: req.authUser!.id,
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

  if (!(await assertSessionWriteScope(req, sessionId))) {
    fail(res, 404, "ERR_NOT_FOUND", "Session not found.");
    return;
  }

  try {
    const result = await patchAttendanceMark({
      sessionId,
      studentId,
      userId: req.authUser!.id,
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
