import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  students,
  enrolments,
  batches,
  centres,
  users,
  punya_transactions,
  msv_enrolments,
  donations,
  device_sessions,
  shikshak_batch_assignments,
  service_requests,
  punya_balances,
} from "@workspace/db";
import { and, asc, count, desc, eq, gte, gt, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  enrolmentActionSchema,
  studentStatusActionSchema,
  enrolmentStatusSchema,
  studentStatusSchema,
  canViewDonations,
  type Role,
} from "@workspace/api-zod";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth, requireAdminPanel, requireRole } from "../../middlewares/auth";
import { resolveAdminScope, inBatchWriteScope } from "../../lib/scope";
import { auditFromReq, writeAudit } from "../../lib/audit";
import { materialiseHomeworkForStudentBatch } from "../../lib/homework-materialise";
import { signAccessToken, generateRefreshToken, verifyAccessToken, hashSecret } from "../../lib/tokens";
import { setAuthCookies, setImpersonationCookies, clearAuthCookies } from "../../lib/cookies";
import { toSessionUser } from "../../lib/session-user";
import { signUploadUrl } from "../../lib/file-tokens";
import adminResourcesRouter from "./admin-resources";
import adminModulesRouter from "./admin-modules";
import adminCoursesRouter from "./admin-courses";
import adminStaffingRouter from "./admin-staffing";
import adminLibraryRouter from "./admin-library";
import adminTeamRouter from "./admin-team";
import { canTransitionEnrolment } from "./enrolments";
import { clampLimit, inScope, scopedCentreFilter, scopedBatchFilter } from "../../lib/route-helpers";
import { getCentresAttendanceRate, rateToPercent1 } from "../../lib/attendance-rate";

const router: IRouter = Router();

/** A canonical UUID, so a malformed `:id` param yields 404 rather than a Postgres 22P02 crash. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* POST /v1/admin/impersonate/stop — end an impersonation session.
 *
 * Registered ABOVE the router-level requireAuth/requireAdminPanel guards: while
 * impersonating, the live cookie session is the SUBJECT (possibly a parent or
 * student with no admin-panel access), so this cannot gate on the subject's
 * role. Instead it authenticates off the jp_imp_active cookie, which is only
 * ever set by a super_admin starting an impersonation. Clearing all auth +
 * impersonation cookies drops the subject session and the banner flag; the
 * admin then re-authenticates as themselves. Best-effort audited — we resolve
 * the subject from the access cookie (if still valid) so the trail records who
 * was being impersonated.
 *
 * The banner posts here via a no-JS native <form>, so we 303-redirect back to
 * the admin login on success for a clean browser navigation; API/XHR callers
 * that send X-Requested-With get a JSON envelope instead.
 */
router.post("/impersonate/stop", async (req: Request, res: Response) => {
  const cookies = req.cookies as Record<string, string> | undefined;
  if (cookies?.jp_imp_active !== "true") {
    fail(res, 400, "ERR_NO_IMPERSONATION", "No active impersonation session.");
    return;
  }

  // Best-effort: record who was being impersonated (resolved from the subject
  // access cookie) so the audit trail links start↔stop. auditFromReq reads the
  // actor from req.authUser, which we seed with the subject for context.
  const token = cookies?.jp_access;
  if (token) {
    const verified = verifyAccessToken(token);
    if (verified) {
      const [subject] = await db
        .select()
        .from(users)
        .where(eq(users.id, verified.uid))
        .limit(1)
        .catch(() => [] as (typeof users.$inferSelect)[]);
      if (subject) req.authUser = subject;
    }
  }
  await auditFromReq(req, {
    action: "config_change",
    entityKind: "impersonation",
    entityId: req.authUser?.id ?? null,
    summary: "Stopped impersonation session.",
  });

  // Revoke the impersonation device_session so its 30-day refresh token can no
  // longer be replayed. The jp_refresh cookie holds that session's refresh
  // token; match the row by its hash (as logout does) and stamp revoked_at.
  const refresh = cookies?.jp_refresh;
  if (refresh) {
    await db
      .update(device_sessions)
      .set({ revoked_at: new Date() })
      .where(eq(device_sessions.refresh_token_hash, hashSecret(refresh)))
      .catch(() => undefined);
  }

  clearAuthCookies(res);

  const wantsJson =
    req.xhr ||
    typeof req.headers["x-requested-with"] === "string" ||
    (req.headers.accept ?? "").includes("application/json");
  if (wantsJson) {
    ok(res, { stopped: true });
    return;
  }
  // Native form POST -> redirect the browser to a clean re-login.
  res.redirect(303, "/admin/login");
});

router.use(requireAuth, requireAdminPanel);
router.use(adminResourcesRouter);
router.use(adminModulesRouter);
router.use(adminCoursesRouter);
router.use(adminStaffingRouter);
router.use("/library", adminLibraryRouter);
router.use("/team", adminTeamRouter);

/** Returns a Drizzle condition limiting `column` to the user's scope, or undefined for unrestricted. */


/* POST /v1/admin/impersonate/:userId — start impersonating another account.
 *
 * super_admin ONLY. Mints a real session for the SUBJECT (so every downstream
 * request is authorised exactly as that user would be) and points the auth
 * cookies at them, then flags the session as an impersonation so AdminLayout
 * renders the ImpersonationBanner. A super_admin may not impersonate another
 * super_admin (no lateral privilege grab). Audited as a config_change against
 * the originating admin, with the subject recorded in metadata.
 *
 * This route is below the router-level requireAuth/requireAdminPanel guards, so
 * it is reachable only by a current admin-panel user; requireRole then narrows
 * to super_admin. The matching /impersonate/stop is registered ABOVE those
 * guards (see top of file) because the live cookie session during impersonation
 * is the SUBJECT — who may be a parent/student with no admin-panel access — so
 * stop authenticates off the impersonation cookie, not the subject's role.
 */
router.post("/impersonate/:userId", requireRole("super_admin"), async (req: Request, res: Response) => {
  const targetId = String(req.params.userId);
  if (!UUID_RE.test(targetId)) {
    fail(res, 404, "ERR_NOT_FOUND", "User not found.");
    return;
  }
  if (targetId === req.authUser!.id) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "You cannot impersonate yourself.");
    return;
  }

  const [target] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, targetId), isNull(users.deleted_at)))
    .limit(1);
  if (!target || !target.is_active) {
    fail(res, 404, "ERR_NOT_FOUND", "User not found.");
    return;
  }
  // A super_admin must not be able to assume another super_admin's identity.
  if (target.role === "super_admin") {
    fail(res, 403, "ERR_FORBIDDEN", "You cannot impersonate another super admin.");
    return;
  }

  // Mint a genuine subject session: every later request authorises as the
  // subject via requireAuth, so impersonation can never exceed their grants.
  const access = signAccessToken(target.id);
  const refresh = generateRefreshToken();
  await db.insert(device_sessions).values({
    user_id: target.id,
    device_id: `impersonation:${req.authUser!.id}`,
    platform: "web",
    refresh_token_hash: refresh.hash,
    expires_at: refresh.expiresAt,
    last_used_at: new Date(),
  });

  const subject = toSessionUser(target);
  setAuthCookies(res, subject, access.token, access.expiresAt, refresh.token, refresh.expiresAt);
  setImpersonationCookies(res, req.authUser!.full_name, req.authUser!.id, refresh.expiresAt);

  // TWO audit entries (CLAUDE.md impersonation rule): one on the admin's own
  // trail, one on the subject's — both identities' histories must show it.
  await auditFromReq(req, {
    action: "config_change",
    entityKind: "impersonation",
    entityId: target.id,
    summary: `Started impersonating ${target.full_name} (${target.role}).`,
    metadata: { subject_id: target.id, subject_role: target.role },
  });
  await writeAudit({
    actorId: target.id,
    actorRole: target.role as Role,
    action: "config_change",
    entityKind: "impersonation",
    entityId: req.authUser!.id,
    summary: `Session impersonated by ${req.authUser!.full_name} (super_admin).`,
    metadata: { impersonator_id: req.authUser!.id },
    ip: req.ip ?? null,
  });

  ok(res, {
    user: subject,
    tokens: {
      access_token: access.token,
      refresh_token: refresh.token,
      access_expires_at: access.expiresAt.toISOString(),
      refresh_expires_at: refresh.expiresAt.toISOString(),
    },
  });
});

/* GET /v1/admin/analytics/overview */
router.get("/analytics/overview", async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const centreFilter = scopedCentreFilter(scope, students.centre_id);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const centreScope = scopedCentreFilter(scope, centres.id);
  const srCentreFilter = scopedCentreFilter(scope, service_requests.centre_id);
  const enrolmentCentreFilter = scopedCentreFilter(scope, enrolments.requested_centre_id);
  const sinceDate = since.toISOString().slice(0, 10);
  const centreIdsForRate =
    scope.centreIds === null ? null : scope.centreIds.length === 0 ? [] : scope.centreIds;
  const punyaCentreFilter = scopedCentreFilter(scope, students.centre_id);
  const now = new Date();
  const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fyStart = new Date(Date.UTC(fyStartYear, 3, 1)); // April 1, 00:00 UTC

  // Every other metric here is centre-scoped. `donations` has no centre_id and
  // no direct city_id (only a nullable campaign_id → donation_campaigns.city_id),
  // so this sum cannot be narrowed to a sanchalak's centres. Rather than return
  // the NATIONAL total to a scoped caller — leaking past the city_admin gate the
  // /admin/donations page draws on purpose — the figure is withheld and the
  // query skipped for roles outside DONATION_VIEW_ROLES.
  const showDonations = canViewDonations(req.authUser!.role as Role);

  const [
    [activeStudents],
    [centreCount],
    [openReq],
    [pendingEnrol],
    [msvActive],
    attendanceRateRaw,
    [punyaRow],
    [donationRow],
  ] = await Promise.all([
    db
      .select({ n: count() })
      .from(students)
      .where(and(eq(students.status, "active"), isNull(students.deleted_at), centreFilter)),
    db
      .select({ n: count() })
      .from(centres)
      .where(and(eq(centres.status, "active"), isNull(centres.deleted_at), centreScope)),
    // Open unassigned inbox — submitted/in_review with no assignee (badge source).
    db
      .select({ n: count() })
      .from(service_requests)
      .where(
        and(
          inArray(service_requests.status, ["submitted", "in_review"]),
          isNull(service_requests.assigned_to),
          srCentreFilter,
        ),
      ),
    // Pending enrolments queue — distinct from open_service_requests (do not conflate).
    db
      .select({ n: count() })
      .from(enrolments)
      .where(and(eq(enrolments.status, "pending"), enrolmentCentreFilter)),
    db
      .select({ n: count() })
      .from(students)
      .where(and(eq(students.msv_status, "approved"), isNull(students.deleted_at), centreFilter)),
    centreIdsForRate && centreIdsForRate.length === 0
      ? Promise.resolve(0)
      : getCentresAttendanceRate(centreIdsForRate, sinceDate, null),
    db
      .select({ sum: sql<number>`coalesce(sum(${punya_transactions.points}),0)::int` })
      .from(punya_transactions)
      .innerJoin(students, eq(students.id, punya_transactions.student_id))
      .where(
        and(gte(punya_transactions.created_at, since), isNull(students.deleted_at), punyaCentreFilter),
      ),
    showDonations
      ? db
          .select({ sum: sql<number>`coalesce(sum(${donations.amount_paise}),0)::bigint` })
          .from(donations)
          .where(
            and(
              eq(donations.payment_status, "captured"),
              gte(donations.payment_captured_at, fyStart),
            ),
          )
      : Promise.resolve([] as Array<{ sum: number }>),
  ]);

  const attendanceRate =
    centreIdsForRate && centreIdsForRate.length === 0
      ? 0
      : rateToPercent1(attendanceRateRaw as number);

  ok(res, {
    active_students: activeStudents?.n ?? 0,
    centres: centreCount?.n ?? 0,
    open_service_requests: openReq?.n ?? 0,
    pending_enrolments: pendingEnrol?.n ?? 0,
    attendance_rate_30d: attendanceRate,
    punya_awarded_30d: Number(punyaRow?.sum ?? 0),
    msv_active: msvActive?.n ?? 0,
    ...(showDonations
      ? { donations_total_paise_ytd: Number(donationRow?.sum ?? 0) }
      : {}),
  });
  void msv_enrolments;
});

/**
 * GET /v1/admin/analytics/engagement-trend?months=6
 * Monthly attendance + homework completion from mv_centre_engagement (F4).
 * Scope-aggregated: average of centre rates in scope per month.
 */
router.get("/analytics/engagement-trend", async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const monthsRaw = Number(req.query.months ?? 6);
  const months = Number.isFinite(monthsRaw) ? Math.min(24, Math.max(1, Math.floor(monthsRaw))) : 6;

  const centresSql =
    scope.centreIds === null
      ? sql`null::uuid[]`
      : sql`array[${sql.join(
          scope.centreIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}]::uuid[]`;

  const result = await db.execute(sql`
    select
      month::text as month,
      avg(attendance_rate)::float8 as attendance_rate,
      avg(homework_completion_rate)::float8 as homework_completion_rate
    from mv_centre_engagement
    where (${centresSql} is null or centre_id = any(${centresSql}))
      and month >= (date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date
                    - ((${months}::int - 1) * interval '1 month'))::date
    group by month
    order by month asc
  `);
  const rows =
    (result as unknown as {
      rows?: Array<{
        month: string;
        attendance_rate: number | null;
        homework_completion_rate: number | null;
      }>;
    }).rows ?? [];

  ok(res, {
    items: rows.map((r) => ({
      month: String(r.month).slice(0, 10),
      attendance_rate:
        r.attendance_rate == null ? null : Math.round(Number(r.attendance_rate) * 1000) / 10,
      homework_completion_rate:
        r.homework_completion_rate == null
          ? null
          : Math.round(Number(r.homework_completion_rate) * 1000) / 10,
    })),
  }, { count: rows.length });
});

/** Escape %/_/\ so a typed query cannot widen the ILIKE pattern. */
function escapeIlike(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function encodeStudentCursor(fullName: string, id: string): string {
  return Buffer.from(`${fullName}\0${id}`, "utf8").toString("base64url");
}

function decodeStudentCursor(raw: unknown): { fullName: string; id: string } | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const i = decoded.indexOf("\0");
    if (i < 0) return null;
    const fullName = decoded.slice(0, i);
    const id = decoded.slice(i + 1);
    if (!fullName || !UUID_RE.test(id)) return null;
    return { fullName, id };
  } catch {
    return null;
  }
}

/* GET /v1/admin/students?q=&status=&batch_id=&cursor=&limit= */
router.get("/students", async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const limit = clampLimit(req.query.limit, 50, 200);
  const centreFilter = scopedCentreFilter(scope, students.centre_id);
  // Shikshak: students in assigned batches only (progress / roster picks).
  // Centre membership alone would list every child at their tagged centres.
  const batchFilter = scopedBatchFilter(scope, students.batch_id);

  let statusFilter;
  const statusRaw = typeof req.query.status === "string" ? req.query.status.trim() : "";
  if (statusRaw) {
    const parsed = studentStatusSchema.safeParse(statusRaw);
    if (!parsed.success) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Unknown status filter.");
      return;
    }
    statusFilter = eq(students.status, parsed.data);
  }

  let batchEq;
  const batchIdRaw = typeof req.query.batch_id === "string" ? req.query.batch_id.trim() : "";
  if (batchIdRaw) {
    if (!UUID_RE.test(batchIdRaw)) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "batch_id must be a UUID.");
      return;
    }
    const [batch] = await db
      .select({ id: batches.id, centre_id: batches.centre_id })
      .from(batches)
      .where(and(eq(batches.id, batchIdRaw), isNull(batches.deleted_at)))
      .limit(1);
    if (!batch || !inBatchWriteScope(scope, batch.id, batch.centre_id)) {
      fail(res, 404, "ERR_NOT_FOUND", "Batch not found in your scope.");
      return;
    }
    batchEq = eq(students.batch_id, batch.id);
  }

  let searchFilter;
  const qRaw = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (qRaw) {
    const pattern = `%${escapeIlike(qRaw.slice(0, 80))}%`;
    searchFilter = or(ilike(students.full_name, pattern), ilike(students.student_code, pattern));
  }

  const cursor = decodeStudentCursor(req.query.cursor);
  const cursorFilter = cursor
    ? or(
        gt(students.full_name, cursor.fullName),
        and(eq(students.full_name, cursor.fullName), gt(students.id, cursor.id)),
      )
    : undefined;

  const rows = await db
    .select({
      id: students.id,
      full_name: students.full_name,
      student_code: students.student_code,
      age_group: students.age_group,
      dob: students.dob,
      msv_status: students.msv_status,
      status: students.status,
      batch_id: students.batch_id,
      centre_id: students.centre_id,
      batch_name: batches.name,
      centre_name: centres.name,
    })
    .from(students)
    .leftJoin(batches, eq(batches.id, students.batch_id))
    .leftJoin(centres, eq(centres.id, students.centre_id))
    .where(
      and(
        isNull(students.deleted_at),
        centreFilter,
        batchFilter,
        statusFilter,
        batchEq,
        searchFilter,
        cursorFilter,
      ),
    )
    .orderBy(asc(students.full_name), asc(students.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last ? encodeStudentCursor(last.full_name, last.id) : null;

  ok(res, { items: page, next_cursor: nextCursor }, { count: page.length });
});

/* GET /v1/admin/students/:id — dossier (contact + identity) for shikshak/admin. */
router.get("/students/:id", async (req: Request, res: Response) => {
  const studentId = String(req.params.id);
  if (!UUID_RE.test(studentId)) {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found in your scope.");
    return;
  }
  const scope = await resolveAdminScope(req.authUser!);
  const parentUser = alias(users, "parent_user");
  const studentUser = alias(users, "student_user");

  const [row] = await db
    .select({
      id: students.id,
      full_name: students.full_name,
      student_code: students.student_code,
      age_group: students.age_group,
      dob: students.dob,
      msv_status: students.msv_status,
      status: students.status,
      blood_group: students.blood_group,
      photo_url: students.photo_url,
      centre_id: students.centre_id,
      batch_id: students.batch_id,
      guardian_relation: students.guardian_relation,
      parent_id: students.parent_id,
      batch_name: batches.name,
      centre_name: centres.name,
      parent_full_name: parentUser.full_name,
      parent_phone: parentUser.phone,
      parent_email: parentUser.email,
      student_phone: studentUser.phone,
    })
    .from(students)
    .leftJoin(batches, eq(batches.id, students.batch_id))
    .leftJoin(centres, eq(centres.id, students.centre_id))
    .leftJoin(parentUser, eq(parentUser.id, students.parent_id))
    .leftJoin(studentUser, eq(studentUser.id, students.user_id))
    .where(and(eq(students.id, studentId), isNull(students.deleted_at)))
    .limit(1);

  if (!row || !inBatchWriteScope(scope, row.batch_id, row.centre_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found in your scope.");
    return;
  }

  ok(res, {
    id: row.id,
    full_name: row.full_name.trim(),
    student_code: row.student_code,
    age_group: row.age_group,
    dob: row.dob,
    msv_status: row.msv_status,
    status: row.status,
    blood_group: row.blood_group,
    photo_url: row.photo_url ? signUploadUrl(row.photo_url) : null,
    centre_id: row.centre_id,
    batch_id: row.batch_id,
    batch_name: row.batch_name,
    centre_name: row.centre_name,
    student_phone: row.student_phone ?? null,
    parent: row.parent_id
      ? {
          full_name: row.parent_full_name,
          phone: row.parent_phone,
          email: row.parent_email,
          relation: row.guardian_relation,
        }
      : null,
  });
});

/* GET /v1/admin/students/:id/punya — balance + recent ledger for in-scope student. */
router.get("/students/:id/punya", async (req: Request, res: Response) => {
  const studentId = String(req.params.id);
  if (!UUID_RE.test(studentId)) {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found in your scope.");
    return;
  }
  const scope = await resolveAdminScope(req.authUser!);
  const [student] = await db
    .select({
      id: students.id,
      batch_id: students.batch_id,
      centre_id: students.centre_id,
    })
    .from(students)
    .where(and(eq(students.id, studentId), isNull(students.deleted_at)))
    .limit(1);
  if (!student || !inBatchWriteScope(scope, student.batch_id, student.centre_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found in your scope.");
    return;
  }

  const [balance] = await db
    .select({ total_points: punya_balances.total_points, tier: punya_balances.tier })
    .from(punya_balances)
    .where(eq(punya_balances.student_id, studentId))
    .limit(1);

  const txns = await db
    .select({
      id: punya_transactions.id,
      feature_key: punya_transactions.feature_key,
      points: punya_transactions.points,
      note: punya_transactions.note,
      created_at: punya_transactions.created_at,
    })
    .from(punya_transactions)
    .where(eq(punya_transactions.student_id, studentId))
    .orderBy(desc(punya_transactions.created_at))
    .limit(50);

  ok(res, {
    total_points: balance?.total_points ?? 0,
    tier: balance?.tier ?? "jigyasu",
    transactions: txns.map((t) => ({ ...t, created_at: t.created_at.toISOString() })),
  });
});

/* POST /v1/admin/students/:id/status */
router.post("/students/:id/status", async (req: Request, res: Response) => {
  let body: z.infer<typeof studentStatusActionSchema>;
  try {
    body = studentStatusActionSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid action.");
    return;
  }
  const studentId = String(req.params.id);
  if (!UUID_RE.test(studentId)) {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found in your scope.");
    return;
  }
  const scope = await resolveAdminScope(req.authUser!);
  const [student] = await db
    .select()
    .from(students)
    .where(and(eq(students.id, studentId), isNull(students.deleted_at)))
    .limit(1);
  if (!student || !inScope(scope, student.centre_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found in your scope.");
    return;
  }
  const nextStatus = body.action === "deactivate" ? "inactive" : "active";
  await db
    .update(students)
    .set({
      status: nextStatus,
      deactivated_at: body.action === "deactivate" ? new Date() : null,
    })
    .where(eq(students.id, student.id));
  // The reason the admin typed was silently discarded and the action never
  // audited (SAN-ERR-02) — a Q11 deactivation with no trail of why.
  await auditFromReq(req, {
    action: "update",
    entityKind: "student",
    entityId: student.id,
    summary:
      body.action === "deactivate"
        ? `Deactivated student ${student.student_code}${body.reason ? ` — ${body.reason.trim()}` : ""}`
        : `Reactivated student ${student.student_code}`,
    metadata: { action: body.action, reason: body.reason?.trim() || null },
  });
  ok(res, { id: student.id, status: nextStatus });
});

/* GET /v1/admin/batches */
router.get("/batches", async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const centreFilter = scopedCentreFilter(scope, batches.centre_id);
  // Shikshak: assigned batches only (homework setup, roster picks). Centre
  // membership alone would list every batch at their tagged centres.
  const batchFilter = scopedBatchFilter(scope, batches.id);

  const primaryUser = users;
  const rows = await db
    .select({
      id: batches.id,
      name: batches.name,
      centre_id: batches.centre_id,
      centre_name: centres.name,
      age_groups: batches.age_groups,
      shikshak_name: primaryUser.full_name,
      day_of_week: batches.day_of_week,
      start_time: batches.start_time,
      end_time: batches.end_time,
      status: batches.status,
    })
    .from(batches)
    .innerJoin(centres, eq(centres.id, batches.centre_id))
    .leftJoin(
      shikshak_batch_assignments,
      and(
        eq(shikshak_batch_assignments.batch_id, batches.id),
        eq(shikshak_batch_assignments.is_active, true),
        eq(shikshak_batch_assignments.is_primary, true),
      ),
    )
    .leftJoin(primaryUser, eq(primaryUser.id, shikshak_batch_assignments.user_id))
    .where(and(isNull(batches.deleted_at), centreFilter, batchFilter))
    .orderBy(asc(centres.name), asc(batches.name));

  ok(res, { items: rows }, { count: rows.length });
});

/**
 * GET /v1/admin/batches/:batchId/punya-standings?month=YYYY-MM
 *
 * Per-student Punya standings for one batch. The Guruji's answer to "how is my
 * class doing this month" — the mobile screen app/shikshak/punya.tsx has been
 * calling this since it shipped, but the route was never written, so it 404'd.
 *
 * Q12 — batch-bound: a shikshak sees only batches they are assigned to;
 * sanchalak+ resolve to centre membership via inBatchWriteScope. 404 rather
 * than 403 throughout, matching the rest of the module (no existence leak).
 *
 * One query, window functions, no N+1.
 */
router.get("/batches/:batchId/punya-standings", async (req: Request, res: Response) => {
  const batchId = String(req.params.batchId);
  if (!UUID_RE.test(batchId)) {
    fail(res, 404, "ERR_NOT_FOUND", "Batch not found.");
    return;
  }

  const [batch] = await db
    .select({ id: batches.id, name: batches.name, centre_id: batches.centre_id })
    .from(batches)
    .where(eq(batches.id, batchId))
    .limit(1);

  const scope = await resolveAdminScope(req.authUser!);
  if (!batch || !inBatchWriteScope(scope, batch.id, batch.centre_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Batch not found.");
    return;
  }

  // Default to the current Asia/Kolkata month — the platform's calendar.
  const monthRaw = typeof req.query.month === "string" ? req.query.month.trim() : "";
  if (monthRaw && !/^\d{4}-\d{2}$/.test(monthRaw)) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "month must be YYYY-MM.");
    return;
  }
  const month =
    monthRaw ||
    new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
    }).slice(0, 7);
  const monthStart = `${month}-01`;

  const result = await db.execute(sql`
    with month_window as (
      select
        ${monthStart}::date as start_date,
        (${monthStart}::date + interval '1 month')::date as end_date
    ),
    roster as (
      select
        st.id, st.full_name, st.student_code, st.age_group,
        coalesce(pb.total_points, 0)::int as total_points,
        coalesce(pb.tier, 'jigyasu')::text as tier
      from students st
      left join punya_balances pb on pb.student_id = st.id
      -- Q11: deactivated students keep their history but leave the roster.
      where st.batch_id = ${batchId}::uuid
        and st.deleted_at is null
        and st.status = 'active'
    ),
    month_tx as (
      select
        pt.student_id,
        pt.feature_key,
        sum(pt.points)::int as points
      from punya_transactions pt
      cross join month_window w
      where pt.student_id in (select id from roster)
        and pt.created_at >= w.start_date
        and pt.created_at < w.end_date
      -- SUM, not a filter: reversals are negative rows and must net off.
      group by pt.student_id, pt.feature_key
    ),
    month_totals as (
      select student_id,
             sum(points)::int as month_points,
             jsonb_object_agg(feature_key, points) as by_source
      from month_tx
      group by student_id
    )
    select
      r.id as student_id,
      r.full_name,
      r.student_code,
      r.age_group,
      r.total_points,
      r.tier,
      dense_rank() over (order by r.total_points desc)::int as rank,
      coalesce(mt.month_points, 0)::int as month_points,
      coalesce(mt.by_source, '{}'::jsonb) as by_source
    from roster r
    left join month_totals mt on mt.student_id = r.id
    order by rank asc, r.full_name asc
  `);

  type Row = {
    student_id: string;
    full_name: string;
    student_code: string | null;
    age_group: string | null;
    total_points: number;
    tier: string;
    rank: number;
    month_points: number;
    by_source: Record<string, number> | null;
  };
  const rows = ((result as unknown as { rows?: Row[] }).rows ?? []).map((r) => ({
    ...r,
    by_source: r.by_source ?? {},
  }));

  const batchTotal = rows.reduce((sum, r) => sum + r.total_points, 0);
  const tierCounts: Record<string, number> = {};
  const bySourceTotals: Record<string, number> = {};
  for (const r of rows) {
    tierCounts[r.tier] = (tierCounts[r.tier] ?? 0) + 1;
    for (const [key, value] of Object.entries(r.by_source)) {
      bySourceTotals[key] = (bySourceTotals[key] ?? 0) + Number(value);
    }
  }

  ok(res, {
    items: rows,
    meta: {
      batch_id: batch.id,
      batch_name: batch.name,
      month,
      student_count: rows.length,
      batch_total: batchTotal,
      batch_average: rows.length > 0 ? Math.round(batchTotal / rows.length) : 0,
      tier_counts: tierCounts,
      by_source: bySourceTotals,
    },
  });
});

const patchTimetableSchema = z.object({
  day_of_week: z.array(z.number().int().min(1).max(7)).optional(),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
});

/* PATCH /v1/admin/batches/:id/timetable — AT9 rematerialise */
router.patch("/batches/:id/timetable", async (req: Request, res: Response) => {
  let body: z.infer<typeof patchTimetableSchema>;
  try {
    body = patchTimetableSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid timetable payload.");
    return;
  }
  if (!body.day_of_week && !body.start_time && !body.end_time) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Provide day_of_week and/or times.");
    return;
  }
  const batchId = String(req.params.id);
  const scope = await resolveAdminScope(req.authUser!);
  const [batch] = await db
    .select()
    .from(batches)
    .where(and(eq(batches.id, batchId), isNull(batches.deleted_at)))
    .limit(1);
  if (!batch || !inScope(scope, batch.centre_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Batch not found in your scope.");
    return;
  }
  await db
    .update(batches)
    .set({
      ...(body.day_of_week ? { day_of_week: body.day_of_week } : {}),
      ...(body.start_time ? { start_time: body.start_time } : {}),
      ...(body.end_time ? { end_time: body.end_time } : {}),
    })
    .where(eq(batches.id, batch.id));

  const { rematerialiseBatch } = await import("../../services/session-materialise");
  const result = await rematerialiseBatch(batch.id);
  ok(res, { batch_id: batch.id, ...result });
});

/* POST /v1/admin/sessions/materialise — manual trigger (ops / demos) */
router.post("/sessions/materialise", async (req: Request, res: Response) => {
  const role = req.authUser!.role;
  if (!["super_admin", "state_admin", "city_admin", "sanchalak"].includes(role)) {
    fail(res, 403, "ERR_FORBIDDEN", "Not allowed to trigger materialise.");
    return;
  }
  const { materialiseAllActiveBatches } = await import("../../services/session-materialise");
  const result = await materialiseAllActiveBatches();
  ok(res, result);
});

/* POST /v1/admin/batches/:id/:action */
router.post("/batches/:id/:action", async (req: Request, res: Response) => {
  const action = String(req.params.action);
  if (action !== "activate" && action !== "deactivate") {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Unknown action.");
    return;
  }
  const batchId = String(req.params.id);
  if (!UUID_RE.test(batchId)) {
    fail(res, 404, "ERR_NOT_FOUND", "Batch not found in your scope.");
    return;
  }
  const scope = await resolveAdminScope(req.authUser!);
  const [batch] = await db
    .select()
    .from(batches)
    .where(and(eq(batches.id, batchId), isNull(batches.deleted_at)))
    .limit(1);
  if (!batch || !inScope(scope, batch.centre_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Batch not found in your scope.");
    return;
  }
  if (action === "activate") {
    const [primary] = await db
      .select({ id: shikshak_batch_assignments.id })
      .from(shikshak_batch_assignments)
      .where(
        and(
          eq(shikshak_batch_assignments.batch_id, batch.id),
          eq(shikshak_batch_assignments.is_active, true),
          eq(shikshak_batch_assignments.is_primary, true),
        ),
      )
      .limit(1);
    if (!primary) {
      fail(res, 422, "ERR_NO_PRIMARY", "Assign a primary shikshak before activating this batch.");
      return;
    }
  }
  const nextStatus = action === "activate" ? "active" : "inactive";
  await db.update(batches).set({ status: nextStatus }).where(eq(batches.id, batch.id));
  ok(res, { id: batch.id, status: nextStatus });
});

/* GET /v1/admin/enrolments?status=&limit= */
function decodeEnrolmentCursor(raw: unknown): { ts: Date; id: string } | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const [tsIso, id] = Buffer.from(raw, "base64url").toString("utf8").split("|");
    if (!tsIso || !id || !UUID_RE.test(id)) return null;
    const ts = new Date(tsIso);
    if (!Number.isFinite(ts.getTime())) return null;
    return { ts, id };
  } catch {
    return null;
  }
}

router.get("/enrolments", async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const limit = clampLimit(req.query.limit, 100, 500);
  const statusParam = req.query.status;
  let statusFilter;
  if (typeof statusParam === "string" && statusParam.length > 0) {
    const parsed = enrolmentStatusSchema.safeParse(statusParam);
    if (!parsed.success) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Unknown status filter.");
      return;
    }
    statusFilter = eq(enrolments.status, parsed.data);
  }
  const centreFilter = scopedCentreFilter(scope, enrolments.requested_centre_id);
  // Keyset cursor (SAN-PRF-03) — the list used to end silently at the limit.
  const cursor = decodeEnrolmentCursor(req.query.cursor);
  const cursorFilter = cursor
    ? or(
        lt(enrolments.created_at, cursor.ts),
        and(eq(enrolments.created_at, cursor.ts), lt(enrolments.id, cursor.id)),
      )
    : undefined;

  const reqCentre = centres;
  const reqBatch = batches;
  const rows = await db
    .select({
      id: enrolments.id,
      created_at: enrolments.created_at,
      decided_at: enrolments.decided_at,
      requested_centre_id: enrolments.requested_centre_id,
      requested_batch_id: enrolments.requested_batch_id,
      status: enrolments.status,
      student_name: students.full_name,
      student_code: students.student_code,
      centre_name: reqCentre.name,
      batch_name: reqBatch.name,
    })
    .from(enrolments)
    .innerJoin(students, eq(students.id, enrolments.student_id))
    .innerJoin(reqCentre, eq(reqCentre.id, enrolments.requested_centre_id))
    .innerJoin(reqBatch, eq(reqBatch.id, enrolments.requested_batch_id))
    .where(and(statusFilter, isNull(students.deleted_at), centreFilter, cursorFilter))
    .orderBy(desc(enrolments.created_at), desc(enrolments.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const items = page.map((r) => ({
    ...r,
    created_at: r.created_at.toISOString(),
    decided_at: r.decided_at ? r.decided_at.toISOString() : null,
  }));
  ok(
    res,
    { items },
    {
      count: items.length,
      has_more: hasMore,
      next_cursor:
        hasMore && last
          ? Buffer.from(`${last.created_at.toISOString()}|${last.id}`, "utf8").toString("base64url")
          : null,
    },
  );
});

/* POST /v1/admin/enrolments/:id/:action  (approve|waitlist|reject) */
router.post("/enrolments/:id/:action", async (req: Request, res: Response) => {
  const action = String(req.params.action);
  const map: Record<string, "approved" | "waitlisted" | "rejected"> = {
    approve: "approved",
    waitlist: "waitlisted",
    reject: "rejected",
  };
  const nextStatus = map[action];
  if (!nextStatus) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Unknown action.");
    return;
  }
  let body: z.infer<typeof enrolmentActionSchema>;
  try {
    body = enrolmentActionSchema.parse(req.body ?? {});
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid body.");
    return;
  }
  if (nextStatus === "rejected") {
    const reason = body.reason?.trim() ?? "";
    // The reason is shown to the parent — a 1-character "x" reaching a family
    // is worse than no rejection at all (SAN-API-03). Same bounds as the
    // mobile dialog (REJECT_REASON_MIN/MAX).
    if (reason.length < 10) {
      fail(
        res,
        422,
        "ERR_VALIDATION_FAILED",
        "Write a reason of at least 10 characters — the parent will read it.",
      );
      return;
    }
    body = { ...body, reason };
  }

  const enrolmentId = String(req.params.id);
  if (!UUID_RE.test(enrolmentId)) {
    fail(res, 404, "ERR_NOT_FOUND", "Enrolment not found in your scope.");
    return;
  }
  const scope = await resolveAdminScope(req.authUser!);
  const [enrolment] = await db.select().from(enrolments).where(eq(enrolments.id, enrolmentId)).limit(1);
  if (!enrolment || !inScope(scope, enrolment.requested_centre_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Enrolment not found in your scope.");
    return;
  }

  const gate = canTransitionEnrolment(enrolment.status, nextStatus);
  if (!gate.ok) {
    fail(res, 409, "ERR_INVALID_TRANSITION", gate.reason);
    return;
  }

  // Flip the enrolment, and on approval enforce batch capacity + attach the
  // student — all atomically so the capacity count can't be raced past the seat
  // limit. Mirrors the capacity guard in the create-with-auto_approve path.
  const result = await db.transaction(async (tx) => {
    if (nextStatus === "approved") {
      // Resolve the requested batch's seat limit, then count students already
      // occupying an active seat in it.
      const [batch] = await tx
        .select({ capacity: batches.capacity })
        .from(batches)
        .where(eq(batches.id, enrolment.requested_batch_id))
        .limit(1);
      const [attached] = await tx
        .select({ n: count() })
        .from(students)
        .where(
          and(
            eq(students.batch_id, enrolment.requested_batch_id),
            eq(students.status, "active"),
            isNull(students.deleted_at),
          ),
        );
      if (batch && (attached?.n ?? 0) >= batch.capacity) {
        return { kind: "full" as const };
      }
    }

    await tx
      .update(enrolments)
      .set({
        status: nextStatus,
        reason: body.reason ?? null,
        decided_by: req.authUser!.id,
        decided_at: new Date(),
      })
      .where(eq(enrolments.id, enrolment.id));

    // On approval, attach the student to the requested centre/batch and activate.
    if (nextStatus === "approved") {
      await tx
        .update(students)
        .set({
          centre_id: enrolment.requested_centre_id,
          batch_id: enrolment.requested_batch_id,
          status: "active",
        })
        .where(eq(students.id, enrolment.student_id));
      await materialiseHomeworkForStudentBatch(
        enrolment.student_id,
        enrolment.requested_batch_id,
        tx,
      );
    }

    return { kind: "done" as const };
  });

  if (result.kind === "full") {
    fail(res, 409, "ERR_BATCH_FULL", "This batch has no remaining capacity.");
    return;
  }

  const auditAction = nextStatus === "approved" ? "approve" : nextStatus === "rejected" ? "reject" : "update";
  await auditFromReq(req, {
    action: auditAction,
    entityKind: "enrolment",
    entityId: enrolment.id,
    summary: `Enrolment ${nextStatus}.`,
    metadata: { student_id: enrolment.student_id, status: nextStatus, reason: body.reason ?? null },
  });

  ok(res, { id: enrolment.id, status: nextStatus });
});


export default router;
