/**
 * Shared shivir scan apply — the ONE domain path for both the online route and
 * /v1/sync/batch.
 *
 * AT28 boundary: writes only to shivir_attendance_scans. Do not feed Pathshala
 * attendance_%, streaks, or auto Punya from this path.
 *
 * Authorization lives HERE, not in the route. It used to sit only in
 * routes/v1/shivir-scanner.ts, so the offline transport reached this service
 * with nothing but `requireAuth` behind it: any authenticated parent could take
 * their own child's signed QR from GET /v1/id-cards/mine and record attendance
 * into any session of any shivir in the country. A second transport must never
 * be able to reach a weaker rule than the first.
 */
import type { ErrorCode } from "@workspace/api-zod";
import {
  db,
  shivir_attendance_scans,
  shivir_registrations,
  digital_id_cards,
  students,
  type User,
} from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { verifyCardSignature, parseCardPayload } from "../lib/idcard-crypto";
import { assertShivirScanAccess, getShivirForSession } from "../lib/shivir-access";

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

export type ShivirScanKind = "present" | "check_in" | "check_out";

/**
 * How long after a scan the same student's next scan is treated as a repeat
 * rather than the next leg of an in/out pair.
 *
 * This replaces UNIQUE (session, student, kind), which had to be dropped
 * because it capped a student at one check_in per session for all time and so
 * made SPEC 8.6 re-entry impossible. A window is the right shape for the real
 * failure it guards: a volunteer double-tapping one card, or two volunteers
 * scanning the same queue. Genuine re-entry — a child leaving for lunch and
 * coming back — is minutes or hours later, never seconds.
 */
export const SHIVIR_RESCAN_WINDOW_SECONDS = 60;

/**
 * Clock skew we tolerate on a client-supplied scanned_at before clamping.
 * A phone whose clock is minutes fast should not stamp scans into the future.
 */
const MAX_FUTURE_SKEW_MS = 2 * 60 * 1000;

/**
 * Resolve the timestamp to record.
 *
 * The client's value is authoritative because it is the moment the card was
 * held to the camera; the server's is merely the moment the queue drained. A
 * scan taken at 23:55 in a basement and synced after midnight belongs to the
 * day it happened. Unparseable or absurd values fall back to now rather than
 * rejecting — losing the scan would be far worse than dating it imprecisely.
 */
function resolveScannedAt(raw: string | undefined, now: Date): Date {
  if (!raw) return now;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return now;
  if (parsed.getTime() > now.getTime() + MAX_FUTURE_SKEW_MS) return now;
  // Guard against an epoch-0 or otherwise nonsensical clock.
  if (parsed.getTime() < now.getTime() - 365 * 24 * 60 * 60 * 1000) return now;
  return parsed;
}

export interface ApplyShivirScanResult {
  scan_id?: string;
  duplicate: boolean;
  student_id: string;
  full_name: string | null;
  student_code: string | null;
  scan_kind: ShivirScanKind;
  was_registered: boolean;
  shivir_id: string;
  scanned_at: string;
}

export async function applyShivirScan(opts: {
  sessionId: string;
  actor: User;
  qr_payload: string;
  qr_signature: string;
  /** Omit in in_out mode to let the server derive the next leg (SPEC 8.6). */
  scan_kind?: ShivirScanKind;
  /** Client clock — the moment the card was scanned, not the moment it synced. */
  scanned_at?: string;
  /** AT19 per-item ULID; the replay anchor for the offline transport. */
  client_op_id?: string;
  device_offline?: boolean;
}): Promise<ApplyShivirScanResult> {
  const resolved = await getShivirForSession(opts.sessionId);
  if (!resolved) {
    throw new ShivirScanError(404, "ERR_NOT_FOUND", "Session not found.");
  }
  const { session, shivir } = resolved;

  // Authorization BEFORE signature verification, so an out-of-scope caller
  // cannot use the 401-vs-404 difference to probe which sessions exist.
  const access = await assertShivirScanAccess(opts.actor, session.shivir_id);
  if (!access.ok) {
    throw new ShivirScanError(404, "ERR_NOT_FOUND", "Session not found.");
  }

  // An explicit kind must match the session's mode. The online route enforced
  // this and the sync path did not, so a check_in could be written into a
  // present_only session purely by choosing the other transport.
  if (opts.scan_kind) {
    const validKinds: readonly ShivirScanKind[] =
      session.attendance_mode === "present_only" ? ["present"] : ["check_in", "check_out"];
    if (!validKinds.includes(opts.scan_kind)) {
      throw new ShivirScanError(
        422,
        "ERR_VALIDATION_FAILED",
        "That scan type is not valid for this session's attendance mode.",
      );
    }
  }

  if (!verifyCardSignature(opts.qr_payload, opts.qr_signature)) {
    throw new ShivirScanError(401, "ERR_SIGNATURE_INVALID", "Signature is invalid.");
  }
  const parsed = parseCardPayload(opts.qr_payload);
  if (!parsed?.student_id) {
    throw new ShivirScanError(401, "ERR_SIGNATURE_INVALID", "Signature is invalid.");
  }

  const now = new Date();
  const scannedAt = resolveScannedAt(opts.scanned_at, now);

  const result = await db.transaction(async (tx) => {
    // Serialize per student so a card revoked mid-scan cannot still record a
    // row, and so two volunteers scanning the same child cannot both read
    // "no prior scan" and both insert a check_in.
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
      .select({
        id: students.id,
        full_name: students.full_name,
        student_code: students.student_code,
      })
      .from(students)
      .where(eq(students.id, parsed.student_id))
      .limit(1);
    if (!student) {
      throw new ShivirScanError(404, "ERR_NOT_FOUND", "Student not found.");
    }

    const [last] = await tx
      .select({
        scan_kind: shivir_attendance_scans.scan_kind,
        scanned_at: shivir_attendance_scans.scanned_at,
        // Carried so a duplicate result can report the registration state that
        // was actually recorded, rather than a hardcoded false the caller might
        // one day render as "walk-in".
        was_registered: shivir_attendance_scans.was_registered,
      })
      .from(shivir_attendance_scans)
      .where(
        and(
          eq(shivir_attendance_scans.shivir_session_id, opts.sessionId),
          eq(shivir_attendance_scans.student_id, student.id),
        ),
      )
      .orderBy(desc(shivir_attendance_scans.scanned_at))
      .limit(1);

    // SPEC 8.6 step 4 — the server owns the in/out state machine. The volunteer
    // used to flip a toggle by hand, so a forgotten flip silently dropped a
    // child's exit and re-entry was impossible at any setting.
    let scanKind: ShivirScanKind;
    if (session.attendance_mode === "present_only") {
      scanKind = "present";
    } else if (opts.scan_kind) {
      scanKind = opts.scan_kind;
    } else if (!last) {
      scanKind = "check_in";
    } else {
      scanKind = last.scan_kind === "check_in" ? "check_out" : "check_in";
    }

    if (session.attendance_mode === "present_only") {
      // One presence per session is the whole meaning of the mode.
      if (last) {
        return {
          duplicate: true as const,
          student,
          scanKind,
          was_registered: last.was_registered,
          scannedAt: last.scanned_at,
        };
      }
    } else if (last) {
      const deltaMs = scannedAt.getTime() - last.scanned_at.getTime();
      /**
       * Two cases collapse to "duplicate", for different reasons:
       *
       *  - deltaMs < window: a repeat, not the next leg. This is what makes
       *    auto-toggle safe — a double-tap can no longer check a student
       *    straight back out.
       *  - deltaMs <= 0: an OUT-OF-ORDER drain. An offline scan from 09:00 can
       *    reach the server after an online one from 13:00, and deriving a leg
       *    from a position that is already in the future would write a check_out
       *    dated before its own check_in. Dropping it as a duplicate is the only
       *    outcome that keeps the sequence readable.
       */
      if (deltaMs < SHIVIR_RESCAN_WINDOW_SECONDS * 1000) {
        return {
          duplicate: true as const,
          student,
          scanKind: last.scan_kind,
          was_registered: last.was_registered,
          scannedAt: last.scanned_at,
        };
      }
    }

    // Walk-in resolution (D2): recorded, never refused. A child turned away at
    // the gate because a parent never completed a form is the larger harm.
    const [reg] = await tx
      .select({ id: shivir_registrations.id })
      .from(shivir_registrations)
      .where(
        and(
          eq(shivir_registrations.shivir_id, session.shivir_id),
          eq(shivir_registrations.student_id, student.id),
          eq(shivir_registrations.status, "registered"),
        ),
      )
      .limit(1);

    const insert = tx
      .insert(shivir_attendance_scans)
      .values({
        shivir_id: session.shivir_id,
        shivir_session_id: opts.sessionId,
        student_id: student.id,
        volunteer_user_id: opts.actor.id,
        scan_kind: scanKind,
        scanned_at: scannedAt,
        client_op_id: opts.client_op_id ?? null,
        device_offline: opts.device_offline ?? false,
        was_registered: !!reg,
      })
      .returning({ id: shivir_attendance_scans.id });

    // With the composite key gone, client_op_id is the replay anchor: the same
    // queued op drained twice writes one row, whatever the window says.
    const inserted = opts.client_op_id
      ? await insert.onConflictDoNothing({ target: shivir_attendance_scans.client_op_id })
      : await insert;

    return {
      duplicate: inserted.length === 0,
      scan_id: inserted[0]?.id,
      student,
      scanKind,
      was_registered: !!reg,
      scannedAt,
    };
  });

  return {
    scan_id: "scan_id" in result ? result.scan_id : undefined,
    duplicate: result.duplicate,
    student_id: result.student.id,
    full_name: result.student.full_name,
    student_code: result.student.student_code,
    scan_kind: result.scanKind,
    was_registered: result.was_registered,
    shivir_id: shivir.id,
    scanned_at: result.scannedAt.toISOString(),
  };
}
