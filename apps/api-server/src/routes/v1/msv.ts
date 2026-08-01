/**
 * /v1/msv — Megh Sanskar Vatika (MSV) programme workflow.
 *
 * Persona side (parent/student): apply for a child and view their MSV state.
 * Admin side: list applications in the caller's centre scope and approve/reject.
 *
 * All routes require authentication. Persona routes verify the caller owns the
 * student (via parent_id or user_id). Admin routes additionally require the
 * admin panel and scope-guard each enrolment by its student's centre (404 out
 * of scope). Setting students.msv_status mirrors the latest decision so the
 * student record stays the single source of truth for badges/cards.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, msv_enrolments, students, centres, curricula } from "@workspace/db";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth, requireAdminPanel } from "../../middlewares/auth";
import { resolveAdminScope, type AdminScope } from "../../lib/scope";
import { auditFromReq } from "../../lib/audit";
import { clampLimit, inScope, scopedCentreFilter } from "../../lib/route-helpers";

const router: IRouter = Router();
router.use(requireAuth);


/** Resolve a student the caller owns (parent of, or is, that student). */
async function ownedStudent(req: Request, id: string) {
  const uid = req.authUser!.id;
  const [row] = await db
    .select({ id: students.id, centre_id: students.centre_id, msv_status: students.msv_status })
    .from(students)
    .where(and(eq(students.id, id), or(eq(students.parent_id, uid), eq(students.user_id, uid))))
    .limit(1);
  return row ?? null;
}

/**
 * An approved MSV student maps to the MSV-track curriculum (curricula.kind='msv').
 * The curriculum is city-scoped: pick the active MSV curriculum for the student's
 * city, falling back to a city-agnostic (city_id is null) active MSV curriculum.
 * Returns a map student_id -> {id,name,academic_year} for the supplied students;
 * students that aren't approved (or have no matching curriculum) are omitted.
 */
async function msvCurriculumByStudent(
  rows: Array<{ id: string; centre_id: string | null; msv_status: string }>,
): Promise<Map<string, { id: string; name: string; academic_year: string | null }>> {
  const approved = rows.filter((r) => r.msv_status === "approved");
  const out = new Map<string, { id: string; name: string; academic_year: string | null }>();
  if (approved.length === 0) return out;

  // City per student (centre -> city). Students without a centre fall back to the
  // city-agnostic MSV curriculum below.
  const centreIds = [...new Set(approved.map((r) => r.centre_id).filter((c): c is string => !!c))];
  const centreCity = new Map<string, string>();
  if (centreIds.length) {
    const cRows = await db
      .select({ id: centres.id, city_id: centres.city_id })
      .from(centres)
      .where(inArray(centres.id, centreIds));
    for (const c of cRows) if (c.city_id) centreCity.set(c.id, c.city_id);
  }

  // Active MSV-track curricula, indexed by city (null city = city-agnostic fallback).
  const msvCurricula = await db
    .select({
      id: curricula.id,
      name: curricula.name,
      city_id: curricula.city_id,
      academic_year: curricula.academic_year,
    })
    .from(curricula)
    .where(and(eq(curricula.kind, "msv"), eq(curricula.status, "active")));

  const byCity = new Map<string, { id: string; name: string; academic_year: string | null }>();
  let fallback: { id: string; name: string; academic_year: string | null } | null = null;
  for (const c of msvCurricula) {
    const entry = { id: c.id, name: c.name, academic_year: c.academic_year };
    if (c.city_id) {
      if (!byCity.has(c.city_id)) byCity.set(c.city_id, entry);
    } else if (!fallback) {
      fallback = entry;
    }
  }

  for (const r of approved) {
    const cityId = r.centre_id ? centreCity.get(r.centre_id) : undefined;
    const curriculum = (cityId && byCity.get(cityId)) || fallback;
    if (curriculum) out.set(r.id, curriculum);
  }
  return out;
}

/* ═══════════════════════════ PERSONA — apply / view ═══════════════════════════ */

const applySchema = z.object({
  student_id: z.string().uuid(),
});

/* POST /v1/msv/apply — parent/student applies for the MSV programme */
router.post("/apply", async (req: Request, res: Response) => {
  let body: z.infer<typeof applySchema>;
  try {
    body = applySchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid application data.");
    return;
  }

  const student = await ownedStudent(req, body.student_id);
  if (!student) {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found.");
    return;
  }

  // Serialize concurrent applies for the same student so the duplicate check and
  // the insert/update happen atomically (no check-then-insert race). The advisory
  // lock is held until the transaction commits.
  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${student.id}::text, 0))`,
    );

    // Reject duplicate applications: an active enrolment is one already applied or
    // approved (waitlisted/rejected/revoked may re-apply).
    const [active] = await tx
      .select({ id: msv_enrolments.id })
      .from(msv_enrolments)
      .where(
        and(
          eq(msv_enrolments.student_id, student.id),
          inArray(msv_enrolments.status, ["applied", "approved"]),
        ),
      )
      .limit(1);
    if (active) return { duplicate: true as const };

    // Invariant self-heal: students.msv_status mirrors the latest enrolment, so a
    // student already marked applied/approved MUST have a matching enrolment row.
    // If a legacy desync left the student row "ahead" of msv_enrolments (e.g. a
    // historical seed marked msv_status='approved' with no row), backfill the row
    // instead of inserting a fresh "applied" row — that would silently downgrade an
    // approved student. We backfill and report 409 (an application is already active).
    if (student.msv_status === "applied" || student.msv_status === "approved") {
      await tx
        .insert(msv_enrolments)
        .values({ student_id: student.id, status: student.msv_status });
      return { duplicate: true as const };
    }

    const [row] = await tx
      .insert(msv_enrolments)
      .values({ student_id: student.id, status: "applied" })
      .returning({ id: msv_enrolments.id, status: msv_enrolments.status });

    await tx.update(students).set({ msv_status: "applied" }).where(eq(students.id, student.id));

    return { duplicate: false as const, row };
  });

  if (result.duplicate) {
    fail(res, 409, "ERR_ALREADY_APPLIED", "An MSV application is already active for this student.");
    return;
  }

  ok(res, { id: result.row.id, status: result.row.status });
});

/* GET /v1/msv/mine — the caller's children with their MSV status + latest enrolment */
router.get("/mine", async (req: Request, res: Response) => {
  const uid = req.authUser!.id;
  const kids = await db
    .select({
      id: students.id,
      full_name: students.full_name,
      student_code: students.student_code,
      centre_id: students.centre_id,
      msv_status: students.msv_status,
    })
    .from(students)
    .where(or(eq(students.parent_id, uid), eq(students.user_id, uid)))
    .orderBy(students.full_name);

  const ids = kids.map((k) => k.id);
  const enrolments = ids.length
    ? await db
        .select({
          id: msv_enrolments.id,
          student_id: msv_enrolments.student_id,
          status: msv_enrolments.status,
          reason: msv_enrolments.reason,
          created_at: msv_enrolments.created_at,
          decided_at: msv_enrolments.decided_at,
        })
        .from(msv_enrolments)
        .where(inArray(msv_enrolments.student_id, ids))
        .orderBy(desc(msv_enrolments.created_at))
    : [];

  // First row per student is the latest (rows are ordered created_at desc).
  const latestByStudent = new Map<string, (typeof enrolments)[number]>();
  for (const e of enrolments) {
    if (!latestByStudent.has(e.student_id)) latestByStudent.set(e.student_id, e);
  }

  // Approved students map to the MSV-track curriculum (curricula.kind='msv').
  const curriculumByStudent = await msvCurriculumByStudent(kids);

  const items = kids.map((k) => {
    const latest = latestByStudent.get(k.id);
    const curriculum = curriculumByStudent.get(k.id) ?? null;
    return {
      id: k.id,
      full_name: k.full_name,
      student_code: k.student_code,
      msv_status: k.msv_status,
      latest_enrolment: latest
        ? {
            id: latest.id,
            status: latest.status,
            reason: latest.reason,
            created_at: latest.created_at.toISOString(),
            decided_at: latest.decided_at ? latest.decided_at.toISOString() : null,
          }
        : null,
      // The MSV curriculum an approved student is enrolled into (null otherwise).
      msv_curriculum: curriculum,
    };
  });

  ok(res, { items }, { count: items.length });
});

/* ═══════════════════════════ ADMIN — list / decide ═══════════════════════════ */

const STATUSES = ["none", "applied", "waitlisted", "approved", "rejected", "revoked"] as const;
const listQuerySchema = z.object({
  status: z.enum(STATUSES).optional(),
});

/* GET /v1/msv?status=&limit= — scoped list of MSV applications */
router.get("/", requireAdminPanel, async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid query parameters.");
    return;
  }
  const scope = await resolveAdminScope(req.authUser!);
  const limit = clampLimit(req.query.limit, 100, 300);
  const centreFilter = scopedCentreFilter(scope, students.centre_id);
  const statusFilter = parsed.data.status
    ? eq(msv_enrolments.status, parsed.data.status)
    : undefined;

  const rows = await db
    .select({
      id: msv_enrolments.id,
      student_id: msv_enrolments.student_id,
      student_name: students.full_name,
      student_code: students.student_code,
      centre_name: centres.name,
      status: msv_enrolments.status,
      reason: msv_enrolments.reason,
      created_at: msv_enrolments.created_at,
      decided_at: msv_enrolments.decided_at,
    })
    .from(msv_enrolments)
    .innerJoin(students, eq(students.id, msv_enrolments.student_id))
    .leftJoin(centres, eq(centres.id, students.centre_id))
    .where(and(centreFilter, statusFilter))
    .orderBy(desc(msv_enrolments.created_at))
    .limit(limit);

  const items = rows.map((r) => ({
    ...r,
    created_at: r.created_at.toISOString(),
    decided_at: r.decided_at ? r.decided_at.toISOString() : null,
  }));
  ok(res, { items }, { count: items.length });
});

/** Load an enrolment + its student's centre, scope-guarded (null when out of scope). */
async function scopedEnrolment(req: Request, id: string) {
  const scope = await resolveAdminScope(req.authUser!);
  const [row] = await db
    .select({
      id: msv_enrolments.id,
      student_id: msv_enrolments.student_id,
      status: msv_enrolments.status,
      centre_id: students.centre_id,
    })
    .from(msv_enrolments)
    .innerJoin(students, eq(students.id, msv_enrolments.student_id))
    .where(eq(msv_enrolments.id, id))
    .limit(1);
  if (!row || !inScope(scope, row.centre_id)) return null;
  return row;
}

const approveSchema = z.object({
  note: z.string().max(1000).optional(),
});

/* POST /v1/msv/:id/approve — approve an application */
router.post("/:id/approve", requireAdminPanel, async (req: Request, res: Response) => {
  let body: z.infer<typeof approveSchema>;
  try {
    body = approveSchema.parse(req.body ?? {});
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid approval data.");
    return;
  }

  const id = String(req.params.id);
  const enrolment = await scopedEnrolment(req, id);
  if (!enrolment) {
    fail(res, 404, "ERR_NOT_FOUND", "MSV application not found.");
    return;
  }

  // Only an undecided application is decidable; reject re-deciding so we never
  // desync students.msv_status from an already-final enrolment.
  if (enrolment.status !== "applied" && enrolment.status !== "waitlisted") {
    fail(res, 409, "ERR_INVALID_STATE", "MSV application is not in a decidable state.");
    return;
  }

  // Claim the decision atomically: conditional update only fires while the row is
  // still decidable, and both writes commit together. If the claim loses the race
  // (already decided concurrently) -> 409.
  const claimed = await db.transaction(async (tx) => {
    const rows = await tx
      .update(msv_enrolments)
      .set({
        status: "approved",
        reason: body.note ?? null,
        decided_by: req.authUser!.id,
        decided_at: new Date(),
      })
      .where(
        and(
          eq(msv_enrolments.id, enrolment.id),
          inArray(msv_enrolments.status, ["applied", "waitlisted"]),
        ),
      )
      .returning({ id: msv_enrolments.id });
    if (rows.length === 0) return false;

    await tx
      .update(students)
      .set({ msv_status: "approved" })
      .where(eq(students.id, enrolment.student_id));
    return true;
  });

  if (!claimed) {
    fail(res, 409, "ERR_INVALID_STATE", "MSV application is not in a decidable state.");
    return;
  }

  await auditFromReq(req, {
    action: "approve",
    entityKind: "msv_enrolment",
    entityId: enrolment.id,
    summary: "MSV application approved.",
    metadata: { student_id: enrolment.student_id, note: body.note ?? null },
  });

  ok(res, { id: enrolment.id, status: "approved" });
});

const rejectSchema = z.object({
  reason: z.string().max(1000).optional(),
});

/* POST /v1/msv/:id/reject — reject an application */
router.post("/:id/reject", requireAdminPanel, async (req: Request, res: Response) => {
  let body: z.infer<typeof rejectSchema>;
  try {
    body = rejectSchema.parse(req.body ?? {});
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid rejection data.");
    return;
  }

  const id = String(req.params.id);
  const enrolment = await scopedEnrolment(req, id);
  if (!enrolment) {
    fail(res, 404, "ERR_NOT_FOUND", "MSV application not found.");
    return;
  }

  // Only an undecided application is decidable; reject re-deciding so we never
  // desync students.msv_status from an already-final enrolment.
  if (enrolment.status !== "applied" && enrolment.status !== "waitlisted") {
    fail(res, 409, "ERR_INVALID_STATE", "MSV application is not in a decidable state.");
    return;
  }

  // Claim the decision atomically: conditional update only fires while the row is
  // still decidable, and both writes commit together. If the claim loses the race
  // (already decided concurrently) -> 409.
  const claimed = await db.transaction(async (tx) => {
    const rows = await tx
      .update(msv_enrolments)
      .set({
        status: "rejected",
        reason: body.reason ?? null,
        decided_by: req.authUser!.id,
        decided_at: new Date(),
      })
      .where(
        and(
          eq(msv_enrolments.id, enrolment.id),
          inArray(msv_enrolments.status, ["applied", "waitlisted"]),
        ),
      )
      .returning({ id: msv_enrolments.id });
    if (rows.length === 0) return false;

    await tx
      .update(students)
      .set({ msv_status: "rejected" })
      .where(eq(students.id, enrolment.student_id));
    return true;
  });

  if (!claimed) {
    fail(res, 409, "ERR_INVALID_STATE", "MSV application is not in a decidable state.");
    return;
  }

  await auditFromReq(req, {
    action: "reject",
    entityKind: "msv_enrolment",
    entityId: enrolment.id,
    summary: "MSV application rejected.",
    metadata: { student_id: enrolment.student_id, reason: body.reason ?? null },
  });

  ok(res, { id: enrolment.id, status: "rejected" });
});

export default router;
