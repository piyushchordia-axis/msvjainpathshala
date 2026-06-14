/**
 * /v1/shivir-scanner — QR-driven shivir attendance + a live attendance dashboard.
 *
 * Shivirs are CITY-scoped. Admin-panel routes (session create/list + dashboard)
 * verify the shivir's city is in the caller's city scope (404 out of scope).
 *
 * The scan endpoint is open to any authed caller who is EITHER a registered
 * shivir volunteer for that shivir OR an admin-panel user whose city scope
 * includes the shivir's city (super_admin = unrestricted); out-of-scope callers
 * get a 404 (the session is not revealed). It then validates scan_kind against
 * the session's attendance_mode, verifies the signed ID-card QR with the shared
 * idcard-crypto HMAC, and — inside one transaction holding a per-student advisory
 * lock — re-checks the live digital_id_cards row before inserting, so a
 * stale/revoked QR (bumped version_no or is_active=false), even if revoked
 * concurrently, no longer records a scan (the same revocation rule as the
 * id-cards module, made atomic).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  shivir_events,
  shivir_sessions,
  shivir_attendance_scans,
  shivir_volunteers,
  shivir_registrations,
  digital_id_cards,
  students,
  centres,
  cities,
  type User,
} from "@workspace/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { canAccessAdminPanel } from "@workspace/api-zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth, requireAdminPanel } from "../../middlewares/auth";
import { resolveAdminScope } from "../../lib/scope";
import { verifyCardSignature, parseCardPayload } from "../../lib/idcard-crypto";

const router: IRouter = Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ---- city scope: null = all (super_admin); [] = nothing; else city ids ---- */
async function cityScopeForUser(user: User): Promise<string[] | null> {
  if (user.role === "super_admin") return null;
  if (user.role === "city_admin") return user.city_id ? [user.city_id] : [];
  if (user.role === "state_admin") {
    if (!user.state_id) return [];
    const rows = await db
      .select({ id: cities.id })
      .from(cities)
      .where(eq(cities.state_id, user.state_id));
    return rows.map((r) => r.id);
  }
  const scope = await resolveAdminScope(user);
  if (scope.centreIds === null) return null;
  if (scope.centreIds.length === 0) return [];
  const rows = await db
    .select({ city_id: centres.city_id })
    .from(centres)
    .where(inArray(centres.id, scope.centreIds));
  return Array.from(new Set(rows.map((r) => r.city_id)));
}

function cityInScope(cityIds: string[] | null, cityId: string | null): boolean {
  if (cityIds === null) return true;
  if (!cityId) return false;
  return cityIds.includes(cityId);
}

/** Fetch a shivir row (id + city) or null. */
async function getShivir(shivirId: string) {
  const [row] = await db
    .select({ id: shivir_events.id, city_id: shivir_events.city_id })
    .from(shivir_events)
    .where(eq(shivir_events.id, shivirId))
    .limit(1);
  return row ?? null;
}

/* ═══════════════════════════ ADMIN — sessions ═══════════════════════════ */

const createSessionSchema = z.object({
  title: z.string().min(1).max(300),
  session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  attendance_mode: z.enum(["in_out", "present_only"]).default("present_only"),
});

/* POST /v1/shivir-scanner/shivirs/:shivirId/sessions — create a session (scoped) */
router.post(
  "/shivirs/:shivirId/sessions",
  requireAdminPanel,
  async (req: Request, res: Response) => {
    let body: z.infer<typeof createSessionSchema>;
    try {
      body = createSessionSchema.parse(req.body);
    } catch {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid session data.");
      return;
    }

    const shivirId = String(req.params.shivirId);
    if (!UUID_RE.test(shivirId)) {
      fail(res, 404, "ERR_NOT_FOUND", "Shivir not found.");
      return;
    }
    const cityIds = await cityScopeForUser(req.authUser!);
    const shivir = await getShivir(shivirId);
    if (!shivir || !cityInScope(cityIds, shivir.city_id)) {
      fail(res, 404, "ERR_NOT_FOUND", "Shivir not found.");
      return;
    }

    const [row] = await db
      .insert(shivir_sessions)
      .values({
        shivir_id: shivirId,
        title: body.title,
        session_date: body.session_date,
        attendance_mode: body.attendance_mode,
      })
      .returning({ id: shivir_sessions.id });
    ok(res, { id: row.id });
  },
);

/* GET /v1/shivir-scanner/shivirs/:shivirId/sessions — list sessions (scoped) */
router.get(
  "/shivirs/:shivirId/sessions",
  requireAdminPanel,
  async (req: Request, res: Response) => {
    const shivirId = String(req.params.shivirId);
    if (!UUID_RE.test(shivirId)) {
      fail(res, 404, "ERR_NOT_FOUND", "Shivir not found.");
      return;
    }
    const cityIds = await cityScopeForUser(req.authUser!);
    const shivir = await getShivir(shivirId);
    if (!shivir || !cityInScope(cityIds, shivir.city_id)) {
      fail(res, 404, "ERR_NOT_FOUND", "Shivir not found.");
      return;
    }

    const rows = await db
      .select({
        id: shivir_sessions.id,
        title: shivir_sessions.title,
        session_date: shivir_sessions.session_date,
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

/* ═══════════════════════════ SCAN (volunteer/shikshak/admin) ═══════════════════════════ */

const scanSchema = z.object({
  qr_payload: z.string().min(1).max(2000),
  qr_signature: z.string().min(1).max(256),
  scan_kind: z.enum(["check_in", "check_out", "present"]).default("present"),
});

/* POST /v1/shivir-scanner/sessions/:sessionId/scan — record one QR scan */
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

  // Resolve the session -> its shivir (for the authorization + mode checks).
  const [session] = await db
    .select({
      id: shivir_sessions.id,
      shivir_id: shivir_sessions.shivir_id,
      attendance_mode: shivir_sessions.attendance_mode,
    })
    .from(shivir_sessions)
    .where(eq(shivir_sessions.id, sessionId))
    .limit(1);
  if (!session) {
    fail(res, 404, "ERR_NOT_FOUND", "Session not found.");
    return;
  }

  // Authorization (city-scoped): the caller must EITHER be a registered
  // volunteer for THIS shivir, OR an admin-panel user whose city scope includes
  // the shivir's city. Out-of-scope is a 404 (do not reveal the session exists).
  const authUser = req.authUser!;
  let allowed = false;
  if (canAccessAdminPanel(authUser.role)) {
    const shivir = await getShivir(session.shivir_id);
    if (shivir) {
      const cityIds = await cityScopeForUser(authUser);
      allowed = cityInScope(cityIds, shivir.city_id);
    }
  }
  if (!allowed) {
    const [vol] = await db
      .select({ id: shivir_volunteers.id })
      .from(shivir_volunteers)
      .where(
        and(
          eq(shivir_volunteers.shivir_id, session.shivir_id),
          eq(shivir_volunteers.user_id, authUser.id),
        ),
      )
      .limit(1);
    allowed = !!vol;
  }
  if (!allowed) {
    fail(res, 404, "ERR_NOT_FOUND", "Session not found.");
    return;
  }

  // The scan_kind must be compatible with the session's attendance_mode.
  const validKinds =
    session.attendance_mode === "present_only"
      ? (["present"] as const)
      : (["check_in", "check_out"] as const);
  if (!(validKinds as readonly string[]).includes(body.scan_kind)) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "scan_kind is not valid for this session's attendance mode.");
    return;
  }

  // Verify the signed ID-card QR (HMAC) — bad signature -> 401.
  if (!verifyCardSignature(body.qr_payload, body.qr_signature)) {
    fail(res, 401, "ERR_SIGNATURE_INVALID", "Signature is invalid.");
    return;
  }
  const parsed = parseCardPayload(body.qr_payload);
  if (!parsed || !UUID_RE.test(parsed.student_id)) {
    fail(res, 401, "ERR_SIGNATURE_INVALID", "Signature is invalid.");
    return;
  }

  // Atomic revocation re-check + insert: serialize per-student with an advisory
  // xact lock so a card revoked/version-bumped concurrently cannot still record a
  // scan (TOCTOU between the revocation read and the insert).
  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${parsed.student_id}::text, 0))`,
    );

    // Revocation rule: the card must still be active and at the same version_no.
    const [card] = await tx
      .select({ version_no: digital_id_cards.version_no, is_active: digital_id_cards.is_active })
      .from(digital_id_cards)
      .where(eq(digital_id_cards.student_id, parsed.student_id))
      .limit(1);
    if (!card || !card.is_active || card.version_no !== parsed.v) {
      return { status: "revoked" as const };
    }

    const [student] = await tx
      .select({ id: students.id, full_name: students.full_name, student_code: students.student_code })
      .from(students)
      .where(eq(students.id, parsed.student_id))
      .limit(1);
    if (!student) {
      return { status: "no_student" as const };
    }

    await tx.insert(shivir_attendance_scans).values({
      shivir_session_id: sessionId,
      student_id: student.id,
      volunteer_user_id: authUser.id,
      scan_kind: body.scan_kind,
      scanned_at: new Date(),
    });

    return { status: "ok" as const, student };
  });

  if (result.status === "revoked") {
    fail(res, 401, "ERR_SIGNATURE_INVALID", "Signature is invalid.");
    return;
  }
  if (result.status === "no_student") {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found.");
    return;
  }

  ok(res, {
    student: {
      id: result.student.id,
      full_name: result.student.full_name,
      student_code: result.student.student_code,
    },
    scan_kind: body.scan_kind,
  });
});

/* ═══════════════════════════ ADMIN — live dashboard ═══════════════════════════ */

/* GET /v1/shivir-scanner/shivirs/:shivirId/dashboard — live per-session counts */
router.get(
  "/shivirs/:shivirId/dashboard",
  requireAdminPanel,
  async (req: Request, res: Response) => {
    const shivirId = String(req.params.shivirId);
    if (!UUID_RE.test(shivirId)) {
      fail(res, 404, "ERR_NOT_FOUND", "Shivir not found.");
      return;
    }
    const cityIds = await cityScopeForUser(req.authUser!);
    const shivir = await getShivir(shivirId);
    if (!shivir || !cityInScope(cityIds, shivir.city_id)) {
      fail(res, 404, "ERR_NOT_FOUND", "Shivir not found.");
      return;
    }

    const sessions = await db
      .select({
        id: shivir_sessions.id,
        title: shivir_sessions.title,
        session_date: shivir_sessions.session_date,
        attendance_mode: shivir_sessions.attendance_mode,
        present: sql<number>`count(${shivir_attendance_scans.id}) filter (where ${shivir_attendance_scans.scan_kind} = 'present')::int`,
        checked_in: sql<number>`count(${shivir_attendance_scans.id}) filter (where ${shivir_attendance_scans.scan_kind} = 'check_in')::int`,
        checked_out: sql<number>`count(${shivir_attendance_scans.id}) filter (where ${shivir_attendance_scans.scan_kind} = 'check_out')::int`,
        distinct_students: sql<number>`count(distinct ${shivir_attendance_scans.student_id})::int`,
      })
      .from(shivir_sessions)
      .leftJoin(
        shivir_attendance_scans,
        eq(shivir_attendance_scans.shivir_session_id, shivir_sessions.id),
      )
      .where(eq(shivir_sessions.shivir_id, shivirId))
      .groupBy(shivir_sessions.id)
      .orderBy(asc(shivir_sessions.session_date), asc(shivir_sessions.created_at));

    const [{ registered }] = await db
      .select({ registered: sql<number>`count(*)::int` })
      .from(shivir_registrations)
      .where(eq(shivir_registrations.shivir_id, shivirId));

    ok(res, {
      sessions,
      registered_total: registered ?? 0,
    });
  },
);

export default router;
