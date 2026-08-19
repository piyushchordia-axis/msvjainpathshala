/**
 * /v1/shivir-scanner — QR-driven shivir attendance + a live attendance dashboard.
 *
 * AT28 — shivir_attendance_scans is a SEPARATE ledger. It must NEVER join into
 * Pathshala attendance_percentage, attendance streaks, or automatic attendance
 * Punya. Shivir Punya is awarded only via the manual `msv_shivir` feature.
 *
 * Shivirs are CITY-scoped. Authorization and the scan state machine both live in
 * services/shivir-scan.ts + lib/shivir-access.ts, NOT here — this router used to
 * own a second copy of the scan transaction, which is how the /v1/sync/batch
 * path came to enforce nothing. The route is now transport only.
 *
 * Roles (SPEC 6.14, see SHIVIR_OPS_ROLES): sessions and the dashboard need an
 * ops role; scanning needs an ops role in city scope OR a live volunteer
 * assignment. Out-of-scope callers get a 404 — never a 403, which would confirm
 * the shivir exists.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  shivir_sessions,
  shivir_attendance_scans,
  shivir_registrations,
  students,
  type User,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth, requireShivirOps } from "../../middlewares/auth";
import { auditFromReq } from "../../lib/audit";
import { cityIdsForUser } from "../../lib/scope";
import {
  assertShivirScanAccess,
  canActOnShivir,
  cityInScope,
  getShivir,
} from "../../lib/shivir-access";
import { applyShivirScan, ShivirScanError } from "../../services/shivir-scan";
import { emitShivirScan } from "../../lib/shivir-feed";
import { enqueueParentShivirNotify } from "../../lib/shivir-notify";

const router: IRouter = Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clampLimit(raw: unknown, fallback: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

/** Ops-role + city-scope gate for the admin-facing shivir routes. */
async function requireShivirInScope(req: Request, res: Response, shivirId: string) {
  if (!UUID_RE.test(shivirId)) {
    fail(res, 404, "ERR_NOT_FOUND", "Shivir not found.");
    return null;
  }
  const cityIds = await cityIdsForUser(req.authUser!);
  const shivir = await getShivir(shivirId);
  if (!shivir || !cityInScope(cityIds, shivir.city_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Shivir not found.");
    return null;
  }
  return shivir;
}

/* ═══════════════════════════ ADMIN — sessions ═══════════════════════════ */

const createSessionSchema = z.object({
  title: z.string().min(1).max(300),
  session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  day_number: z.coerce.number().int().min(1).max(365).optional(),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  attendance_mode: z.enum(["in_out", "present_only"]).default("present_only"),
});

/* POST /v1/shivir-scanner/shivirs/:shivirId/sessions — create a session (scoped) */
router.post(
  "/shivirs/:shivirId/sessions",
  requireShivirOps,
  async (req: Request, res: Response) => {
    let body: z.infer<typeof createSessionSchema>;
    try {
      body = createSessionSchema.parse(req.body);
    } catch {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid session data.");
      return;
    }

    const shivirId = String(req.params.shivirId);
    const shivir = await requireShivirInScope(req, res, shivirId);
    if (!shivir) return;

    // A session dated outside the shivir is always a typo, and it renders as a
    // ghost day on the dashboard that no volunteer can explain.
    if (body.session_date < shivir.start_date || body.session_date > shivir.end_date) {
      fail(
        res,
        422,
        "ERR_VALIDATION_FAILED",
        `That date is outside the shivir — it runs from ${shivir.start_date} to ${shivir.end_date}.`,
      );
      return;
    }
    if (body.start_time && body.end_time && body.end_time <= body.start_time) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "The end time must be after the start time.");
      return;
    }

    // Default day_number to the next free slot so the volunteer-facing session
    // list is ordered even when the admin does not supply one.
    let dayNumber = body.day_number ?? null;
    if (dayNumber === null) {
      const [max] = await db
        .select({ n: sql<number | null>`max(${shivir_sessions.day_number})` })
        .from(shivir_sessions)
        .where(eq(shivir_sessions.shivir_id, shivirId));
      dayNumber = (max?.n ?? 0) + 1;
    }

    let row: { id: string };
    try {
      const inserted = await db
        .insert(shivir_sessions)
        .values({
          shivir_id: shivirId,
          title: body.title,
          day_number: dayNumber,
          session_date: body.session_date,
          start_time: body.start_time ?? null,
          end_time: body.end_time ?? null,
          attendance_mode: body.attendance_mode,
        })
        .returning({ id: shivir_sessions.id });
      row = inserted[0]!;
    } catch {
      fail(res, 409, "ERR_CONFLICT", "A session already uses that day number.");
      return;
    }

    await auditFromReq(req, {
      action: "create",
      entityKind: "shivir_session",
      entityId: row.id,
      summary: `Created shivir session "${body.title}".`,
      metadata: {
        shivir_id: shivirId,
        session_date: body.session_date,
        day_number: dayNumber,
        attendance_mode: body.attendance_mode,
      },
    });

    ok(res, { id: row.id });
  },
);

/* GET /v1/shivir-scanner/shivirs/:shivirId/sessions — list sessions (scoped) */
router.get(
  "/shivirs/:shivirId/sessions",
  requireShivirOps,
  async (req: Request, res: Response) => {
    const shivirId = String(req.params.shivirId);
    const shivir = await requireShivirInScope(req, res, shivirId);
    if (!shivir) return;

    const rows = await db
      .select({
        id: shivir_sessions.id,
        title: shivir_sessions.title,
        day_number: shivir_sessions.day_number,
        session_date: shivir_sessions.session_date,
        start_time: shivir_sessions.start_time,
        end_time: shivir_sessions.end_time,
        attendance_mode: shivir_sessions.attendance_mode,
        created_at: shivir_sessions.created_at,
      })
      .from(shivir_sessions)
      .where(eq(shivir_sessions.shivir_id, shivirId))
      .orderBy(asc(shivir_sessions.session_date), asc(shivir_sessions.created_at));
    const items = rows.map((r) => ({ ...r, created_at: r.created_at.toISOString() }));
    ok(res, { items }, { count: items.length });
  },
);

/* ═══════════════ SCAN CONTEXT (volunteer / ops admin) ═══════════════ */

/*
 * GET /v1/shivir-scanner/shivirs/:shivirId/scan-context
 * The data the scanner screen needs before it can scan. Open to the same callers
 * as the scan endpoint; out-of-scope is a 404.
 */
router.get("/shivirs/:shivirId/scan-context", async (req: Request, res: Response) => {
  const shivirId = String(req.params.shivirId);
  if (!UUID_RE.test(shivirId)) {
    fail(res, 404, "ERR_NOT_FOUND", "Shivir not found.");
    return;
  }
  const access = await assertShivirScanAccess(req.authUser!, shivirId);
  if (!access.ok) {
    fail(res, 404, access.code, access.message);
    return;
  }

  const sessions = await sessionCounts(shivirId);
  ok(
    res,
    {
      shivir: {
        id: access.shivir.id,
        name_en: access.shivir.name_en,
        name_hi: access.shivir.name_hi,
      },
      sessions,
    },
    { count: sessions.length },
  );
});

/** Per-session scan tallies, shared by scan-context and the dashboard. */
async function sessionCounts(shivirId: string) {
  return db
    .select({
      id: shivir_sessions.id,
      title: shivir_sessions.title,
      day_number: shivir_sessions.day_number,
      session_date: shivir_sessions.session_date,
      start_time: shivir_sessions.start_time,
      end_time: shivir_sessions.end_time,
      attendance_mode: shivir_sessions.attendance_mode,
      present: sql<number>`count(${shivir_attendance_scans.id}) filter (where ${shivir_attendance_scans.scan_kind} = 'present')::int`,
      checked_in: sql<number>`count(${shivir_attendance_scans.id}) filter (where ${shivir_attendance_scans.scan_kind} = 'check_in')::int`,
      checked_out: sql<number>`count(${shivir_attendance_scans.id}) filter (where ${shivir_attendance_scans.scan_kind} = 'check_out')::int`,
      distinct_students: sql<number>`count(distinct ${shivir_attendance_scans.student_id})::int`,
      walk_ins: sql<number>`count(distinct ${shivir_attendance_scans.student_id}) filter (where ${shivir_attendance_scans.was_registered} = false)::int`,
    })
    .from(shivir_sessions)
    .leftJoin(
      shivir_attendance_scans,
      eq(shivir_attendance_scans.shivir_session_id, shivir_sessions.id),
    )
    .where(eq(shivir_sessions.shivir_id, shivirId))
    .groupBy(shivir_sessions.id)
    .orderBy(asc(shivir_sessions.session_date), asc(shivir_sessions.created_at));
}

/* ═══════════════════════════ SCAN ═══════════════════════════ */

const scanSchema = z.object({
  qr_payload: z.string().min(1).max(2000),
  qr_signature: z.string().min(1).max(256),
  /**
   * Optional on purpose. Omitting it in in_out mode lets the server derive the
   * next leg from the student's last scan (SPEC 8.6) instead of trusting a
   * toggle the volunteer may have forgotten to flip.
   */
  scan_kind: z.enum(["check_in", "check_out", "present"]).optional(),
  scanned_at: z.string().datetime().optional(),
  client_op_id: z.string().length(26).optional(),
});

/*
 * POST /v1/shivir-scanner/sessions/:sessionId/scan — record one QR scan.
 *
 * Deliberately NOT written to audit_logs. Every field an audit entry would
 * carry — who scanned, which student, when, from which transport — is already a
 * column on shivir_attendance_scans, and the table is append-only in practice
 * (nothing updates or deletes a scan). Duplicating a few hundred rows per shivir
 * into audit_logs would bury the admin actions that log exists to make findable.
 * Session create, volunteer assignment and shivir edits ARE audited, because
 * those leave no other record of who decided what.
 */
router.post("/sessions/:sessionId/scan", async (req: Request, res: Response) => {
  let body: z.infer<typeof scanSchema>;
  try {
    body = scanSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid scan payload.");
    return;
  }

  const sessionId = String(req.params.sessionId);
  if (!UUID_RE.test(sessionId)) {
    fail(res, 404, "ERR_NOT_FOUND", "Session not found.");
    return;
  }

  let data;
  try {
    data = await applyShivirScan({
      sessionId,
      actor: req.authUser as User,
      qr_payload: body.qr_payload,
      qr_signature: body.qr_signature,
      scan_kind: body.scan_kind,
      scanned_at: body.scanned_at,
      client_op_id: body.client_op_id,
      device_offline: false,
    });
  } catch (err) {
    if (err instanceof ShivirScanError) {
      fail(res, err.httpStatus, err.code, err.message);
      return;
    }
    throw err;
  }

  if (!data.duplicate) {
    // Both best-effort: a push or socket hiccup must never fail a scan that is
    // already committed and is the only record this child was here (AT28).
    void enqueueParentShivirNotify(data.student_id, sessionId, data.scan_kind);
    emitShivirScan(data.shivir_id, {
      session_id: sessionId,
      student_id: data.student_id,
      scan_kind: data.scan_kind,
      was_registered: data.was_registered,
      scanned_at: data.scanned_at,
    });
  }

  const [countRow] = await db
    .select({
      count: sql<number>`count(*) filter (where ${shivir_attendance_scans.scan_kind} = ${data.scan_kind})::int`,
    })
    .from(shivir_attendance_scans)
    .where(eq(shivir_attendance_scans.shivir_session_id, sessionId));

  ok(res, {
    student: {
      id: data.student_id,
      full_name: data.full_name,
      student_code: data.student_code,
    },
    scan_kind: data.scan_kind,
    duplicate: data.duplicate,
    was_registered: data.was_registered,
    count: countRow?.count ?? 0,
  });
});

/* ═══════════════════════════ ADMIN — live dashboard ═══════════════════════════ */

/* GET /v1/shivir-scanner/shivirs/:shivirId/dashboard — live per-session counts */
router.get(
  "/shivirs/:shivirId/dashboard",
  requireShivirOps,
  async (req: Request, res: Response) => {
    const shivirId = String(req.params.shivirId);
    const shivir = await requireShivirInScope(req, res, shivirId);
    if (!shivir) return;

    const sessions = await sessionCounts(shivirId);

    const [reg] = await db
      .select({
        registered: sql<number>`count(*) filter (where ${shivir_registrations.status} = 'registered')::int`,
        cancelled: sql<number>`count(*) filter (where ${shivir_registrations.status} = 'cancelled')::int`,
      })
      .from(shivir_registrations)
      .where(eq(shivir_registrations.shivir_id, shivirId));

    ok(res, {
      shivir: {
        id: shivir.id,
        name_en: shivir.name_en,
        name_hi: shivir.name_hi,
        start_date: shivir.start_date,
        end_date: shivir.end_date,
        capacity: shivir.capacity,
        attendance_mode: shivir.attendance_mode,
      },
      sessions,
      registered_total: reg?.registered ?? 0,
      cancelled_total: reg?.cancelled ?? 0,
    });
  },
);

/*
 * GET /v1/shivir-scanner/shivirs/:shivirId/roster?session_id=&status=
 *
 * Who is here, who is missing. A live count answers almost no question anyone
 * actually asks at a venue — the Sanchalak needs names.
 */
router.get(
  "/shivirs/:shivirId/roster",
  requireShivirOps,
  async (req: Request, res: Response) => {
    const shivirId = String(req.params.shivirId);
    const shivir = await requireShivirInScope(req, res, shivirId);
    if (!shivir) return;

    const sessionId = req.query.session_id ? String(req.query.session_id) : null;
    if (sessionId && !UUID_RE.test(sessionId)) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid session_id.");
      return;
    }
    const limit = clampLimit(req.query.limit, 200, 500);

    const rows = await buildRoster(shivirId, sessionId, limit);
    ok(res, { items: rows }, { count: rows.length });
  },
);

export interface RosterRow {
  student_id: string;
  full_name: string;
  student_code: string | null;
  registered: boolean;
  last_scan_kind: "present" | "check_in" | "check_out" | null;
  last_scanned_at: string | null;
  scan_count: number;
  /** registered | scanned | walk_in | not_arrived — one word for the venue. */
  state: "registered" | "scanned" | "walk_in" | "not_arrived";
}

/**
 * The roster is a UNION of two populations: everyone registered (whether or not
 * they turned up) and everyone scanned (whether or not they registered). Either
 * side alone hides exactly the person you are looking for.
 */
export async function buildRoster(
  shivirId: string,
  sessionId: string | null,
  limit: number,
): Promise<RosterRow[]> {
  const scanWhere = sessionId
    ? and(
        eq(shivir_attendance_scans.shivir_id, shivirId),
        eq(shivir_attendance_scans.shivir_session_id, sessionId),
      )
    : eq(shivir_attendance_scans.shivir_id, shivirId);

  const scanRows = await db
    .select({
      student_id: shivir_attendance_scans.student_id,
      scan_kind: shivir_attendance_scans.scan_kind,
      scanned_at: shivir_attendance_scans.scanned_at,
      was_registered: shivir_attendance_scans.was_registered,
    })
    .from(shivir_attendance_scans)
    .where(scanWhere)
    .orderBy(desc(shivir_attendance_scans.scanned_at));

  const regRows = await db
    .select({ student_id: shivir_registrations.student_id })
    .from(shivir_registrations)
    .where(
      and(
        eq(shivir_registrations.shivir_id, shivirId),
        eq(shivir_registrations.status, "registered"),
      ),
    );

  const registered = new Set(regRows.map((r) => r.student_id));
  const latest = new Map<
    string,
    { kind: "present" | "check_in" | "check_out"; at: Date; count: number }
  >();
  for (const s of scanRows) {
    const prev = latest.get(s.student_id);
    if (!prev) {
      latest.set(s.student_id, { kind: s.scan_kind, at: s.scanned_at, count: 1 });
    } else {
      prev.count += 1;
      if (s.scanned_at > prev.at) {
        prev.kind = s.scan_kind;
        prev.at = s.scanned_at;
      }
    }
  }

  const ids = Array.from(new Set([...registered, ...latest.keys()])).slice(0, limit);
  if (ids.length === 0) return [];

  const studentRows = await db
    .select({
      id: students.id,
      full_name: students.full_name,
      student_code: students.student_code,
    })
    .from(students)
    .where(inArray(students.id, ids));

  return studentRows
    .map((s): RosterRow => {
      const scan = latest.get(s.id);
      const isRegistered = registered.has(s.id);
      const state: RosterRow["state"] = scan
        ? isRegistered
          ? "scanned"
          : "walk_in"
        : isRegistered
          ? "not_arrived"
          : "registered";
      return {
        student_id: s.id,
        full_name: s.full_name,
        student_code: s.student_code,
        registered: isRegistered,
        last_scan_kind: scan?.kind ?? null,
        last_scanned_at: scan?.at.toISOString() ?? null,
        scan_count: scan?.count ?? 0,
        state,
      };
    })
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}

/** Re-exported so the admin export route shares one authorization rule. */
export { canActOnShivir };

export default router;
