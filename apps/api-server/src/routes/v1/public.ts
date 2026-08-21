import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  centres,
  cities,
  states,
  batches,
  msv_enrolments,
  students,
  shivir_events,
  courses,
  course_sections,
  course_subsections,
} from "@workspace/db";
import { and, asc, eq, gte, ilike, isNull, ne, or, sql } from "drizzle-orm";
import { ok, fail } from "../../lib/envelope";
import { clampLimit } from "../../lib/route-helpers";
import { optionalAuth } from "../../middlewares/auth";
import { canAccessAdminPanel, type Role } from "@workspace/api-zod";
import { todayIst } from "../../services/session-materialise";
import { buildLibraryTree, buildLibrarySection, buildLibraryItem } from "../../lib/library-tree";
import { buildLibraryManifest } from "../../lib/library-manifest";

const router: IRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Non-negative integer offset for the public list routes; anything else → 0. */
function parseOffset(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/**
 * The clamps used to truncate silently — centre 201 simply never appeared,
 * with no empty-vs-truncated signal. Every list here now fetches limit+1 and
 * reports { count, has_more, next_offset } so clients can page.
 */
function pageMeta(rows: unknown[], limit: number, offset: number) {
  const hasMore = rows.length > limit;
  return {
    page: rows.slice(0, limit),
    meta: {
      count: Math.min(rows.length, limit),
      has_more: hasMore,
      next_offset: hasMore ? offset + limit : null,
    },
  };
}

/* GET /v1/public/cities?q=&limit=&offset= — catalogue for join / registration pickers */
router.get("/cities", async (req: Request, res: Response) => {
  // Unauthenticated and previously unbounded: the join form downloaded and
  // mounted the whole national catalogue before its first field was usable.
  const limit = clampLimit(req.query.limit, 300, 500);
  const offset = parseOffset(req.query.offset);
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const rows = await db
    .select({
      id: cities.id,
      name: cities.name,
      code: cities.code,
      slug: cities.slug,
      state_name: states.name,
    })
    .from(cities)
    .innerJoin(states, eq(states.id, cities.state_id))
    .where(q ? or(ilike(cities.name, `%${q}%`), ilike(cities.code, `%${q}%`)) : undefined)
    .orderBy(asc(states.name), asc(cities.name))
    .offset(offset)
    .limit(limit + 1);
  const { page, meta } = pageMeta(rows, limit, offset);
  ok(res, { items: page }, meta);
});

/* GET /v1/public/centres?q=&limit=&offset=&city_id= */
router.get("/centres", async (req: Request, res: Response) => {
  // Response size grew linearly with the network, pre-auth, with no back-pressure.
  const limit = clampLimit(req.query.limit, 200, 500);
  const offset = parseOffset(req.query.offset);
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const cityId =
    typeof req.query.city_id === "string" && UUID_RE.test(req.query.city_id)
      ? req.query.city_id
      : null;
  const rows = await db
    .select({
      id: centres.id,
      name: centres.name,
      code: centres.code,
      locality: centres.locality,
      city_id: centres.city_id,
      city_name: cities.name,
      state_name: states.name,
      batch_count: sql<number>`count(${batches.id})::int`,
    })
    .from(centres)
    .innerJoin(cities, eq(cities.id, centres.city_id))
    .innerJoin(states, eq(states.id, centres.state_id))
    .leftJoin(batches, and(eq(batches.centre_id, centres.id), eq(batches.status, "active")))
    .where(
      and(
        eq(centres.status, "active"),
        cityId ? eq(centres.city_id, cityId) : undefined,
        q
          ? or(
              ilike(centres.name, `%${q}%`),
              ilike(centres.code, `%${q}%`),
              ilike(centres.locality, `%${q}%`),
              ilike(cities.name, `%${q}%`),
            )
          : undefined,
      ),
    )
    .groupBy(centres.id, cities.name, states.name)
    .orderBy(asc(states.name), asc(cities.name), asc(centres.name))
    .offset(offset)
    .limit(limit + 1);

  const { page, meta } = pageMeta(rows, limit, offset);
  ok(res, { items: page }, meta);
});

/* GET /v1/public/centres/:id */
router.get("/centres/:id", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Centre not found.");
    return;
  }
  const [centre] = await db
    .select({
      id: centres.id,
      name: centres.name,
      locality: centres.locality,
      pincode: centres.pincode,
      contact_phone: centres.contact_phone,
      contact_email: centres.contact_email,
      city_name: cities.name,
      state_name: states.name,
    })
    .from(centres)
    .innerJoin(cities, eq(cities.id, centres.city_id))
    .innerJoin(states, eq(states.id, centres.state_id))
    .where(and(eq(centres.id, id), eq(centres.status, "active")))
    .limit(1);

  if (!centre) {
    fail(res, 404, "ERR_NOT_FOUND", "Centre not found.");
    return;
  }

  const batchRows = await db
    .select({
      id: batches.id,
      name: batches.name,
      age_groups: batches.age_groups,
      day_of_week: batches.day_of_week,
      start_time: batches.start_time,
      end_time: batches.end_time,
      capacity: batches.capacity,
      language_preference: batches.language_preference,
    })
    .from(batches)
    .where(and(eq(batches.centre_id, id), eq(batches.status, "active")))
    .orderBy(asc(batches.name));

  ok(res, { centre, batches: batchRows });
});

/**
 * Whether the caller may see msv_only shivirs (SPEC 6.14 — guests get public
 * shivirs only).
 *
 * These routes are open by design, so eligibility is resolved from an OPTIONAL
 * token: a guest, or a signed-in parent with no MSV child, sees public shivirs;
 * a parent with an approved MSV child, an MSV student, or any staff member sees
 * everything. Being unauthenticated is never an error here, only a narrower view.
 */
async function callerIsMsvEligible(req: Request): Promise<boolean> {
  const user = req.authUser;
  if (!user) return false;
  if (canAccessAdminPanel(user.role as Role)) return true;

  const [row] = await db
    .select({ id: students.id })
    .from(students)
    .innerJoin(msv_enrolments, eq(msv_enrolments.student_id, students.id))
    .where(
      and(
        or(eq(students.parent_id, user.id), eq(students.user_id, user.id)),
        eq(students.status, "active"),
        isNull(students.deleted_at),
        eq(msv_enrolments.status, "approved"),
      ),
    )
    .limit(1);
  return !!row;
}

/* GET /v1/public/shivirs */
router.get("/shivirs", optionalAuth, async (req: Request, res: Response) => {
  // Previously unbounded — the only public list with no cap at all.
  const limit = clampLimit(req.query.limit, 100, 300);
  const offset = parseOffset(req.query.offset);
  // Asia/Kolkata, not UTC: the UTC day flips at 05:30 IST, so a shivir that
  // ended yesterday stayed listed all morning and one ending today vanished
  // before breakfast.
  const today = todayIst();
  const msvEligible = await callerIsMsvEligible(req);

  const rows = await db
    .select({
      id: shivir_events.id,
      name_en: shivir_events.name_en,
      name_hi: shivir_events.name_hi,
      description_en: shivir_events.description_en,
      description_hi: shivir_events.description_hi,
      start_date: shivir_events.start_date,
      end_date: shivir_events.end_date,
      location_text: shivir_events.location_text,
      capacity: shivir_events.capacity,
      msv_only: shivir_events.msv_only,
      city_name: cities.name,
    })
    .from(shivir_events)
    .innerJoin(cities, eq(cities.id, shivir_events.city_id))
    .where(
      and(
        eq(shivir_events.is_published, true),
        isNull(shivir_events.deleted_at),
        gte(shivir_events.end_date, today),
        // SPEC 6.14: a guest sees public shivirs only. An MSV-only camp was
        // listed to everyone, so families who could never attend one were
        // shown it and had to be turned away by hand.
        msvEligible ? undefined : eq(shivir_events.msv_only, false),
      ),
    )
    .orderBy(asc(shivir_events.start_date), asc(shivir_events.id))
    .offset(offset)
    .limit(limit + 1);

  const { page, meta } = pageMeta(rows, limit, offset);
  ok(res, { items: page }, meta);
});

/* GET /v1/public/shivirs/:id */
router.get("/shivirs/:id", optionalAuth, async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Shivir not found.");
    return;
  }
  const msvEligible = await callerIsMsvEligible(req);
  const [shivir] = await db
    .select({
      id: shivir_events.id,
      name_en: shivir_events.name_en,
      name_hi: shivir_events.name_hi,
      description_en: shivir_events.description_en,
      description_hi: shivir_events.description_hi,
      start_date: shivir_events.start_date,
      end_date: shivir_events.end_date,
      location_text: shivir_events.location_text,
      city_name: cities.name,
      state_name: states.name,
      capacity: shivir_events.capacity,
      msv_only: shivir_events.msv_only,
      attendance_mode: shivir_events.attendance_mode,
      contact_info: shivir_events.contact_info,
      registered_count: sql<number>`(
        select count(*)::int from shivir_registrations r
        where r.shivir_id = ${shivir_events.id} and r.status = 'registered'
      )`,
    })
    .from(shivir_events)
    .innerJoin(cities, eq(cities.id, shivir_events.city_id))
    .innerJoin(states, eq(states.id, cities.state_id))
    .where(
      and(
        eq(shivir_events.id, id),
        eq(shivir_events.is_published, true),
        isNull(shivir_events.deleted_at),
        msvEligible ? undefined : eq(shivir_events.msv_only, false),
      ),
    )
    .limit(1);

  if (!shivir) {
    fail(res, 404, "ERR_NOT_FOUND", "Shivir not found.");
    return;
  }
  ok(res, shivir);
});

/* GET /v1/public/library/manifest — published version maps for guests. */
router.get("/library/manifest", async (_req: Request, res: Response) => {
  const manifest = await buildLibraryManifest({ guestOnly: true });
  ok(res, manifest);
});

/* GET /v1/public/library/sections/:id — one published section (gated = shell). */
router.get("/library/sections/:id", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "That library section could not be found.");
    return;
  }
  const section = await buildLibrarySection(id, { guestOnly: true });
  if (!section) {
    fail(res, 404, "ERR_NOT_FOUND", "That library section could not be found.");
    return;
  }
  ok(res, { section });
});

/* GET /v1/public/library/items/:id — one published item, the deep-link unit
   (GST-PRF-01: a cold-open of one text must not download the whole corpus). */
router.get("/library/items/:id", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "That text could not be found.");
    return;
  }
  const item = await buildLibraryItem(id, { guestOnly: true });
  if (!item) {
    fail(res, 404, "ERR_NOT_FOUND", "That text could not be found.");
    return;
  }
  ok(res, { item });
});

/* GET /v1/public/library — published tree for guests (gated sections as shells). */
router.get("/library", async (_req: Request, res: Response) => {
  const sections = await buildLibraryTree({ guestOnly: true });
  ok(res, { sections }, { count: sections.length });
});

/* GET /v1/public/courses?city_id=&limit=&offset= — active standard catalogue.
 *
 * `city_id` is OPTIONAL and narrows to national + that city, matching the
 * authenticated CU3 predicate in lib/course-visibility.ts. It is deliberately
 * not applied by default: 78 of 88 active standard courses carry a city_id, so
 * defaulting a city-less guest to national-only would hide ~89% of the
 * catalogue. Course names and their city are not sensitive — a guest browsing
 * what exists nationally is the intended behaviour; the filter serves the join
 * flow, which has already asked for a city.
 */
router.get("/courses", async (req: Request, res: Response) => {
  const limit = clampLimit(req.query.limit, 100, 200);
  const offset = parseOffset(req.query.offset);
  const cityIdRaw = typeof req.query.city_id === "string" ? req.query.city_id : "";
  if (cityIdRaw && !UUID_RE.test(cityIdRaw)) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "city_id must be a valid id.");
    return;
  }
  const cityFilter = cityIdRaw
    ? or(isNull(courses.city_id), eq(courses.city_id, cityIdRaw))
    : undefined;
  const rows = await db
    .select({
      id: courses.id,
      name_en: courses.name_en,
      name_hi: courses.name_hi,
      kind: courses.kind,
      academic_year: courses.academic_year,
      // L16 — punya_points dropped from this guest/public payload: it's an
      // internal award value, not catalogue browsing information.
      // Returned so the catalogue can show/filter by city instead of presenting
      // a Mumbai course and a national one as indistinguishable.
      city_id: courses.city_id,
      city_name: cities.name,
    })
    .from(courses)
    .leftJoin(cities, eq(cities.id, courses.city_id))
    // MSV-track curricula are programme-internal (admission is admin discretion,
    // Q1/Q2) — the guest catalogue is the standard track only. Previously every
    // active course of any kind was listed publicly, uncapped.
    .where(
      and(
        eq(courses.status, "active"),
        isNull(courses.deleted_at),
        ne(courses.kind, "msv"),
        cityFilter,
      ),
    )
    .orderBy(asc(courses.name_en), asc(courses.id))
    .offset(offset)
    .limit(limit + 1);
  const { page, meta } = pageMeta(rows, limit, offset);
  ok(res, { items: page }, meta);
});

/* GET /v1/public/courses/:id/tree — outline with all nodes not_started. */
router.get("/courses/:id/tree", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Course not found.");
    return;
  }
  const [course] = await db
    .select()
    .from(courses)
    // MSV curricula are programme-internal (Q2) — hidden from the list above,
    // they must not remain readable by id through this route either.
    .where(
      and(
        eq(courses.id, id),
        eq(courses.status, "active"),
        isNull(courses.deleted_at),
        ne(courses.kind, "msv"),
      ),
    )
    .limit(1);
  if (!course) {
    fail(res, 404, "ERR_NOT_FOUND", "Course not found.");
    return;
  }

  const sections = await db
    .select()
    .from(course_sections)
    .where(and(eq(course_sections.course_id, id), isNull(course_sections.deleted_at)))
    .orderBy(asc(course_sections.order_index));
  const subs = await db
    .select()
    .from(course_subsections)
    .innerJoin(course_sections, eq(course_sections.id, course_subsections.section_id))
    .where(and(eq(course_sections.course_id, id), isNull(course_subsections.deleted_at)))
    .orderBy(asc(course_subsections.order_index));

  ok(res, {
    course: {
      id: course.id,
      name_en: course.name_en,
      name_hi: course.name_hi,
      kind: course.kind,
      academic_year: course.academic_year,
      punya_points: course.punya_points,
    },
    progress: { coverage: null, mastery: null, leaf_total: 0, leaf_reached: 0 },
    sections: sections.map((s) => ({
      id: s.id,
      title_en: s.title_en,
      title_hi: s.title_hi,
      order_index: s.order_index,
      punya_points: s.punya_points,
      status: "not_started" as const,
      certified_at: null,
      certified_by: null,
      certified_by_gender: null,
      derived_status: null,
      derived_leaf_total: 0,
      derived_leaf_reached: 0,
      derived_coverage: null,
      status_diverges: false,
      subsections: subs
        .filter((row) => row.course_subsections.section_id === s.id)
        .map((row) => ({
          id: row.course_subsections.id,
          title_en: row.course_subsections.title_en,
          title_hi: row.course_subsections.title_hi,
          description_en: row.course_subsections.description_en,
          description_hi: row.course_subsections.description_hi,
          order_index: row.course_subsections.order_index,
          status: "not_started" as const,
          certified_at: null,
          certified_by: null,
          certified_by_gender: null,
        })),
    })),
  });
});

export default router;
