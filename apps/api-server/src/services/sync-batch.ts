/**
 * POST /v1/sync/batch — single offline transport.
 * Each op_type handler calls the SAME service method as the online endpoint.
 */
import { db, sessions, notice_reads, homework_submissions, type User } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ulidSchema, attendanceStatusSchema, homeworkSyncPayloadSchema } from "@workspace/api-zod";
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
  "course_progress",
  "course_certification",
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
    course_progress: "course_progress",
    "course.progress": "course_progress",
    course_certification: "course_certification",
    "course.certification": "course_certification",
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
      // AT32.2 — null when no fix; never invent (0,0) / 9999 sentinels.
      lat: z.number().nullable(),
      lng: z.number().nullable(),
      accuracy_m: z.number().nullable(),
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
  const MARKS_MAX = 200;
  const MARKS_MAX_MESSAGE =
    "That submission has more than 200 marks. Submit one batch at a time.";

  let p: {
    batch_id: string;
    session_date: string;
    marked_at: string;
    marks: Array<{
      student_id: string;
      status: z.infer<typeof attendanceStatusSchema>;
      notes?: string | null;
      client_op_id: string;
    }>;
  };
  try {
    p = z
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
          .min(1)
          .max(MARKS_MAX, { message: MARKS_MAX_MESSAGE }),
      })
      .parse(payload);
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? (err.issues[0]?.message ?? "Invalid attendance payload.")
        : "Invalid attendance payload.";
    return {
      submission_op_id: submissionOpId,
      status: "failed",
      error: { code: "ERR_VALIDATION_FAILED", message },
    };
  }

  let sessionId = await resolveSessionId(p.batch_id, p.session_date);
  if (!sessionId) {
    // AT8 — no materialised row: soft-create via check-in so marks are not lost.
    // AT32.2 — no GPS was captured on the attendance path; pass nulls, never (0,0).
    const created = await checkInSession({
      sessionId: "00000000-0000-4000-8000-000000000000",
      actor,
      submissionOpId: ulid(), // distinct from this attendance submission_op_id
      lat: null,
      lng: null,
      accuracy_m: null,
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
      lat: z.number().nullable(),
      lng: z.number().nullable(),
      accuracy_m: z.number().nullable().optional(),
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
      accuracy_m: p.accuracy_m ?? null,
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
  clientTimestamp?: string,
): Promise<SyncResult> {
  const p = homeworkSyncPayloadSchema.parse(payload);

  let submissionId = p.submission_id;
  if (!submissionId && p.assignment_id && p.student_id) {
    const [row] = await db
      .select({ id: homework_submissions.id })
      .from(homework_submissions)
      .where(
        and(
          eq(homework_submissions.assignment_id, p.assignment_id),
          eq(homework_submissions.student_id, p.student_id),
        ),
      )
      .limit(1);
    if (!row) {
      return {
        submission_op_id: submissionOpId,
        status: "failed",
        error: {
          code: "ERR_NOT_FOUND",
          message: "No homework submission found for that assignment and student.",
        },
      };
    }
    submissionId = row.id;
  }

  if (!submissionId) {
    return {
      submission_op_id: submissionOpId,
      status: "failed",
      error: {
        code: "ERR_VALIDATION_FAILED",
        message:
          "Provide submission_id, or both assignment_id and student_id, for homework_submission ops.",
      },
    };
  }

  const fileUrl = p.proof_asset_id ?? p.file_url;
  const { applyHomeworkSubmit, HomeworkSubmitError } = await import("./homework-submit-sync");
  try {
    const data = await applyHomeworkSubmit({
      actor,
      submissionId,
      fileUrl,
      clientTimestamp,
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

async function handleCourseProgress(
  actor: User,
  submissionOpId: string,
  payload: unknown,
): Promise<SyncResult> {
  const { upsertCourseProgress, COURSE_PROGRESS_STATUSES, CourseProgressError } = await import(
    "./course-progress"
  );
  const { assertCourseProgressWriteAccess } = await import("./course-access");

  let p: {
    node_kind: "section" | "subsection";
    node_id: string;
    marks: Array<{
      student_id: string;
      status: (typeof COURSE_PROGRESS_STATUSES)[number];
      note?: string;
      client_op_id: string;
    }>;
    marked_at: string;
  };
  try {
    p = z
      .object({
        node_kind: z.enum(["section", "subsection"]),
        node_id: z.string().uuid(),
        marks: z
          .array(
            z.object({
              student_id: z.string().uuid(),
              status: z.enum(COURSE_PROGRESS_STATUSES),
              note: z.string().max(1000).optional(),
              client_op_id: ulidSchema,
            }),
          )
          .min(1)
          .max(200),
        marked_at: z.string().min(1),
      })
      .parse(payload);
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? (err.issues[0]?.message ?? "Invalid course_progress payload.")
        : "Invalid course_progress payload.";
    return {
      submission_op_id: submissionOpId,
      status: "failed",
      error: { code: "ERR_VALIDATION_FAILED", message },
    };
  }

  const markedAt = new Date(p.marked_at);
  const results: Array<{ student_id: string; applied: boolean; id?: string }> = [];
  let anyApplied = false;

  try {
    for (const mark of p.marks) {
      const access = await assertCourseProgressWriteAccess(actor, mark.student_id);
      if (!access.ok) {
        return {
          submission_op_id: submissionOpId,
          status: "conflict",
          error: { code: access.code, message: access.message },
        };
      }
      const row = await upsertCourseProgress({
        studentId: mark.student_id,
        nodeKind: p.node_kind,
        nodeId: p.node_id,
        status: mark.status,
        note: mark.note ?? null,
        updatedBy: actor.id,
        updatedByRole: actor.role,
        clientOpId: mark.client_op_id,
        clientMarkedAt: markedAt,
      });
      if (row.applied) anyApplied = true;
      results.push({ student_id: mark.student_id, applied: row.applied, id: row.id });
    }
  } catch (err) {
    if (err instanceof CourseProgressError) {
      return {
        submission_op_id: submissionOpId,
        status: err.httpStatus === 409 || err.httpStatus === 403 ? "conflict" : "failed",
        error: { code: err.code, message: err.message },
      };
    }
    throw err;
  }

  return {
    submission_op_id: submissionOpId,
    status: anyApplied ? "success" : "duplicate",
    server_id: results[0]?.id,
    data: { marks: results },
  };
}

async function handleCourseCertification(
  actor: User,
  submissionOpId: string,
  payload: unknown,
): Promise<SyncResult> {
  const { certifyCourseNode, CourseCertifyError } = await import("./course-certify");
  const { assertCourseCertifyAccess } = await import("./course-access");
  const { enqueueCertificatePdf } = await import("./course-certificates");

  let p: {
    node_kind: "section" | "subsection";
    node_id: string;
    student_id: string;
    certification_note?: string;
    client_op_id: string;
    certified_at: string;
  };
  try {
    p = z
      .object({
        node_kind: z.enum(["section", "subsection"]),
        node_id: z.string().uuid(),
        student_id: z.string().uuid(),
        certification_note: z.string().max(1000).optional(),
        client_op_id: ulidSchema,
        certified_at: z.string().min(1),
      })
      .parse(payload);
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? (err.issues[0]?.message ?? "Invalid course_certification payload.")
        : "Invalid course_certification payload.";
    return {
      submission_op_id: submissionOpId,
      status: "failed",
      error: { code: "ERR_VALIDATION_FAILED", message },
    };
  }

  const access = await assertCourseCertifyAccess(actor, p.student_id);
  if (!access.ok) {
    return {
      submission_op_id: submissionOpId,
      status: "conflict",
      error: { code: access.code, message: access.message },
    };
  }

  try {
    // CU17 soft-transition — never 409 ERR_COURSE_NODE_NOT_COMPLETE offline.
    const result = await certifyCourseNode({
      nodeKind: p.node_kind,
      nodeId: p.node_id,
      studentId: p.student_id,
      actorId: actor.id,
      actorRole: actor.role,
      note: p.certification_note ?? null,
      softTransition: true,
      clientOpId: p.client_op_id,
      certifiedAt: new Date(p.certified_at),
    });
    if (result.applied) {
      for (const certId of result.certificate_ids) {
        await enqueueCertificatePdf(certId);
      }
    }
    return {
      submission_op_id: submissionOpId,
      status: result.applied ? "success" : "duplicate",
      server_id: result.progress_id,
      data: result,
    };
  } catch (err) {
    if (err instanceof CourseCertifyError) {
      return {
        submission_op_id: submissionOpId,
        status: err.httpStatus === 409 || err.httpStatus === 403 ? "conflict" : "failed",
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
  clientTimestamp?: string,
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

  if (p.kind === "homework" || p.kind === "homework.mark_done") {
    const { applyHomeworkSubmit, HomeworkSubmitError } = await import("./homework-submit-sync");
    try {
      const data = await applyHomeworkSubmit({
        actor,
        submissionId: p.entity_id,
        markDone: true,
        clientTimestamp,
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
  clientTimestamp?: string,
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
      return handleHomeworkSubmission(actor, submissionOpId, payload, clientTimestamp);
    case "course_progress":
      return handleCourseProgress(actor, submissionOpId, payload);
    case "course_certification":
      return handleCourseCertification(actor, submissionOpId, payload);
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
      result = await executeOp(actor, opType, op.submission_op_id, op.payload, op.client_timestamp);
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
