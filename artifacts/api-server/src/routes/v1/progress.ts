/**
 * /v1/progress — per-student curriculum progress + generated progress reports.
 *
 * Admin-panel users (shikshak/admins) read & write a student's curriculum
 * progress (level per curriculum item) and generate per-period PDF reports that
 * can be released to the parent. Parents/students may read their OWN released
 * reports. Every read & mutation is centre-scope-guarded (admins) or
 * ownership-guarded (parents/students).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  students,
  curricula,
  curriculum_sections,
  curriculum_items,
  student_curriculum_progress,
  progress_reports,
} from "@workspace/db";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth, requireAdminPanel } from "../../middlewares/auth";
import { resolveAdminScope, type AdminScope } from "../../lib/scope";
import { auditFromReq } from "../../lib/audit";
import { storage, makeKey } from "../../lib/storage";
import { PdfBuilder } from "../../lib/pdf";

const router: IRouter = Router();
router.use(requireAuth);

/* ---- local helpers copy-pasted into every admin route file ---- */
function scopedCentreFilter(scope: AdminScope, column: PgColumn) {
  if (scope.centreIds === null) return undefined;
  if (scope.centreIds.length === 0) return sql`false`;
  return inArray(column, scope.centreIds);
}
function inScope(scope: AdminScope, centreId: string | null): boolean {
  if (scope.centreIds === null) return true;
  if (!centreId) return false;
  return scope.centreIds.includes(centreId);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CURRICULUM_LEVELS = ["not_started", "in_progress", "completed", "mastered"] as const;

/** Fetch a student row (id, name, code, centre) by id, or null if missing. */
async function fetchStudent(id: string) {
  const [row] = await db
    .select({
      id: students.id,
      full_name: students.full_name,
      student_code: students.student_code,
      centre_id: students.centre_id,
    })
    .from(students)
    .where(eq(students.id, id))
    .limit(1);
  return row ?? null;
}

/* ════════════════ shikshak/admin: read a student's progress ════════════════ */

/* GET /v1/progress/students/:id?curriculum_id= — curriculum items left-joined to this student's progress */
router.get(
  "/students/:id",
  requireAdminPanel,
  async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) {
      fail(res, 404, "ERR_NOT_FOUND", "Student not found.");
      return;
    }
    const scope = await resolveAdminScope(req.authUser!);
    const student = await fetchStudent(id);
    if (!student || !inScope(scope, student.centre_id)) {
      fail(res, 404, "ERR_NOT_FOUND", "Student not found in your scope.");
      return;
    }

    const curriculumId =
      typeof req.query.curriculum_id === "string" && UUID_RE.test(req.query.curriculum_id)
        ? req.query.curriculum_id
        : null;

    const itemFilter = curriculumId
      ? eq(curricula.id, curriculumId)
      : undefined;

    const rows = await db
      .select({
        item_id: curriculum_items.id,
        title_en: curriculum_items.title_en,
        title_hi: curriculum_items.title_hi,
        section_title: curriculum_sections.title_en,
        order_index: curriculum_items.order_index,
        section_order: curriculum_sections.order_index,
        level: student_curriculum_progress.level,
        note: student_curriculum_progress.note,
      })
      .from(curriculum_items)
      .innerJoin(
        curriculum_sections,
        eq(curriculum_sections.id, curriculum_items.section_id),
      )
      .innerJoin(curricula, eq(curricula.id, curriculum_sections.curriculum_id))
      .leftJoin(
        student_curriculum_progress,
        and(
          eq(student_curriculum_progress.curriculum_item_id, curriculum_items.id),
          eq(student_curriculum_progress.student_id, student.id),
        ),
      )
      .where(itemFilter)
      .orderBy(asc(curriculum_sections.order_index), asc(curriculum_items.order_index));

    const items = rows.map((r) => ({
      item_id: r.item_id,
      title_en: r.title_en,
      title_hi: r.title_hi,
      section_title: r.section_title,
      level: r.level ?? "not_started",
      note: r.note ?? null,
    }));
    ok(res, { items }, { count: items.length });
  },
);

/* ════════════════ shikshak/admin: set a level for one item ════════════════ */

const setLevelSchema = z.object({
  level: z.enum(CURRICULUM_LEVELS),
  note: z.string().max(1000).optional(),
});

/* POST /v1/progress/students/:id/items/:itemId — upsert this student's level for one curriculum item */
router.post(
  "/students/:id/items/:itemId",
  requireAdminPanel,
  async (req: Request, res: Response) => {
    let body: z.infer<typeof setLevelSchema>;
    try {
      body = setLevelSchema.parse(req.body);
    } catch {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid progress data.");
      return;
    }

    const id = String(req.params.id);
    const itemId = String(req.params.itemId);
    if (!UUID_RE.test(id) || !UUID_RE.test(itemId)) {
      fail(res, 404, "ERR_NOT_FOUND", "Student or item not found.");
      return;
    }

    const scope = await resolveAdminScope(req.authUser!);
    const student = await fetchStudent(id);
    if (!student || !inScope(scope, student.centre_id)) {
      fail(res, 404, "ERR_NOT_FOUND", "Student not found in your scope.");
      return;
    }

    const [item] = await db
      .select({ id: curriculum_items.id })
      .from(curriculum_items)
      .where(eq(curriculum_items.id, itemId))
      .limit(1);
    if (!item) {
      fail(res, 404, "ERR_NOT_FOUND", "Curriculum item not found.");
      return;
    }

    await db
      .insert(student_curriculum_progress)
      .values({
        student_id: student.id,
        curriculum_item_id: item.id,
        level: body.level,
        note: body.note ?? null,
        updated_by: req.authUser!.id,
      })
      .onConflictDoUpdate({
        target: [
          student_curriculum_progress.student_id,
          student_curriculum_progress.curriculum_item_id,
        ],
        set: {
          level: body.level,
          note: body.note ?? null,
          updated_by: req.authUser!.id,
          updated_at: new Date(),
        },
      });

    ok(res, { item_id: item.id, level: body.level });
  },
);

/* ════════════════ shikshak/admin: generate a PDF report ════════════════ */

const createReportSchema = z.object({
  period_kind: z.string().min(1).max(40),
  period_label: z.string().min(1).max(60),
  shikshak_comment: z.string().max(2000).optional(),
});

/* POST /v1/progress/students/:id/reports — snapshot progress, render PDF, upsert report */
router.post(
  "/students/:id/reports",
  requireAdminPanel,
  async (req: Request, res: Response) => {
    let body: z.infer<typeof createReportSchema>;
    try {
      body = createReportSchema.parse(req.body);
    } catch {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid report data.");
      return;
    }

    const id = String(req.params.id);
    if (!UUID_RE.test(id)) {
      fail(res, 404, "ERR_NOT_FOUND", "Student not found.");
      return;
    }
    const scope = await resolveAdminScope(req.authUser!);
    const student = await fetchStudent(id);
    if (!student || !inScope(scope, student.centre_id)) {
      fail(res, 404, "ERR_NOT_FOUND", "Student not found in your scope.");
      return;
    }

    // Build a snapshot of the student's progress rows (joined to item titles).
    const progressRows = await db
      .select({
        item_id: curriculum_items.id,
        title_en: curriculum_items.title_en,
        section_title: curriculum_sections.title_en,
        section_order: curriculum_sections.order_index,
        item_order: curriculum_items.order_index,
        level: student_curriculum_progress.level,
        note: student_curriculum_progress.note,
      })
      .from(student_curriculum_progress)
      .innerJoin(
        curriculum_items,
        eq(curriculum_items.id, student_curriculum_progress.curriculum_item_id),
      )
      .innerJoin(
        curriculum_sections,
        eq(curriculum_sections.id, curriculum_items.section_id),
      )
      .where(eq(student_curriculum_progress.student_id, student.id))
      .orderBy(asc(curriculum_sections.order_index), asc(curriculum_items.order_index));

    const snapshotItems = progressRows.map((r) => ({
      item_id: r.item_id,
      title_en: r.title_en,
      section_title: r.section_title,
      level: r.level,
      note: r.note ?? null,
    }));

    // Render the PDF.
    const pdf = await PdfBuilder.create();
    pdf
      .title("Progress Report")
      .keyValue("Student", student.full_name)
      .keyValue("Student code", student.student_code)
      .keyValue("Period", `${body.period_kind} — ${body.period_label}`)
      .hr()
      .heading("Curriculum progress");
    if (snapshotItems.length === 0) {
      pdf.text("No curriculum progress recorded yet.");
    } else {
      for (const it of snapshotItems) {
        pdf.text(`${it.title_en} — ${it.level}`);
      }
    }
    if (body.shikshak_comment) {
      pdf.hr().heading("Shikshak comment").text(body.shikshak_comment);
    }
    const buf = await pdf.toBuffer();

    const key = makeKey("reports", `${student.student_code}-${body.period_label}.pdf`);
    const stored = await storage.put(key, buf, "application/pdf");

    const now = new Date();
    const [row] = await db
      .insert(progress_reports)
      .values({
        student_id: student.id,
        period_kind: body.period_kind,
        period_label: body.period_label,
        generated_at: now,
        pdf_url: stored.url,
        shikshak_comment: body.shikshak_comment ?? null,
        snapshot: { items: snapshotItems, generated_at: now.toISOString() },
      })
      .onConflictDoUpdate({
        target: [
          progress_reports.student_id,
          progress_reports.period_kind,
          progress_reports.period_label,
        ],
        set: {
          generated_at: now,
          pdf_url: stored.url,
          shikshak_comment: body.shikshak_comment ?? null,
          snapshot: { items: snapshotItems, generated_at: now.toISOString() },
          updated_at: now,
        },
      })
      .returning({ id: progress_reports.id, pdf_url: progress_reports.pdf_url });

    await auditFromReq(req, {
      action: "create",
      entityKind: "progress_report",
      entityId: row.id,
      summary: `Generated progress report for ${student.student_code} (${body.period_kind} ${body.period_label}).`,
    });

    ok(res, { id: row.id, pdf_url: row.pdf_url });
  },
);

/* ════════════════ shikshak/admin: release a report to the parent ════════════════ */

/* POST /v1/progress/reports/:id/release — mark a report released to the parent */
router.post(
  "/reports/:id/release",
  requireAdminPanel,
  async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) {
      fail(res, 404, "ERR_NOT_FOUND", "Report not found.");
      return;
    }
    const scope = await resolveAdminScope(req.authUser!);
    const [report] = await db
      .select({ id: progress_reports.id, centre_id: students.centre_id })
      .from(progress_reports)
      .innerJoin(students, eq(students.id, progress_reports.student_id))
      .where(eq(progress_reports.id, id))
      .limit(1);
    if (!report || !inScope(scope, report.centre_id)) {
      fail(res, 404, "ERR_NOT_FOUND", "Report not found in your scope.");
      return;
    }

    const now = new Date();
    await db
      .update(progress_reports)
      .set({ released_to_parent: true, released_at: now })
      .where(eq(progress_reports.id, report.id));

    await auditFromReq(req, {
      action: "update",
      entityKind: "progress_report",
      entityId: report.id,
      summary: "Released progress report to parent.",
    });

    ok(res, { id: report.id, released: true });
  },
);

/* ════════════════ reports list — admin (all) or owner (released only) ════════════════ */

/* GET /v1/progress/students/:id/reports — owner sees released, in-scope admin sees all */
router.get("/students/:id/reports", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found.");
    return;
  }
  const user = req.authUser!;

  // Is the caller the owner (parent or the student themselves)?
  const [owned] = await db
    .select({ id: students.id })
    .from(students)
    .where(
      and(eq(students.id, id), or(eq(students.parent_id, user.id), eq(students.user_id, user.id))),
    )
    .limit(1);
  const isOwner = Boolean(owned);

  // Is the caller an in-scope admin-panel user?
  let isAdmin = false;
  const ADMIN_ROLES = ["super_admin", "state_admin", "city_admin", "sanchalak", "shikshak"];
  if (ADMIN_ROLES.includes(user.role)) {
    const scope = await resolveAdminScope(user);
    const student = await fetchStudent(id);
    if (student && inScope(scope, student.centre_id)) isAdmin = true;
  }

  if (!isOwner && !isAdmin) {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found.");
    return;
  }

  const releasedOnly = isOwner && !isAdmin;
  const where = releasedOnly
    ? and(
        eq(progress_reports.student_id, id),
        eq(progress_reports.released_to_parent, true),
      )
    : eq(progress_reports.student_id, id);

  const rows = await db
    .select({
      id: progress_reports.id,
      period_kind: progress_reports.period_kind,
      period_label: progress_reports.period_label,
      pdf_url: progress_reports.pdf_url,
      released_to_parent: progress_reports.released_to_parent,
      generated_at: progress_reports.generated_at,
    })
    .from(progress_reports)
    .where(where)
    .orderBy(asc(progress_reports.period_kind), asc(progress_reports.period_label));

  const items = rows.map((r) => ({
    ...r,
    generated_at: r.generated_at.toISOString(),
  }));
  ok(res, { items }, { count: items.length });
});

export default router;
