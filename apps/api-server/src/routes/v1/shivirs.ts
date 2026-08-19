/**
 * /v1/shivirs — the member-facing half of the shivir lifecycle.
 *
 * Registration is the module's core parent action and had no implementation at
 * all: `shivir_registrations` had zero writers repo-wide, so `capacity` was
 * stored and rendered but never enforced, the dashboard's "Registered" figure
 * was structurally 0, and SPEC Step 15's exit criterion ("parents register 50
 * students") was unreachable.
 *
 * Ownership is the shared Q11 rule (ownedStudentsCondition), so a parent may
 * register their own children and a student-view session may register itself —
 * and nobody else can.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  msv_enrolments,
  shivir_events,
  shivir_registrations,
  shivir_sessions,
  shivir_volunteers,
  students,
  cities,
} from "@workspace/db";
import { and, asc, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth } from "../../middlewares/auth";
import { ownedStudentsCondition } from "../../lib/route-helpers";
import { getShivir } from "../../lib/shivir-access";
import { todayIst } from "../../services/session-materialise";

const router: IRouter = Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const registerSchema = z.object({ student_id: z.string().uuid() });

/**
 * GET /v1/shivirs/mine — shivirs the caller volunteers at.
 *
 * The mobile app had no way to tell a volunteer which shivirs they had been
 * assigned to, so the only route to the scanner was Browse → find the shivir →
 * hope the card appears. This is the surface that makes an assignment visible.
 */
router.get("/mine", async (req: Request, res: Response) => {
  const rows = await db
    .select({
      id: shivir_events.id,
      name_en: shivir_events.name_en,
      name_hi: shivir_events.name_hi,
      start_date: shivir_events.start_date,
      end_date: shivir_events.end_date,
      location_text: shivir_events.location_text,
      city_name: cities.name,
      attendance_mode: shivir_events.attendance_mode,
      role_label: shivir_volunteers.role_label,
      session_count: sql<number>`(
        select count(*)::int from shivir_sessions s where s.shivir_id = ${shivir_events.id}
      )`,
    })
    .from(shivir_volunteers)
    .innerJoin(shivir_events, eq(shivir_events.id, shivir_volunteers.shivir_id))
    .innerJoin(cities, eq(cities.id, shivir_events.city_id))
    .where(
      and(
        eq(shivir_volunteers.user_id, req.authUser!.id),
        isNull(shivir_volunteers.revoked_at),
        isNull(shivir_events.deleted_at),
        // Past shivirs stay assigned but drop off the list; the scanner for one
        // that ended a month ago is noise, not a shortcut.
        gte(shivir_events.end_date, todayIst()),
      ),
    )
    .orderBy(asc(shivir_events.start_date));

  ok(res, { items: rows }, { count: rows.length });
});

/**
 * GET /v1/shivirs/:id/registrations/mine — this caller's children's state.
 * Drives the Register / Registered / Cancel CTA on the detail screens.
 */
router.get("/:id/registrations/mine", async (req: Request, res: Response) => {
  const shivirId = String(req.params.id);
  if (!UUID_RE.test(shivirId)) {
    fail(res, 404, "ERR_NOT_FOUND", "Shivir not found.");
    return;
  }
  const shivir = await getShivir(shivirId);
  if (!shivir || !shivir.is_published) {
    fail(res, 404, "ERR_NOT_FOUND", "Shivir not found.");
    return;
  }

  const owned = await db
    .select({
      id: students.id,
      full_name: students.full_name,
      msv_status: students.msv_status,
    })
    .from(students)
    .where(ownedStudentsCondition(req.authUser!.id))
    .orderBy(asc(students.full_name));

  const regs = owned.length
    ? await db
        .select({
          student_id: shivir_registrations.student_id,
          status: shivir_registrations.status,
          registered_at: shivir_registrations.registered_at,
        })
        .from(shivir_registrations)
        .where(eq(shivir_registrations.shivir_id, shivirId))
    : [];
  const byStudent = new Map(regs.map((r) => [r.student_id, r]));

  const [counts] = await db
    .select({ registered: sql<number>`count(*)::int` })
    .from(shivir_registrations)
    .where(
      and(
        eq(shivir_registrations.shivir_id, shivirId),
        eq(shivir_registrations.status, "registered"),
      ),
    );
  const registeredCount = counts?.registered ?? 0;
  const capacity = shivir.capacity;
  const isFull = capacity !== null && registeredCount >= capacity;

  ok(res, {
    shivir_id: shivirId,
    capacity,
    registered_count: registeredCount,
    is_full: isFull,
    // Registration closes when the shivir ends, not when it starts: families
    // arriving on day two of a five-day camp are normal.
    registration_open: shivir.end_date >= todayIst(),
    msv_only: shivir.msv_only,
    students: owned.map((s) => {
      const reg = byStudent.get(s.id);
      return {
        student_id: s.id,
        full_name: s.full_name,
        status: reg?.status === "registered" ? "registered" : "not_registered",
        registered_at: reg?.registered_at?.toISOString() ?? null,
        eligible: !shivir.msv_only || s.msv_status === "approved",
      };
    }),
  });
});

/* POST /v1/shivirs/:id/register */
router.post("/:id/register", async (req: Request, res: Response) => {
  const shivirId = String(req.params.id);
  if (!UUID_RE.test(shivirId)) {
    fail(res, 404, "ERR_NOT_FOUND", "Shivir not found.");
    return;
  }
  let body: z.infer<typeof registerSchema>;
  try {
    body = registerSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Choose which child to register.");
    return;
  }

  const shivir = await getShivir(shivirId);
  if (!shivir || !shivir.is_published) {
    fail(res, 404, "ERR_NOT_FOUND", "Shivir not found.");
    return;
  }
  if (shivir.end_date < todayIst()) {
    fail(res, 409, "ERR_INVALID_STATE", "This shivir has already finished.");
    return;
  }

  const [student] = await db
    .select({ id: students.id, full_name: students.full_name })
    .from(students)
    .where(and(eq(students.id, body.student_id), ownedStudentsCondition(req.authUser!.id)))
    .limit(1);
  if (!student) {
    // 404 not 403 — the caller must not learn whether that student exists.
    fail(res, 404, "ERR_NOT_FOUND", "That student was not found.");
    return;
  }

  if (shivir.msv_only) {
    const [msv] = await db
      .select({ id: msv_enrolments.id })
      .from(msv_enrolments)
      .where(
        and(eq(msv_enrolments.student_id, student.id), eq(msv_enrolments.status, "approved")),
      )
      .limit(1);
    if (!msv) {
      fail(
        res,
        403,
        "ERR_NOT_ELIGIBLE",
        `${student.full_name} is not in the MSV programme — this shivir is for MSV students. Ask your Sanchalak about joining MSV.`,
      );
      return;
    }
  }

  try {
    const result = await db.transaction(async (tx) => {
      // Serialize per shivir so two parents cannot both read "one seat left".
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${shivirId}::text, 0))`);

      const [existing] = await tx
        .select({ id: shivir_registrations.id, status: shivir_registrations.status })
        .from(shivir_registrations)
        .where(
          and(
            eq(shivir_registrations.shivir_id, shivirId),
            eq(shivir_registrations.student_id, student.id),
          ),
        )
        .limit(1);
      if (existing?.status === "registered") {
        return { kind: "duplicate" as const };
      }

      if (shivir.capacity !== null) {
        const [counts] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(shivir_registrations)
          .where(
            and(
              eq(shivir_registrations.shivir_id, shivirId),
              eq(shivir_registrations.status, "registered"),
            ),
          );
        if ((counts?.n ?? 0) >= shivir.capacity) {
          return { kind: "full" as const };
        }
      }

      if (existing) {
        // Reuse the cancelled row so the pair stays unique and the history of
        // this child on this shivir remains one record.
        await tx
          .update(shivir_registrations)
          .set({
            status: "registered",
            cancelled_at: null,
            registered_at: new Date(),
            registered_by_user_id: req.authUser!.id,
            updated_at: new Date(),
          })
          .where(eq(shivir_registrations.id, existing.id));
        return { kind: "ok" as const, id: existing.id };
      }

      const [row] = await tx
        .insert(shivir_registrations)
        .values({
          shivir_id: shivirId,
          student_id: student.id,
          registered_by_user_id: req.authUser!.id,
        })
        .returning({ id: shivir_registrations.id });
      return { kind: "ok" as const, id: row!.id };
    });

    if (result.kind === "duplicate") {
      fail(res, 409, "ERR_ALREADY_REGISTERED", `${student.full_name} is already registered.`);
      return;
    }
    if (result.kind === "full") {
      fail(
        res,
        409,
        "ERR_FULL",
        "This shivir is full. Ask your Sanchalak whether more places will open.",
      );
      return;
    }
    ok(res, { id: result.id, student_id: student.id, status: "registered" });
  } catch {
    fail(res, 409, "ERR_CONFLICT", "That registration could not be saved — please try again.");
  }
});

/* DELETE /v1/shivirs/:id/register/:studentId — cancel, never delete. */
router.delete("/:id/register/:studentId", async (req: Request, res: Response) => {
  const shivirId = String(req.params.id);
  const studentId = String(req.params.studentId);
  if (!UUID_RE.test(shivirId) || !UUID_RE.test(studentId)) {
    fail(res, 404, "ERR_NOT_FOUND", "Registration not found.");
    return;
  }

  const [student] = await db
    .select({ id: students.id })
    .from(students)
    .where(and(eq(students.id, studentId), ownedStudentsCondition(req.authUser!.id)))
    .limit(1);
  if (!student) {
    fail(res, 404, "ERR_NOT_FOUND", "Registration not found.");
    return;
  }

  const [existing] = await db
    .select({ id: shivir_registrations.id, status: shivir_registrations.status })
    .from(shivir_registrations)
    .where(
      and(
        eq(shivir_registrations.shivir_id, shivirId),
        eq(shivir_registrations.student_id, studentId),
      ),
    )
    .limit(1);
  if (!existing || existing.status !== "registered") {
    fail(res, 404, "ERR_NOT_FOUND", "Registration not found.");
    return;
  }

  await db
    .update(shivir_registrations)
    .set({ status: "cancelled", cancelled_at: new Date(), updated_at: new Date() })
    .where(eq(shivir_registrations.id, existing.id));

  ok(res, { id: existing.id, status: "cancelled" });
});

/**
 * GET /v1/shivirs/:id/sessions — the day list for a shivir the caller can see.
 * Public detail needs it to show what the camp actually contains.
 */
router.get("/:id/sessions", async (req: Request, res: Response) => {
  const shivirId = String(req.params.id);
  if (!UUID_RE.test(shivirId)) {
    fail(res, 404, "ERR_NOT_FOUND", "Shivir not found.");
    return;
  }
  const shivir = await getShivir(shivirId);
  if (!shivir || !shivir.is_published) {
    fail(res, 404, "ERR_NOT_FOUND", "Shivir not found.");
    return;
  }
  const rows = await db
    .select({
      id: shivir_sessions.id,
      title: shivir_sessions.title,
      day_number: shivir_sessions.day_number,
      session_date: shivir_sessions.session_date,
      start_time: shivir_sessions.start_time,
      end_time: shivir_sessions.end_time,
    })
    .from(shivir_sessions)
    .where(eq(shivir_sessions.shivir_id, shivirId))
    .orderBy(asc(shivir_sessions.session_date), asc(shivir_sessions.created_at));
  ok(res, { items: rows }, { count: rows.length });
});

export default router;
