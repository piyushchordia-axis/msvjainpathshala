import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  centres,
  cities,
  states,
  batches,
  shivir_events,
  courses,
  course_sections,
  course_subsections,
} from "@workspace/db";
import { and, asc, eq, gte, isNull, sql } from "drizzle-orm";
import { ok, fail } from "../../lib/envelope";
import { buildLibraryTree, buildLibrarySection } from "../../lib/library-tree";
import { buildLibraryManifest } from "../../lib/library-manifest";

const router: IRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* GET /v1/public/cities — catalogue for join / registration pickers */
router.get("/cities", async (_req: Request, res: Response) => {
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
    .orderBy(asc(states.name), asc(cities.name));
  ok(res, { items: rows }, { count: rows.length });
});

/* GET /v1/public/centres */
router.get("/centres", async (_req: Request, res: Response) => {
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
    .where(eq(centres.status, "active"))
    .groupBy(centres.id, cities.name, states.name)
    .orderBy(asc(states.name), asc(cities.name), asc(centres.name));

  ok(res, { items: rows }, { count: rows.length });
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

/* GET /v1/public/shivirs */
router.get("/shivirs", async (_req: Request, res: Response) => {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db
    .select({
      id: shivir_events.id,
      name: shivir_events.name,
      description: shivir_events.description,
      start_date: shivir_events.start_date,
      end_date: shivir_events.end_date,
      location_text: shivir_events.location_text,
      city_name: cities.name,
    })
    .from(shivir_events)
    .innerJoin(cities, eq(cities.id, shivir_events.city_id))
    .where(and(eq(shivir_events.is_published, true), gte(shivir_events.end_date, today)))
    .orderBy(asc(shivir_events.start_date));

  ok(res, { items: rows }, { count: rows.length });
});

/* GET /v1/public/shivirs/:id */
router.get("/shivirs/:id", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Shivir not found.");
    return;
  }
  const [shivir] = await db
    .select({
      id: shivir_events.id,
      name: shivir_events.name,
      description: shivir_events.description,
      start_date: shivir_events.start_date,
      end_date: shivir_events.end_date,
      location_text: shivir_events.location_text,
      city_name: cities.name,
      state_name: states.name,
      capacity: shivir_events.capacity,
      contact_info: shivir_events.contact_info,
    })
    .from(shivir_events)
    .innerJoin(cities, eq(cities.id, shivir_events.city_id))
    .innerJoin(states, eq(states.id, cities.state_id))
    .where(and(eq(shivir_events.id, id), eq(shivir_events.is_published, true)))
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
  const section = await buildLibrarySection(id, { guestOnly: true });
  if (!section) {
    fail(res, 404, "ERR_NOT_FOUND", "That library section could not be found.");
    return;
  }
  ok(res, { section });
});

/* GET /v1/public/library — published tree for guests (gated sections as shells). */
router.get("/library", async (_req: Request, res: Response) => {
  const sections = await buildLibraryTree({ guestOnly: true });
  ok(res, { sections }, { count: sections.length });
});

/* GET /v1/public/courses — active catalogue (read-only, no progress). */
router.get("/courses", async (_req: Request, res: Response) => {
  const rows = await db
    .select({
      id: courses.id,
      name_en: courses.name_en,
      name_hi: courses.name_hi,
      kind: courses.kind,
      academic_year: courses.academic_year,
      punya_points: courses.punya_points,
    })
    .from(courses)
    .where(and(eq(courses.status, "active"), isNull(courses.deleted_at)))
    .orderBy(asc(courses.name_en));
  ok(res, { items: rows }, { count: rows.length });
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
    .where(and(eq(courses.id, id), eq(courses.status, "active"), isNull(courses.deleted_at)))
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
