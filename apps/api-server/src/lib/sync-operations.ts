/**
 * sync_operations write/read helpers — the offline replay ledger (AT19).
 * Every sync/batch execution MUST write a row; success-replay returns stored payload.
 */
import { db, sync_operations } from "@workspace/db";
import { and, eq } from "drizzle-orm";

export type SyncOpStatus = "success" | "duplicate" | "conflict" | "failed";

export type SyncResult = {
  submission_op_id: string;
  status: SyncOpStatus;
  server_id?: string;
  error?: { code: string; message: string; details?: unknown };
  /** Domain payload echoed to the client (also stored for replay). */
  data?: unknown;
};

export async function findSuccessfulSync(
  userId: string,
  submissionOpId: string,
): Promise<SyncResult | null> {
  const [existing] = await db
    .select({
      status: sync_operations.status,
      response_payload: sync_operations.response_payload,
    })
    .from(sync_operations)
    .where(
      and(eq(sync_operations.user_id, userId), eq(sync_operations.submission_op_id, submissionOpId)),
    )
    .limit(1);

  if (existing?.status === "success" && existing.response_payload) {
    const payload = existing.response_payload as SyncResult;
    // Stored shape is the client-facing result.
    if (payload && typeof payload === "object" && "status" in payload) {
      return { ...payload, submission_op_id: submissionOpId, status: "success" };
    }
    return {
      submission_op_id: submissionOpId,
      status: "success",
      data: existing.response_payload,
    };
  }
  return null;
}

/** Upsert the ledger row for this (user, submission_op_id). Always write. */
export async function writeSyncOperation(opts: {
  userId: string;
  submissionOpId: string;
  opKind: string;
  requestPayload: unknown;
  result: SyncResult;
}): Promise<void> {
  const responsePayload = {
    submission_op_id: opts.result.submission_op_id,
    status: opts.result.status,
    server_id: opts.result.server_id,
    error: opts.result.error,
    data: opts.result.data,
  };

  await db
    .insert(sync_operations)
    .values({
      user_id: opts.userId,
      submission_op_id: opts.submissionOpId,
      op_kind: opts.opKind,
      request_payload: (opts.requestPayload ?? {}) as Record<string, unknown>,
      response_payload: responsePayload,
      status: opts.result.status,
      error: opts.result.error
        ? `${opts.result.error.code}: ${opts.result.error.message}`
        : null,
      applied_at: new Date(),
    })
    .onConflictDoUpdate({
      target: [sync_operations.user_id, sync_operations.submission_op_id],
      set: {
        op_kind: opts.opKind,
        request_payload: (opts.requestPayload ?? {}) as Record<string, unknown>,
        response_payload: responsePayload,
        status: opts.result.status,
        error: opts.result.error
          ? `${opts.result.error.code}: ${opts.result.error.message}`
          : null,
        applied_at: new Date(),
        updated_at: new Date(),
      },
    });
}
