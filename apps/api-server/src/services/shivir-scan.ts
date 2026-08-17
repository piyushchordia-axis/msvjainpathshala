/**
 * Shared shivir scan apply — used by online route and sync/batch.
 *
 * AT28 boundary: writes only to shivir_attendance_scans. Do not feed Pathshala
 * attendance_%, streaks, or auto Punya from this path.
 */
import type { ErrorCode } from "@workspace/api-zod";
import {
  db,
  shivir_sessions,
  shivir_attendance_scans,
  digital_id_cards,
  students,
  type User,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { verifyCardSignature, parseCardPayload } from "../lib/idcard-crypto";

export class ShivirScanError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ShivirScanError";
  }
}

export async function applyShivirScan(opts: {
  sessionId: string;
  actor: User;
  qr_payload: string;
  qr_signature: string;
  scan_kind?: "present" | "check_in" | "check_out";
}): Promise<{ scan_id?: string; duplicate: boolean; student_id: string }> {
  const [session] = await db
    .select({
      id: shivir_sessions.id,
      attendance_mode: shivir_sessions.attendance_mode,
    })
    .from(shivir_sessions)
    .where(eq(shivir_sessions.id, opts.sessionId))
    .limit(1);
  if (!session) {
    throw new ShivirScanError(404, "ERR_NOT_FOUND", "Session not found.");
  }

  const scanKind =
    opts.scan_kind ??
    (session.attendance_mode === "present_only" ? "present" : "check_in");

  if (!verifyCardSignature(opts.qr_payload, opts.qr_signature)) {
    throw new ShivirScanError(401, "ERR_SIGNATURE_INVALID", "Signature is invalid.");
  }
  const parsed = parseCardPayload(opts.qr_payload);
  if (!parsed?.student_id) {
    throw new ShivirScanError(401, "ERR_SIGNATURE_INVALID", "Signature is invalid.");
  }

  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${parsed.student_id}::text, 0))`,
    );
    const [card] = await tx
      .select({ version_no: digital_id_cards.version_no, is_active: digital_id_cards.is_active })
      .from(digital_id_cards)
      .where(eq(digital_id_cards.student_id, parsed.student_id))
      .limit(1);
    if (!card || !card.is_active || card.version_no !== parsed.v) {
      throw new ShivirScanError(401, "ERR_SIGNATURE_INVALID", "Signature is invalid.");
    }
    const [student] = await tx
      .select({ id: students.id })
      .from(students)
      .where(eq(students.id, parsed.student_id))
      .limit(1);
    if (!student) {
      throw new ShivirScanError(404, "ERR_NOT_FOUND", "Student not found.");
    }
    const inserted = await tx
      .insert(shivir_attendance_scans)
      .values({
        shivir_session_id: opts.sessionId,
        student_id: student.id,
        volunteer_user_id: opts.actor.id,
        scan_kind: scanKind,
        scanned_at: new Date(),
      })
      .onConflictDoNothing({
        target: [
          shivir_attendance_scans.shivir_session_id,
          shivir_attendance_scans.student_id,
          shivir_attendance_scans.scan_kind,
        ],
      })
      .returning({ id: shivir_attendance_scans.id });
    return {
      scan_id: inserted[0]?.id,
      duplicate: inserted.length === 0,
      student_id: student.id,
    };
  });

  return result;
}
