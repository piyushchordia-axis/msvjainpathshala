/**
 * /v1/competitions — city-scoped competitions: admin authoring/lifecycle
 * (create, list with registration counts, status transitions, record results,
 * publish results with idempotent Punya awards) and the student/parent browse +
 * self-register flow.
 *
 * Competitions are CITY-scoped. Admin routes require the admin panel and verify
 * the competition's city is in the caller's city scope (404 out of scope).
 * Browse/register routes require auth, resolve the students the caller owns
 * (parent: their children; student: self), and confirm the competition's city
 * matches the student's centre city.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  competitions,
  competition_registrations,
  students,
  centres,
  cities,
  type User,
} from "@workspace/db";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth, requireAdminPanel, requireRole } from "../../middlewares/auth";
import { resolveAdminScope } from "../../lib/scope";
import { synchronizeCompetitionAwards } from "../../lib/competition-punya";
import { auditFromReq } from "../../lib/audit";
import { clampLimit, ownedStudentsCondition } from "../../lib/route-helpers";

const router: IRouter = Router();
router.use(requireAuth);

const AGE_GROUPS = ["bal", "kishor", "tarun", "yuva"] as const;
const COMPETITION_STATUSES = ["draft", "open", "closed", "results_published"] as const;
type CompetitionStatus = (typeof COMPETITION_STATUSES)[number];

/* Forward-only lifecycle: draft -> open -> closed -> results_published.
   results_published is reached via the dedicated publish-results endpoint, not
   this generic status setter. */
const FORWARD_TRANSITIONS: Record<CompetitionStatus, CompetitionStatus[]> = {
  draft: ["open"],
  open: ["closed"],
  closed: ["open", "results_published"],
  results_published: [],
};

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


/** The students owned by this user (parent: kids; student: self). */
async function ownedStudents(uid: string) {
  return db
    .select({
      id: students.id,
      centre_id: students.centre_id,
      age_group: students.age_group,
      msv_status: students.msv_status,
    })
    .from(students)
    // Q11 — shared ownership predicate (excludes soft-deleted and inactive students).
    .where(ownedStudentsCondition(uid));
}

/** The city of a centre, or null. */
async function cityForCentre(centreId: string | null): Promise<string | null> {
  if (!centreId) return null;
  const [row] = await db
    .select({ city_id: centres.city_id })
    .from(centres)
    .where(eq(centres.id, centreId))
    .limit(1);
  return row?.city_id ?? null;
}

/* ═══════════════════════════ ADMIN — authoring ═══════════════════════════ */

const createSchema = z.object({
  city_id: z.string().uuid(),
  name_en: z.string().min(1).max(300),
  name_hi: z.string().min(1).max(300),
  description_en: z.string().max(4000).optional(),
  description_hi: z.string().max(4000).optional(),
  category: z.string().min(1).max(100).default("general"),
  eligible_age_groups: z.array(z.enum(AGE_GROUPS)).max(4).default([]),
  msv_only: z.boolean().default(false),
  registration_window_start: z.string().datetime(),
  registration_window_end: z.string().datetime(),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  winner_points: z.coerce.number().int().min(0).max(100000).default(0),
  participant_points: z.coerce.number().int().min(0).max(100000).default(0),
  max_participants: z.coerce.number().int().min(1).max(100000).optional(),
});

/* POST /v1/competitions — create (status 'draft' default) */
router.post("/", requireAdminPanel, requireRole("super_admin", "state_admin", "city_admin"), async (req: Request, res: Response) => {
  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid competition data.");
    return;
  }

  const start = new Date(body.registration_window_start);
  const end = new Date(body.registration_window_end);
  if (end <= start) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Registration window end must be after start.");
    return;
  }

  const cityIds = await cityScopeForUser(req.authUser!);
  if (!cityInScope(cityIds, body.city_id)) {
    fail(res, 403, "ERR_FORBIDDEN", "City not in your scope.");
    return;
  }

  const [row] = await db
    .insert(competitions)
    .values({
      city_id: body.city_id,
      name_en: body.name_en,
      name_hi: body.name_hi,
      description_en: body.description_en ?? null,
      description_hi: body.description_hi ?? null,
      category: body.category,
      eligible_age_groups: body.eligible_age_groups,
      msv_only: body.msv_only,
      registration_window_start: start,
      registration_window_end: end,
      event_date: body.event_date,
      winner_points: body.winner_points,
      participant_points: body.participant_points,
      max_participants: body.max_participants ?? null,
      status: "draft",
      created_by: req.authUser!.id,
    })
    .returning({ id: competitions.id });

  await auditFromReq(req, {
    action: "create",
    entityKind: "competition",
    entityId: row.id,
    summary: `Created competition ${body.name_en}`,
  });

  ok(res, { id: row.id });
});

/* GET /v1/competitions?limit= — scoped list with registration counts */
router.get("/", requireAdminPanel, async (req: Request, res: Response) => {
  const cityIds = await cityScopeForUser(req.authUser!);
  const limit = clampLimit(req.query.limit, 100, 300);

  let cityFilter;
  if (cityIds === null) cityFilter = undefined;
  else if (cityIds.length === 0) cityFilter = sql`false`;
  else cityFilter = inArray(competitions.city_id, cityIds);

  const rows = await db
    .select({
      id: competitions.id,
      city_id: competitions.city_id,
      city_name: cities.name,
      name_en: competitions.name_en,
      name_hi: competitions.name_hi,
      category: competitions.category,
      eligible_age_groups: competitions.eligible_age_groups,
      msv_only: competitions.msv_only,
      registration_window_start: competitions.registration_window_start,
      registration_window_end: competitions.registration_window_end,
      event_date: competitions.event_date,
      winner_points: competitions.winner_points,
      participant_points: competitions.participant_points,
      max_participants: competitions.max_participants,
      status: competitions.status,
      results_published_at: competitions.results_published_at,
      created_at: competitions.created_at,
      registration_count: sql<number>`(
        select count(*)::int from ${competition_registrations}
        where ${competition_registrations.competition_id} = ${competitions.id}
      )`,
    })
    .from(competitions)
    .innerJoin(cities, eq(cities.id, competitions.city_id))
    .where(cityFilter)
    .orderBy(asc(competitions.event_date))
    .limit(limit);

  const items = rows.map((r) => ({
    ...r,
    registration_window_start: r.registration_window_start.toISOString(),
    registration_window_end: r.registration_window_end.toISOString(),
    results_published_at: r.results_published_at ? r.results_published_at.toISOString() : null,
    created_at: r.created_at.toISOString(),
  }));
  ok(res, { items }, { count: items.length });
});

/* GET /v1/competitions/:id/registrations?limit=&offset= — scoped roster.
   Read-only (no audit). The competition's city must be in the caller's scope
   (404 otherwise, mirroring the other admin routes). Ordered by registration
   time; `status` is derived (ranked once a result_rank is recorded). */
router.get("/:id/registrations", requireAdminPanel, async (req: Request, res: Response) => {
  const cityIds = await cityScopeForUser(req.authUser!);
  const id = String(req.params.id);
  const [comp] = await db
    .select({ id: competitions.id, city_id: competitions.city_id })
    .from(competitions)
    .where(eq(competitions.id, id))
    .limit(1);
  if (!comp || !cityInScope(cityIds, comp.city_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Competition not found.");
    return;
  }

  const limit = clampLimit(req.query.limit, 50, 200);
  const offsetRaw = Number(req.query.offset);
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0;

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(competition_registrations)
    .where(eq(competition_registrations.competition_id, comp.id));

  const rows = await db
    .select({
      id: competition_registrations.id,
      student_id: competition_registrations.student_id,
      student_name: students.full_name,
      centre_name: centres.name,
      registered_at: competition_registrations.registered_at,
      result_rank: competition_registrations.result_rank,
      result_note: competition_registrations.result_note,
    })
    .from(competition_registrations)
    .innerJoin(students, eq(students.id, competition_registrations.student_id))
    .leftJoin(centres, eq(centres.id, students.centre_id))
    .where(eq(competition_registrations.competition_id, comp.id))
    .orderBy(asc(competition_registrations.registered_at))
    .limit(limit)
    .offset(offset);

  const items = rows.map((r) => ({
    id: r.id,
    student_id: r.student_id,
    student_name: r.student_name,
    centre_name: r.centre_name,
    registered_at: r.registered_at.toISOString(),
    result_rank: r.result_rank,
    result_note: r.result_note,
    status: r.result_rank != null ? "ranked" : "registered",
  }));

  ok(res, { items }, { count: items.length, total: total ?? 0, limit, offset });
});

const statusSchema = z.object({
  status: z.enum(COMPETITION_STATUSES),
});

/* POST /v1/competitions/:id/status — forward-only lifecycle transition */
router.post("/:id/status", requireAdminPanel, requireRole("super_admin", "state_admin", "city_admin"), async (req: Request, res: Response) => {
  let body: z.infer<typeof statusSchema>;
  try {
    body = statusSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid status payload.");
    return;
  }

  const cityIds = await cityScopeForUser(req.authUser!);
  const id = String(req.params.id);
  const [comp] = await db
    .select({ id: competitions.id, city_id: competitions.city_id, status: competitions.status })
    .from(competitions)
    .where(eq(competitions.id, id))
    .limit(1);
  if (!comp || !cityInScope(cityIds, comp.city_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Competition not found.");
    return;
  }

  if (body.status === "results_published") {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Use publish-results to publish.");
    return;
  }
  const allowed = FORWARD_TRANSITIONS[comp.status as CompetitionStatus] ?? [];
  if (comp.status === body.status || !allowed.includes(body.status)) {
    fail(res, 422, "ERR_VALIDATION_FAILED", `Cannot move from ${comp.status} to ${body.status}.`);
    return;
  }

  await db.update(competitions).set({ status: body.status }).where(eq(competitions.id, comp.id));
  await auditFromReq(req, {
    action: "update",
    entityKind: "competition",
    entityId: comp.id,
    summary: `Status ${comp.status} -> ${body.status}`,
  });
  ok(res, { id: comp.id, status: body.status });
});

const resultsSchema = z.object({
  results: z
    .array(
      z.object({
        registration_id: z.string().uuid(),
        rank: z.coerce.number().int().min(1).max(100000),
        note: z.string().max(1000).optional(),
      }),
    )
    .min(1),
  /**
   * H11 — correct ranks AFTER results were published.
   *
   * Editing was a flat 409, which made a mis-entered rank permanent: the
   * wrong student kept the winner bonus, the real winner could never be
   * paid, and no surface could reverse either. Same discipline as AT25's
   * force_cancel — an explicit opt-in, audited, and it re-synchronizes the
   * ledger rather than silently leaving it describing the old result.
   */
  force_resync: z.boolean().optional(),
});

/* POST /v1/competitions/:id/results — record result rank/note per registration */
router.post("/:id/results", requireAdminPanel, requireRole("super_admin", "state_admin", "city_admin"), async (req: Request, res: Response) => {
  let body: z.infer<typeof resultsSchema>;
  try {
    body = resultsSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid results payload.");
    return;
  }

  const cityIds = await cityScopeForUser(req.authUser!);
  const id = String(req.params.id);
  const [comp] = await db
    .select({ id: competitions.id, city_id: competitions.city_id, status: competitions.status })
    .from(competitions)
    .where(eq(competitions.id, id))
    .limit(1);
  if (!comp || !cityInScope(cityIds, comp.city_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Competition not found.");
    return;
  }
  const republishing = comp.status === "results_published";
  if (republishing && !body.force_resync) {
    fail(
      res,
      409,
      "ERR_RESULTS_PUBLISHED",
      "Results are already published " + "—" + " pass force_resync to correct them and re-settle the Punya awarded.",
    );
    return;
  }

  // Every registration referenced must belong to THIS competition.
  const regIds = Array.from(new Set(body.results.map((r) => r.registration_id)));
  const regs = await db
    .select({ id: competition_registrations.id })
    .from(competition_registrations)
    .where(
      and(
        eq(competition_registrations.competition_id, comp.id),
        inArray(competition_registrations.id, regIds),
      ),
    );
  const valid = new Set(regs.map((r) => r.id));
  if (valid.size !== regIds.length) {
    fail(res, 404, "ERR_NOT_FOUND", "One or more registrations are not in this competition.");
    return;
  }

  // The rank writes and the award re-settle must commit together: a rank
  // saved without its reversal leaves the ledger paying the previous winner.
  const sync = await db.transaction(async (tx) => {
    for (const r of body.results) {
      await tx
        .update(competition_registrations)
        .set({ result_rank: r.rank, result_note: r.note ?? null })
        .where(eq(competition_registrations.id, r.registration_id));
    }
    if (!republishing) return null;
    const [full] = await tx
      .select({
        id: competitions.id,
        name_en: competitions.name_en,
        winner_points: competitions.winner_points,
        participant_points: competitions.participant_points,
      })
      .from(competitions)
      .where(eq(competitions.id, comp.id))
      .limit(1);
    if (!full) return null;
    return synchronizeCompetitionAwards(tx, full, req.authUser!.id);
  });

  await auditFromReq(req, {
    action: "update",
    entityKind: "competition",
    entityId: comp.id,
    summary: sync
      ? `Corrected ${body.results.length} published result(s); ` +
        `${sync.reversed} award(s) reversed, ${sync.awarded} re-awarded`
      : `Recorded ${body.results.length} result(s)`,
    metadata: sync ? { force_resync: true, ...sync } : { recorded: body.results.length },
  });
  ok(res, {
    id: comp.id,
    recorded: body.results.length,
    ...(sync ? { reversed: sync.reversed, re_awarded: sync.awarded } : {}),
  });
});

/* POST /v1/competitions/:id/publish-results — idempotent: award Punya + lock */
router.post("/:id/publish-results", requireAdminPanel, requireRole("super_admin", "state_admin", "city_admin"), async (req: Request, res: Response) => {
  const cityIds = await cityScopeForUser(req.authUser!);
  const id = String(req.params.id);
  const [comp] = await db
    .select({
      id: competitions.id,
      city_id: competitions.city_id,
      status: competitions.status,
      winner_points: competitions.winner_points,
      participant_points: competitions.participant_points,
      name_en: competitions.name_en,
    })
    .from(competitions)
    .where(eq(competitions.id, id))
    .limit(1);
  if (!comp || !cityInScope(cityIds, comp.city_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Competition not found.");
    return;
  }

  // Fast-path idempotency guard (cheap pre-check; the real, race-safe guard is
  // the conditional CLAIM inside the transaction below).
  if (comp.status === "results_published") {
    fail(res, 409, "ERR_ALREADY_PUBLISHED", "Results already published.");
    return;
  }

  // Atomicity: wrap the whole publish in ONE transaction and CLAIM the
  // draft/open/closed -> results_published transition first via a conditional
  // UPDATE guarded on `status != 'results_published'`. Exactly one caller can
  // win that claim (sequential re-publish OR concurrent double-publish); the
  // losers see zero affected rows and bail. Only the winner runs the award
  // loop, so Punya is awarded exactly once.
  const outcome = await db.transaction(async (tx) => {
    const claimed = await tx
      .update(competitions)
      .set({ status: "results_published", results_published_at: new Date() })
      .where(
        and(
          eq(competitions.id, comp.id),
          ne(competitions.status, "results_published"),
        ),
      )
      .returning({ id: competitions.id });
    if (claimed.length === 0) {
      // Lost the race / already published — do NOT award.
      return { claimed: false as const };
    }

    // Publish and a later corrected rank run the SAME synchroniser, so the
    // two paths cannot drift: both converge on 'the ledger matches the ranks'.
    // Still keyed per registration, so a partial failure followed by a
    // republish credits nothing already awarded.
    const sync = await synchronizeCompetitionAwards(tx, comp, req.authUser!.id);
    return {
      claimed: true as const,
      awarded: sync.awarded,
      registrations: sync.registrations,
    };
  });

  if (!outcome.claimed) {
    fail(res, 409, "ERR_ALREADY_PUBLISHED", "Results already published.");
    return;
  }

  await auditFromReq(req, {
    action: "award",
    entityKind: "competition",
    entityId: comp.id,
    summary: `Published results; awarded ${outcome.awarded} student(s)`,
    metadata: { registrations: outcome.registrations, awarded: outcome.awarded },
  });

  ok(res, { id: comp.id, status: "results_published", awarded: outcome.awarded });
});

/* ═══════════════════════════ STUDENT / PARENT — browse + register ═══════════ */

/* GET /v1/competitions/open — open competitions eligible to a caller's child */
router.get("/open", async (req: Request, res: Response) => {
  const kids = await ownedStudents(req.authUser!.id);
  if (kids.length === 0) {
    ok(res, { items: [] }, { count: 0 });
    return;
  }

  // Resolve each child's city + collect the union of cities they can compete in.
  const childCity = new Map<string, string | null>();
  for (const k of kids) {
    childCity.set(k.id, await cityForCentre(k.centre_id));
  }
  const cityIds = Array.from(
    new Set(Array.from(childCity.values()).filter((c): c is string => !!c)),
  );
  if (cityIds.length === 0) {
    ok(res, { items: [] }, { count: 0 });
    return;
  }

  const rows = await db
    .select({
      id: competitions.id,
      city_id: competitions.city_id,
      name_en: competitions.name_en,
      name_hi: competitions.name_hi,
      description_en: competitions.description_en,
      description_hi: competitions.description_hi,
      category: competitions.category,
      eligible_age_groups: competitions.eligible_age_groups,
      msv_only: competitions.msv_only,
      registration_window_start: competitions.registration_window_start,
      registration_window_end: competitions.registration_window_end,
      event_date: competitions.event_date,
      winner_points: competitions.winner_points,
      participant_points: competitions.participant_points,
      max_participants: competitions.max_participants,
    })
    .from(competitions)
    .where(and(eq(competitions.status, "open"), inArray(competitions.city_id, cityIds)))
    .orderBy(asc(competitions.event_date));

  // Which (competition, child) pairs are already registered. Without this the
  // client tracked registration in local state keyed only by competition id, so
  // registering child A showed child B as registered too — and blocked them.
  const kidIds = kids.map((k) => k.id);
  const registeredRows = kidIds.length
    ? await db
        .select({
          competition_id: competition_registrations.competition_id,
          student_id: competition_registrations.student_id,
        })
        .from(competition_registrations)
        .where(inArray(competition_registrations.student_id, kidIds))
    : [];
  const registeredByCompetition = new Map<string, string[]>();
  for (const r of registeredRows) {
    const list = registeredByCompetition.get(r.competition_id) ?? [];
    list.push(r.student_id);
    registeredByCompetition.set(r.competition_id, list);
  }

  // For each competition, list which of the caller's children are eligible.
  const items = rows
    .map((c) => {
      const ages = c.eligible_age_groups ?? [];
      const eligibleChildren = kids.filter((k) => {
        if (childCity.get(k.id) !== c.city_id) return false;
        if (ages.length > 0 && !ages.includes(k.age_group)) return false;
        if (c.msv_only && k.msv_status !== "approved") return false;
        return true;
      });
      return {
        id: c.id,
        name_en: c.name_en,
        name_hi: c.name_hi,
        description_en: c.description_en,
        description_hi: c.description_hi,
        category: c.category,
        eligible_age_groups: ages,
        msv_only: c.msv_only,
        registration_window_start: c.registration_window_start.toISOString(),
        registration_window_end: c.registration_window_end.toISOString(),
        event_date: c.event_date,
        winner_points: c.winner_points,
        participant_points: c.participant_points,
        max_participants: c.max_participants,
        eligible_student_ids: eligibleChildren.map((k) => k.id),
        registered_student_ids: registeredByCompetition.get(c.id) ?? [],
      };
    })
    .filter((c) => c.eligible_student_ids.length > 0);

  ok(res, { items }, { count: items.length });
});

const registerSchema = z.object({
  student_id: z.string().uuid(),
});

/* POST /v1/competitions/:id/register — self/child registration into an open comp */
router.post("/:id/register", async (req: Request, res: Response) => {
  let body: z.infer<typeof registerSchema>;
  try {
    body = registerSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid registration payload.");
    return;
  }

  // Ownership: the student must belong to the caller (parent of, or is, them).
  const kids = await ownedStudents(req.authUser!.id);
  const student = kids.find((k) => k.id === body.student_id);
  if (!student) {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found.");
    return;
  }

  const id = String(req.params.id);
  const [comp] = await db
    .select({
      id: competitions.id,
      city_id: competitions.city_id,
      status: competitions.status,
      eligible_age_groups: competitions.eligible_age_groups,
      msv_only: competitions.msv_only,
      registration_window_start: competitions.registration_window_start,
      registration_window_end: competitions.registration_window_end,
      max_participants: competitions.max_participants,
    })
    .from(competitions)
    .where(eq(competitions.id, id))
    .limit(1);
  if (!comp) {
    fail(res, 404, "ERR_NOT_FOUND", "Competition not found.");
    return;
  }

  // City match: the student's centre must be in the competition's city.
  const studentCity = await cityForCentre(student.centre_id);
  if (!studentCity || studentCity !== comp.city_id) {
    fail(res, 403, "ERR_FORBIDDEN", "This competition is not available for this student.");
    return;
  }

  if (comp.status !== "open") {
    fail(res, 422, "ERR_NOT_OPEN", "Competition is not open for registration.");
    return;
  }

  const now = new Date();
  if (now < comp.registration_window_start || now > comp.registration_window_end) {
    fail(res, 422, "ERR_WINDOW_CLOSED", "The registration window is not open.");
    return;
  }

  const ages = comp.eligible_age_groups ?? [];
  if (ages.length > 0 && !ages.includes(student.age_group)) {
    fail(res, 422, "ERR_NOT_ELIGIBLE", "Student's age group is not eligible.");
    return;
  }
  if (comp.msv_only && student.msv_status !== "approved") {
    fail(res, 422, "ERR_NOT_ELIGIBLE", "This competition is MSV-only.");
    return;
  }

  // Capacity + unique guarded inside one transaction. A transaction alone is
  // NOT enough under READ COMMITTED: two concurrent registers could each count
  // the same pre-insert total and both pass the cap (count-then-insert TOCTOU).
  // So we first take a per-competition advisory xact lock to serialize all
  // registrations for this competition; only then do we count + insert. The
  // lock is held until the transaction commits/rolls back.
  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${comp.id}::text, 0))`,
    );
    if (comp.max_participants !== null) {
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(competition_registrations)
        .where(eq(competition_registrations.competition_id, comp.id));
      if ((n ?? 0) >= comp.max_participants) {
        return { capped: true as const };
      }
    }
    const inserted = await tx
      .insert(competition_registrations)
      .values({ competition_id: comp.id, student_id: student.id })
      .onConflictDoNothing({
        target: [
          competition_registrations.competition_id,
          competition_registrations.student_id,
        ],
      })
      .returning({ id: competition_registrations.id });
    return { capped: false as const, row: inserted[0] };
  });

  if (result.capped) {
    fail(res, 409, "ERR_FULL", "This competition is full.");
    return;
  }
  if (!result.row) {
    fail(res, 409, "ERR_ALREADY_REGISTERED", "This student is already registered.");
    return;
  }

  ok(res, { id: result.row.id, competition_id: comp.id, student_id: student.id });
});

export default router;
