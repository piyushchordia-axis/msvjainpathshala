import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  centres,
  cities,
  states,
  batches,
  shivir_events,
} from "@workspace/db";
import { and, asc, count, eq, gte, sql } from "drizzle-orm";
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

void count;

export default router;
