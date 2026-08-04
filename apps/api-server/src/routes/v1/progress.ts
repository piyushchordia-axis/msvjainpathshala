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
  centres,
  curricula,
  curriculum_sections,
  curriculum_items,
  student_curriculum_progress,
  progress_reports,
} from "@workspace/db";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth, requireAdminPanel } from "../../middlewares/auth";
import { resolveAdminScope, type AdminScope } from "../../lib/scope";
import { auditFromReq } from "../../lib/audit";
import { storage, makeKey } from "../../lib/storage";
import { signUploadUrl } from "../../lib/file-tokens";
import { PdfBuilder } from "../../lib/pdf";
import { inScope, scopedCentreFilter } from "../../lib/route-helpers";
import { getStudentHomeworkCompletionRate } from "../../lib/homework-completion-rate";

const router: IRouter = Router();
router.use(requireAuth);


const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CURRICULUM_LEVELS = ["not_started", "in_progress", "completed", "mastered"] as const;

/**
 * Monthly reports use period_label = YYYY-MM. Other labels leave the window open
 * (null from/to) so the canonical SQL function still returns a rate when homework exists.
 */
function periodDateRange(
  periodLabel: string,
): { from: string | null; to: string | null } {
  const m = /^(\d{4})-(\d{2})$/.exec(periodLabel.trim());
  if (!m) return { from: null, to: null };
  const y = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return { from: null, to: null };
  const from = `${m[1]}-${m[2]}-01`;
  const lastDay = new Date(Date.UTC(y, month, 0)).getUTCDate();
  const to = `${m[1]}-${m[2]}-${String(lastDay).padStart(2, "0")}`;
  return { from, to };
}

type HomeworkSnapshot = {
  completion_rate: number | null;
  /** True when rate is null — no assignments due in the period. */
  no_homework_set: boolean;
  starred_count: number;
  by_status: Record<string, number>;
  label_en: string;
  label_hi: string;
  summary_en: string;
  summary_hi: string;
};

async function buildHomeworkSnapshot(
  studentId: string,
  periodLabel: string,
): Promise<HomeworkSnapshot> {
  const { from, to } = periodDateRange(periodLabel);
  const rate = await getStudentHomeworkCompletionRate(studentId, from, to);

  const statusRows = await db.execute(sql`
    select hs.status::text as status, count(*)::int as n
    from homework_submissions hs
    inner join homework_assignments ha on ha.id = hs.assignment_id
    where hs.student_id = ${studentId}::uuid
      and ha.deleted_at is null
      and (${from}::date is null or ha.due_date >= ${from}::date)
      and (${to}::date is null or ha.due_date <= ${to}::date)
    group by hs.status
  `);
  const statusList =
    (statusRows as unknown as { rows?: Array<{ status: string; n: number }> }).rows ?? [];
  const by_status: Record<string, number> = {};
  let starred_count = 0;
  for (const r of statusList) {
    by_status[r.status] = Number(r.n);
    if (r.status === "starred") starred_count = Number(r.n);
  }

  const no_homework_set = rate == null;
  const pct =
    rate == null ? null : Math.round(rate * 1000) / 10; /* one decimal percent */

  const summary_en = no_homework_set
    ? "No homework set for this period."
    : `Completion ${pct}% — ${starred_count} starred.`;
  const summary_hi = no_homework_set
    ? "इस अवधि में कोई गृहकार्य नहीं दिया गया।"
    : `पूर्णता ${pct}% — ${starred_count} सितारा।`;

  return {
    completion_rate: rate,
    no_homework_set,
    starred_count,
    by_status,
    label_en: "Homework",
    label_hi: "गृहकार्य",
    summary_en,
    summary_hi,
  };
}

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

/** The city of a student via their centre, or null (no centre / unassigned). */
async function cityForStudent(centreId: string | null): Promise<string | null> {
  if (!centreId) return null;
  const [row] = await db
    .select({ city_id: centres.city_id })
    .from(centres)
    .where(eq(centres.id, centreId))
    .limit(1);
  return row?.city_id ?? null;
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

    let itemFilter;
    if (curriculumId) {
      // Explicit curriculum: confirm it is relevant to this student's city
      // (or city-agnostic / central) before returning its items — a curriculum
      // from another city must not be readable through this student.
      const [curriculum] = await db
        .select({ id: curricula.id, city_id: curricula.city_id })
        .from(curricula)
        .where(eq(curricula.id, curriculumId))
        .limit(1);
      const studentCity = await cityForStudent(student.centre_id);
      const relevant =
        curriculum &&
        (curriculum.city_id === null || curriculum.city_id === studentCity);
      if (!relevant) {
        ok(res, { items: [] }, { count: 0 });
        return;
      }
      itemFilter = eq(curricula.id, curriculumId);
    } else {
      // No curriculum_id: default to curricula relevant to THIS student — their
      // city's curricula plus city-agnostic / central ones. This closes the
      // cross-curriculum leak where a missing filter returned items from EVERY
      // curriculum across all cities & tracks.
      const studentCity = await cityForStudent(student.centre_id);
      itemFilter = studentCity
        ? or(isNull(curricula.city_id), eq(curricula.city_id, studentCity))
        : isNull(curricula.city_id);
    }

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

    // F5 — homework block via F4 SQL function (never recompute the rate in TS).
    // §8.14 also names attendance % and niyam streaks — those remain absent from
    // this snapshot; this commit only adds homework.
    const homework = await buildHomeworkSnapshot(student.id, body.period_label);
    const snapshot = {
      items: snapshotItems,
      homework,
      generated_at: new Date().toISOString(),
    };

    // Render the PDF (PdfBuilder is English-first / WinAnsi; bilingual copy lives
    // in the snapshot for parents and a future Hindi-capable renderer).
    const pdf = await PdfBuilder.create();
    pdf
      .title("Progress Report")
      .keyValue("Student", student.full_name)
      .keyValue("Student code", student.student_code)
      .keyValue("Period", `${body.period_kind} — ${body.period_label}`)
      .hr()
      .heading("Homework")
      .text(homework.summary_en);
    if (!homework.no_homework_set) {
      const statusLine = Object.entries(homework.by_status)
        .map(([s, n]) => `${s}: ${n}`)
        .join(", ");
      if (statusLine) pdf.text(statusLine);
    }
    pdf.hr().heading("Curriculum progress");
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
    snapshot.generated_at = now.toISOString();
    const [row] = await db
      .insert(progress_reports)
      .values({
        student_id: student.id,
        period_kind: body.period_kind,
        period_label: body.period_label,
        generated_at: now,
        pdf_url: stored.url,
        shikshak_comment: body.shikshak_comment ?? null,
        snapshot,
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
          snapshot,
          updated_at: now,
        },
      })
      .returning({ id: progress_reports.id, pdf_url: progress_reports.pdf_url, snapshot: progress_reports.snapshot });

    await auditFromReq(req, {
      action: "create",
      entityKind: "progress_report",
      entityId: row.id,
      summary: `Generated progress report for ${student.student_code} (${body.period_kind} ${body.period_label}).`,
    });

    // Progress PDFs are long-lived report downloads — override the 1h gallery default.
    ok(res, {
      id: row.id,
      pdf_url: signUploadUrl(row.pdf_url, 7 * 24 * 3600),
      snapshot: row.snapshot,
    });
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
    pdf_url: signUploadUrl(r.pdf_url, 7 * 24 * 3600),
    generated_at: r.generated_at.toISOString(),
  }));
  ok(res, { items }, { count: items.length });
});

export default router;
