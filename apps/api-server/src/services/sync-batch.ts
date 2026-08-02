/**
 * POST /v1/sync/batch — single offline transport.
 * Each op_type handler calls the SAME service method as the online endpoint.
 */
import { db, sessions, notice_reads, type User } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ulidSchema, attendanceStatusSchema } from "@workspace/api-zod";
import {
  findSuccessfulSync,
  writeSyncOperation,
  type SyncResult,
} from "../lib/sync-operations";
import {
  checkInSession,
  checkOutSession,
  SessionLifecycleError,
} from "./session-lifecycle";
import {
  markAttendance,
  AttendanceMarkError,
} from "./attendance-mark";
import { ulid } from "../lib/ulid";

const OP_TYPES = [
  "checkin",
  "attendance",
  "checkout",
  "shivir_scan",
  "niyam_submission",
  "homework_submission",
  "acknowledgement",
] as const;

export type SyncOpType = (typeof OP_TYPES)[number];

/** Accept CLAUDE names + common aliases from the prompt. */
function normalizeOpType(raw: string): SyncOpType | null {
  const map: Record<string, SyncOpType> = {
    checkin: "checkin",
    attendance: "attendance",
    "attendance.mark": "attendance",
    checkout: "checkout",
    shivir_scan: "shivir_scan",
    "shivir.scan": "shivir_scan",
    niyam_submission: "niyam_submission",
    "niyam.submit": "niyam_submission",
    homework_submission: "homework_submission",
    "homework.submit": "homework_submission",
    acknowledgement: "acknowledgement",
    "notice.acknowledge": "acknowledgement",
  };
  return map[raw] ?? null;
}

const opSchema = z.object({
  submission_op_id: ulidSchema,
  op_type: z.string().min(1),
  payload: z.unknown(),
  client_timestamp: z.string().min(1),
});

export const syncBatchBodySchema = z.object({
  ops: z.array(opSchema).min(1).max(200),
});

export type SyncBatchBody = z.infer<typeof syncBatchBodySchema>;

async function resolveSessionId(batchId: string, sessionDate: string): Promise<string | null> {
  const [row] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.batch_id, batchId), eq(sessions.scheduled_date, sessionDate)))
    .limit(1);
  return row?.id ?? null;
}

function lifecycleToResult(submissionOpId: string, err: SessionLifecycleError): SyncResult {
  const status =
    err.httpStatus === 409
      ? ("conflict" as const)
      : err.httpStatus >= 400 && err.httpStatus < 500
        ? ("failed" as const)
        : ("failed" as const);
  return {
    submission_op_id: submissionOpId,
    status,
    error: { code: err.code, message: err.message },
  };
}

function markToResult(submissionOpId: string, err: AttendanceMarkError): SyncResult {
  const status = err.httpStatus === 409 ? ("conflict" as const) : ("failed" as const);
  return {
    submission_op_id: submissionOpId,
    status,
    error: { code: err.code, message: err.message },
  };
}

async function handleCheckin(actor: User, submissionOpId: string, payload: unknown): Promise<SyncResult> {
  const p = z
    .object({
      batch_id: z.string().uuid(),
      session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      lat: z.number(),
      lng: z.number(),
      accuracy_m: z.number(),
    })
    .parse(payload);

  const existingId = await resolveSessionId(p.batch_id, p.session_date);
  // Prefer real id when materialised; otherwise soft-create via missing id + batch_id (AT8).
  const sessionId = existingId ?? "00000000-0000-4000-8000-000000000000";

  try {
    const row = await checkInSession({
      sessionId,
      actor,
      submissionOpId,
      lat: p.lat,
      lng: p.lng,
      accuracy_m: p.accuracy_m,
      batchId: p.batch_id,
      scheduledDate: p.session_date,
    });
    return {
      submission_op_id: submissionOpId,
      status: "success",
      server_id: row.id,
      data: row,
    };
  } catch (err) {
    if (err instanceof SessionLifecycleError) return lifecycleToResult(submissionOpId, err);
    throw err;
  }
}

async function handleAttendance(
  actor: User,
  submissionOpId: string,
  payload: unknown,
): Promise<SyncResult> {
  const p = z
    .object({
      batch_id: z.string().uuid(),
      session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      marked_at: z.string().min(1),
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
    })
    .parse(payload);

  let sessionId = await resolveSessionId(p.batch_id, p.session_date);
  if (!sessionId) {
    // AT8 — no materialised row: soft-create via check-in so marks are not lost.
    const created = await checkInSession({
      sessionId: "00000000-0000-4000-8000-000000000000",
      actor,
      submissionOpId: ulid(), // distinct from this attendance submission_op_id
      lat: 0,
      lng: 0,
      accuracy_m: 9999,
      batchId: p.batch_id,
      scheduledDate: p.session_date,
    });
    sessionId = created.id;
  }

  try {
    const response = await markAttendance({
      sessionId,
      userId: actor.id,
      actor,
      markedAt: new Date(p.marked_at),
      // Sync layer owns sync_operations write + replay — do not double-handle here.
      recordSync: false,
      marks: p.marks.map((m) => ({
        student_id: m.student_id,
        status: m.status,
        notes: m.notes ?? null,
        client_op_id: m.client_op_id,
      })),
    });

    // Domain-level all-duplicate → sync status duplicate (newest-marked_at-wins).
    const status =
      response.applied === 0 && response.duplicate > 0 && response.rejected === 0
        ? ("duplicate" as const)
        : ("success" as const);

    return {
      submission_op_id: submissionOpId,
      status,
      server_id: response.session_id,
      data: response,
    };
  } catch (err) {
    if (err instanceof AttendanceMarkError) return markToResult(submissionOpId, err);
    if (err instanceof SessionLifecycleError) return lifecycleToResult(submissionOpId, err);
    throw err;
  }
}

async function handleCheckout(
  actor: User,
  submissionOpId: string,
  payload: unknown,
): Promise<SyncResult> {
  const p = z
    .object({
      batch_id: z.string().uuid(),
      session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      lat: z.number(),
      lng: z.number(),
      accuracy_m: z.number().optional(),
    })
    .parse(payload);

  const sessionId = await resolveSessionId(p.batch_id, p.session_date);
  if (!sessionId) {
    return {
      submission_op_id: submissionOpId,
      status: "failed",
      error: {
        code: "ERR_NOT_FOUND",
        message: "No session found for that batch and date. Check in first.",
      },
    };
  }

  try {
    const row = await checkOutSession({
      sessionId,
      actor,
      lat: p.lat,
      lng: p.lng,
      accuracy_m: p.accuracy_m,
    });
    return {
      submission_op_id: submissionOpId,
      status: "success",
      server_id: row.id,
      data: row,
    };
  } catch (err) {
    if (err instanceof SessionLifecycleError) return lifecycleToResult(submissionOpId, err);
    throw err;
  }
}

async function handleShivirScan(
  actor: User,
  submissionOpId: string,
  payload: unknown,
): Promise<SyncResult> {
  // Delegate to the same scan path via dynamic import of route helpers would be
  // heavy; call the scanner service surface by replaying through HTTP-shaped logic.
  const p = z
    .object({
      shivir_session_id: z.string().uuid(),
      qr_payload: z.string().min(1),
      qr_signature: z.string().optional(),
      scan_kind: z.enum(["present", "check_in", "check_out"]).optional(),
      scanned_at: z.string().optional(),
    })
    .parse(payload);

  // Minimal: store as acknowledged deferred if signature missing — require signature.
  if (!p.qr_signature) {
    return {
      submission_op_id: submissionOpId,
      status: "failed",
      error: {
        code: "ERR_VALIDATION_FAILED",
        message: "qr_signature is required for shivir scans.",
      },
    };
  }

  const { applyShivirScan, ShivirScanError } = await import("./shivir-scan");
  try {
    const data = await applyShivirScan({
      sessionId: p.shivir_session_id,
      actor,
      qr_payload: p.qr_payload,
      qr_signature: p.qr_signature,
      scan_kind: p.scan_kind,
    });
    return {
      submission_op_id: submissionOpId,
      status: data.duplicate ? "duplicate" : "success",
      server_id: data.scan_id ?? p.shivir_session_id,
      data,
    };
  } catch (err) {
    if (err instanceof ShivirScanError) {
      return {
        submission_op_id: submissionOpId,
        status: err.httpStatus === 409 ? "conflict" : "failed",
        error: { code: err.code, message: err.message },
      };
    }
    throw err;
  }
}

async function handleNiyamSubmission(
  actor: User,
  submissionOpId: string,
  payload: unknown,
): Promise<SyncResult> {
  const p = z
    .object({
      niyam_id: z.string().uuid(),
      student_id: z.string().uuid(),
      proof_asset_id: z.string().optional(),
      notes: z.string().optional(),
    })
    .parse(payload);

  const { applyNiyamSubmission, NiyamSubmitError } = await import("./niyam-submit-sync");
  try {
    const data = await applyNiyamSubmission({
      actor,
      niyamId: p.niyam_id,
      studentId: p.student_id,
      proofAssetId: p.proof_asset_id,
      notes: p.notes,
    });
    return {
      submission_op_id: submissionOpId,
      status: "success",
      server_id: data.id,
      data,
    };
  } catch (err) {
    if (err instanceof NiyamSubmitError) {
      return {
        submission_op_id: submissionOpId,
        status: err.httpStatus === 409 ? "conflict" : "failed",
        error: { code: err.code, message: err.message },
      };
    }
    throw err;
  }
}

async function handleHomeworkSubmission(
  actor: User,
  submissionOpId: string,
  payload: unknown,
): Promise<SyncResult> {
  const p = z
    .object({
      assignment_id: z.string().uuid().optional(),
      submission_id: z.string().uuid().optional(),
      student_id: z.string().uuid().optional(),
      payload: z.record(z.unknown()).optional(),
      file_url: z.string().optional(),
      notes: z.string().optional(),
    })
    .parse(payload);

  const submissionId = p.submission_id;
  if (!submissionId) {
    return {
      submission_op_id: submissionOpId,
      status: "failed",
      error: {
        code: "ERR_VALIDATION_FAILED",
        message: "submission_id is required for homework_submission ops.",
      },
    };
  }

  const { applyHomeworkSubmit, HomeworkSubmitError } = await import("./homework-submit-sync");
  try {
    const data = await applyHomeworkSubmit({
      actor,
      submissionId,
      fileUrl: p.file_url,
      notes: p.notes,
    });
    return {
      submission_op_id: submissionOpId,
      status: "success",
      server_id: data.id,
      data,
    };
  } catch (err) {
    if (err instanceof HomeworkSubmitError) {
      return {
        submission_op_id: submissionOpId,
        status: err.httpStatus === 409 ? "conflict" : "failed",
        error: { code: err.code, message: err.message },
      };
    }
    throw err;
  }
}

async function handleAcknowledgement(
  actor: User,
  submissionOpId: string,
  payload: unknown,
): Promise<SyncResult> {
  const p = z
    .object({
      kind: z.string().min(1),
      entity_id: z.string().uuid(),
    })
    .parse(payload);

  if (p.kind === "notice" || p.kind === "notice.read") {
    await db
      .insert(notice_reads)
      .values({ notice_id: p.entity_id, user_id: actor.id })
      .onConflictDoNothing();
    return {
      submission_op_id: submissionOpId,
      status: "success",
      server_id: p.entity_id,
      data: { kind: p.kind, entity_id: p.entity_id },
    };
  }

  return {
    submission_op_id: submissionOpId,
    status: "failed",
    error: {
      code: "ERR_VALIDATION_FAILED",
      message: `Unsupported acknowledgement kind: ${p.kind}`,
    },
  };
}

async function executeOp(
  actor: User,
  opType: SyncOpType,
  submissionOpId: string,
  payload: unknown,
): Promise<SyncResult> {
  switch (opType) {
    case "checkin":
      return handleCheckin(actor, submissionOpId, payload);
    case "attendance":
      return handleAttendance(actor, submissionOpId, payload);
    case "checkout":
      return handleCheckout(actor, submissionOpId, payload);
    case "shivir_scan":
      return handleShivirScan(actor, submissionOpId, payload);
    case "niyam_submission":
      return handleNiyamSubmission(actor, submissionOpId, payload);
    case "homework_submission":
      return handleHomeworkSubmission(actor, submissionOpId, payload);
    case "acknowledgement":
      return handleAcknowledgement(actor, submissionOpId, payload);
    default:
      return {
        submission_op_id: submissionOpId,
        status: "failed",
        error: { code: "ERR_VALIDATION_FAILED", message: `Unknown op_type.` },
      };
  }
}

/**
 * Process one sync batch. Per-op failures never abort siblings.
 * Always writes sync_operations for each op.
 */
export async function processSyncBatch(
  actor: User,
  body: SyncBatchBody,
): Promise<{ results: SyncResult[] }> {
  const results: SyncResult[] = [];

  for (const op of body.ops) {
    const opType = normalizeOpType(op.op_type);
    if (!opType) {
      const failed: SyncResult = {
        submission_op_id: op.submission_op_id,
        status: "failed",
        error: {
          code: "ERR_VALIDATION_FAILED",
          message: `Unknown op_type: ${op.op_type}`,
        },
      };
      await writeSyncOperation({
        userId: actor.id,
        submissionOpId: op.submission_op_id,
        opKind: op.op_type,
        requestPayload: op.payload,
        result: failed,
      });
      results.push(failed);
      continue;
    }

    // Replay: success row → return stored payload, do not re-execute.
    const replay = await findSuccessfulSync(actor.id, op.submission_op_id);
    if (replay) {
      results.push({
        ...replay,
        submission_op_id: op.submission_op_id,
        status: "success",
      });
      continue;
    }

    let result: SyncResult;
    try {
      result = await executeOp(actor, opType, op.submission_op_id, op.payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected sync error.";
      result = {
        submission_op_id: op.submission_op_id,
        status: "failed",
        error: { code: "ERR_INTERNAL", message },
      };
    }

    // CRITICAL — write on every execution (not read-only).
    await writeSyncOperation({
      userId: actor.id,
      submissionOpId: op.submission_op_id,
      opKind: opType,
      requestPayload: {
        payload: op.payload,
        client_timestamp: op.client_timestamp,
      },
      result,
    });

    results.push(result);
  }

  return { results };
}
