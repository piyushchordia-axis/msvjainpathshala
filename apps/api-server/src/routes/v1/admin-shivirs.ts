/**
 * /v1/admin/shivirs/:id/{volunteers,export} — SPEC 6.14.
 *
 * Volunteer assignment is the piece the whole module was waiting on.
 * `shivir_volunteers` had no writer anywhere in the repo, so the "registered
 * volunteer" arm of every authorization check was unreachable dead code and the
 * only people who could scan were admin-panel accounts. The persona the module
 * is named for could not exist.
 *
 * Mounted under /v1/admin (which already applies requireAuth + requireAdminPanel);
 * this router narrows further per SPEC 6.14 — assignment is city_admin+ and
 * sanchalak, export is city_admin+.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  shivir_attendance_scans,
  shivir_registrations,
  shivir_sessions,
  shivir_volunteers,
  students,
  users,
} from "@workspace/db";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { requireShivirAdmin, requireShivirOps } from "../../middlewares/auth";
import { auditFromReq } from "../../lib/audit";
import { cityIdsForUser } from "../../lib/scope";
import { cityInScope, getShivir, type ShivirRef } from "../../lib/shivir-access";
import { buildRoster } from "./shivir-scanner";

const router: IRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function shivirInScope(req: Request, res: Response, id: string): Promise<ShivirRef | null> {
  if (!UUID_RE.test(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Shivir not found.");
    return null;
  }
  const cityIds = await cityIdsForUser(req.authUser!);
  const shivir = await getShivir(id);
  if (!shivir || !cityInScope(cityIds, shivir.city_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Shivir not found.");
    return null;
  }
  return shivir;
}

/* ─────────────────────────── Volunteers ─────────────────────────── */

const assignVolunteerSchema = z.object({
  user_id: z.string().uuid(),
  role_label: z.string().max(120).optional(),
});

/* GET /v1/admin/shivirs/:id/volunteers */
router.get("/shivirs/:id/volunteers", requireShivirOps, async (req: Request, res: Response) => {
  const shivir = await shivirInScope(req, res, String(req.params.id));
  if (!shivir) return;

  const rows = await db
    .select({
      id: shivir_volunteers.id,
      user_id: shivir_volunteers.user_id,
      full_name: users.full_name,
      role: users.role,
      phone: users.phone,
      role_label: shivir_volunteers.role_label,
      assigned_at: shivir_volunteers.assigned_at,
      revoked_at: shivir_volunteers.revoked_at,
    })
    .from(shivir_volunteers)
    .innerJoin(users, eq(users.id, shivir_volunteers.user_id))
    .where(eq(shivir_volunteers.shivir_id, shivir.id))
    // Live assignments first, then the revoked history beneath them.
    .orderBy(asc(shivir_volunteers.revoked_at), desc(shivir_volunteers.assigned_at));

  const items = rows.map((r) => ({
    ...r,
    assigned_at: r.assigned_at.toISOString(),
    revoked_at: r.revoked_at?.toISOString() ?? null,
    is_active: r.revoked_at === null,
  }));
  ok(res, { items }, { count: items.length });
});

/* POST /v1/admin/shivirs/:id/volunteers */
router.post("/shivirs/:id/volunteers", requireShivirOps, async (req: Request, res: Response) => {
  let body: z.infer<typeof assignVolunteerSchema>;
  try {
    body = assignVolunteerSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid volunteer data.");
    return;
  }
  const shivir = await shivirInScope(req, res, String(req.params.id));
  if (!shivir) return;

  const [target] = await db
    .select({ id: users.id, full_name: users.full_name, is_active: users.is_active })
    .from(users)
    .where(and(eq(users.id, body.user_id), isNull(users.deleted_at)))
    .limit(1);
  if (!target || !target.is_active) {
    fail(res, 404, "ERR_NOT_FOUND", "That user was not found.");
    return;
  }

  // Re-assigning someone previously revoked clears the revocation rather than
  // stacking a second row, so the partial unique index stays satisfied and the
  // volunteer keeps one continuous record on this shivir.
  const [existing] = await db
    .select({ id: shivir_volunteers.id, revoked_at: shivir_volunteers.revoked_at })
    .from(shivir_volunteers)
    .where(
      and(eq(shivir_volunteers.shivir_id, shivir.id), eq(shivir_volunteers.user_id, body.user_id)),
    )
    .orderBy(desc(shivir_volunteers.assigned_at))
    .limit(1);

  let volunteerId: string;
  if (existing && existing.revoked_at === null) {
    fail(res, 409, "ERR_DUPLICATE", "They are already a volunteer for this shivir.");
    return;
  } else if (existing) {
    await db
      .update(shivir_volunteers)
      .set({
        revoked_at: null,
        assigned_by: req.authUser!.id,
        assigned_at: new Date(),
        role_label: body.role_label ?? null,
        updated_at: new Date(),
      })
      .where(eq(shivir_volunteers.id, existing.id));
    volunteerId = existing.id;
  } else {
    const [row] = await db
      .insert(shivir_volunteers)
      .values({
        shivir_id: shivir.id,
        user_id: body.user_id,
        role_label: body.role_label ?? null,
        assigned_by: req.authUser!.id,
      })
      .returning({ id: shivir_volunteers.id });
    volunteerId = row!.id;
  }

  await auditFromReq(req, {
    action: "create",
    entityKind: "shivir_volunteer",
    entityId: volunteerId,
    summary: `Assigned ${target.full_name} as a volunteer on "${shivir.name_en}".`,
    metadata: { shivir_id: shivir.id, user_id: body.user_id, role_label: body.role_label ?? null },
  });

  ok(res, { id: volunteerId, user_id: body.user_id });
});

/* DELETE /v1/admin/shivirs/:id/volunteers/:userId — revoke, never delete. */
router.delete(
  "/shivirs/:id/volunteers/:userId",
  requireShivirOps,
  async (req: Request, res: Response) => {
    const shivir = await shivirInScope(req, res, String(req.params.id));
    if (!shivir) return;
    const userId = String(req.params.userId);
    if (!UUID_RE.test(userId)) {
      fail(res, 404, "ERR_NOT_FOUND", "That volunteer was not found.");
      return;
    }

    const [existing] = await db
      .select({ id: shivir_volunteers.id })
      .from(shivir_volunteers)
      .where(
        and(
          eq(shivir_volunteers.shivir_id, shivir.id),
          eq(shivir_volunteers.user_id, userId),
          isNull(shivir_volunteers.revoked_at),
        ),
      )
      .limit(1);
    if (!existing) {
      fail(res, 404, "ERR_NOT_FOUND", "That volunteer was not found.");
      return;
    }

    // Revoked, not deleted: the scans they recorded still reference them and an
    // audit has to be able to answer who could act, and when.
    await db
      .update(shivir_volunteers)
      .set({ revoked_at: new Date(), updated_at: new Date() })
      .where(eq(shivir_volunteers.id, existing.id));

    await auditFromReq(req, {
      action: "delete",
      entityKind: "shivir_volunteer",
      entityId: existing.id,
      summary: `Revoked a volunteer on "${shivir.name_en}".`,
      metadata: { shivir_id: shivir.id, user_id: userId },
    });

    ok(res, { id: existing.id });
  },
);

/* ─────────────────────────── Registrations (admin view) ─────────────────────────── */

/* GET /v1/admin/shivirs/:id/registrations */
router.get("/shivirs/:id/registrations", requireShivirOps, async (req: Request, res: Response) => {
  const shivir = await shivirInScope(req, res, String(req.params.id));
  if (!shivir) return;

  const rows = await db
    .select({
      id: shivir_registrations.id,
      student_id: shivir_registrations.student_id,
      full_name: students.full_name,
      student_code: students.student_code,
      status: shivir_registrations.status,
      registered_at: shivir_registrations.registered_at,
      cancelled_at: shivir_registrations.cancelled_at,
    })
    .from(shivir_registrations)
    .innerJoin(students, eq(students.id, shivir_registrations.student_id))
    .where(eq(shivir_registrations.shivir_id, shivir.id))
    .orderBy(asc(students.full_name));

  const items = rows.map((r) => ({
    ...r,
    registered_at: r.registered_at.toISOString(),
    cancelled_at: r.cancelled_at?.toISOString() ?? null,
  }));
  ok(res, { items }, { count: items.length });
});

/* ─────────────────────────── Export (SPEC 6.14) ─────────────────────────── */

/** RFC 4180 — quote everything, double any embedded quote. */
function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(",");
}

/*
 * GET /v1/admin/shivirs/:id/export?format=csv|pdf&session_id=
 *
 * Synchronous rather than a report.generation job: a shivir is hundreds of scans
 * over a few days, not a month of a whole centre's attendance, so a durable job
 * row and a signed-URL round trip would be pure overhead.
 */
router.get("/shivirs/:id/export", requireShivirAdmin, async (req: Request, res: Response) => {
  const shivir = await shivirInScope(req, res, String(req.params.id));
  if (!shivir) return;

  const format = req.query.format === "pdf" ? "pdf" : "csv";
  const sessionId =
    typeof req.query.session_id === "string" && UUID_RE.test(req.query.session_id)
      ? req.query.session_id
      : null;

  const scans = await db
    .select({
      scanned_at: shivir_attendance_scans.scanned_at,
      scan_kind: shivir_attendance_scans.scan_kind,
      was_registered: shivir_attendance_scans.was_registered,
      device_offline: shivir_attendance_scans.device_offline,
      session_title: shivir_sessions.title,
      session_date: shivir_sessions.session_date,
      student_code: students.student_code,
      full_name: students.full_name,
      volunteer_name: users.full_name,
    })
    .from(shivir_attendance_scans)
    .innerJoin(shivir_sessions, eq(shivir_sessions.id, shivir_attendance_scans.shivir_session_id))
    .innerJoin(students, eq(students.id, shivir_attendance_scans.student_id))
    .leftJoin(users, eq(users.id, shivir_attendance_scans.volunteer_user_id))
    .where(
      and(
        eq(shivir_attendance_scans.shivir_id, shivir.id),
        sessionId ? eq(shivir_attendance_scans.shivir_session_id, sessionId) : undefined,
      ),
    )
    .orderBy(asc(shivir_sessions.session_date), asc(shivir_attendance_scans.scanned_at));

  const safeName = shivir.name_en.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60) || "shivir";

  if (format === "csv") {
    const lines = [
      csvRow([
        "Session date",
        "Session",
        "Student code",
        "Student",
        "Scan",
        "Scanned at",
        "Registered",
        "Source",
        "Recorded by",
      ]),
      ...scans.map((s) =>
        csvRow([
          s.session_date,
          s.session_title,
          s.student_code,
          s.full_name,
          s.scan_kind,
          s.scanned_at.toISOString(),
          s.was_registered ? "registered" : "walk-in",
          s.device_offline ? "offline" : "online",
          s.volunteer_name ?? "",
        ]),
      ),
    ];
    // BOM so Excel on a Windows machine opens Devanagari names correctly rather
    // than as mojibake — the whole point of exporting a roster is reading names.
    const body = "﻿" + lines.join("\r\n") + "\r\n";
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}-attendance.csv"`);
    res.send(body);
    return;
  }

  const roster = await buildRoster(shivir.id, sessionId, 2000);
  const { buildShivirAttendancePdf } = await import("../../lib/shivir-export-pdf");
  const pdf = await buildShivirAttendancePdf({
    shivirName: shivir.name_en,
    startDate: shivir.start_date,
    endDate: shivir.end_date,
    roster,
    scanCount: scans.length,
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}-attendance.pdf"`);
  res.send(pdf);
});

export default router;
