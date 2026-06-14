/**
 * /v1/registration — dynamic registration forms.
 *
 * Public surface (no auth): fetch the active form config for a kind, and submit
 * a response against it. Admin surface (requireAuth + requireAdminPanel applied
 * PER-ROUTE): list/create form configs and list/review submitted responses.
 *
 * Config resolution: prefer a city-specific config (matching city_id) with the
 * highest version_no; otherwise fall back to the global config (city_id NULL)
 * with the highest version_no. Only active (is_active) configs are eligible.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  registration_form_configs,
  registration_form_responses,
  cities,
  type RegistrationFieldDef,
} from "@workspace/db";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth, requireAdminPanel } from "../../middlewares/auth";
import { auditFromReq } from "../../lib/audit";
import { cityIdsForState } from "../../lib/scope";

const router: IRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FORM_KINDS = ["student", "parent", "shikshak", "sanchalak", "city_admin"] as const;
type FormKind = (typeof FORM_KINDS)[number];

function isFormKind(v: unknown): v is FormKind {
  return typeof v === "string" && (FORM_KINDS as readonly string[]).includes(v);
}

function clampLimit(raw: unknown, fallback: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

/**
 * Resolve the active config for a kind: prefer the city-specific one (highest
 * version), else the global one (city_id NULL, highest version). Returns null
 * if none exists.
 */
async function resolveActiveConfig(kind: FormKind, cityId: string | null) {
  if (cityId) {
    const [cityRow] = await db
      .select()
      .from(registration_form_configs)
      .where(
        and(
          eq(registration_form_configs.form_kind, kind),
          eq(registration_form_configs.city_id, cityId),
          eq(registration_form_configs.is_active, true),
        ),
      )
      .orderBy(desc(registration_form_configs.version_no))
      .limit(1);
    if (cityRow) return cityRow;
  }
  const [globalRow] = await db
    .select()
    .from(registration_form_configs)
    .where(
      and(
        eq(registration_form_configs.form_kind, kind),
        isNull(registration_form_configs.city_id),
        eq(registration_form_configs.is_active, true),
      ),
    )
    .orderBy(desc(registration_form_configs.version_no))
    .limit(1);
  return globalRow ?? null;
}

/**
 * Build the SQL filter restricting configs to an admin's scope: super_admin sees
 * everything; state_admin sees global + configs for cities in their state;
 * city_admin/sanchalak/shikshak see global + their own city. Returns undefined
 * for unrestricted, or a WHERE expression otherwise.
 */
async function configScopeFilter(req: Request) {
  const u = req.authUser!;
  if (u.role === "super_admin") return undefined;
  if (u.role === "state_admin") {
    const cityIds = u.state_id ? await cityIdsForState(u.state_id) : [];
    if (cityIds.length === 0) return isNull(registration_form_configs.city_id);
    return or(
      isNull(registration_form_configs.city_id),
      inArray(registration_form_configs.city_id, cityIds),
    );
  }
  // city_admin / sanchalak / shikshak: global + own city
  if (u.city_id) {
    return or(
      isNull(registration_form_configs.city_id),
      eq(registration_form_configs.city_id, u.city_id),
    );
  }
  return isNull(registration_form_configs.city_id);
}

/** True if the admin may publish/review a config bound to the given city_id. */
async function canActOnCity(req: Request, cityId: string | null): Promise<boolean> {
  const u = req.authUser!;
  if (u.role === "super_admin") return true;
  if (cityId === null) {
    // Only super_admin may create/own global default configs.
    return false;
  }
  if (u.role === "state_admin") {
    if (!u.state_id) return false;
    const cityIds = await cityIdsForState(u.state_id);
    return cityIds.includes(cityId);
  }
  // city_admin / sanchalak / shikshak: only their own city
  return !!u.city_id && u.city_id === cityId;
}

/* ═══════════════════════════ PUBLIC routes ═══════════════════════════ */

/* GET /v1/registration/forms/:kind?city_id= — resolve active config (PUBLIC) */
router.get("/forms/:kind", async (req: Request, res: Response) => {
  const kind = String(req.params.kind);
  if (!isFormKind(kind)) {
    fail(res, 404, "ERR_NOT_FOUND", "Form not found.");
    return;
  }
  const cityIdRaw = req.query.city_id;
  let cityId: string | null = null;
  if (typeof cityIdRaw === "string" && cityIdRaw.length > 0) {
    if (!UUID_RE.test(cityIdRaw)) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid city_id.");
      return;
    }
    cityId = cityIdRaw;
  }

  const config = await resolveActiveConfig(kind, cityId);
  if (!config) {
    fail(res, 404, "ERR_NOT_FOUND", "No active registration form for this kind.");
    return;
  }
  ok(res, {
    id: config.id,
    form_kind: config.form_kind,
    title_en: config.title_en,
    title_hi: config.title_hi,
    fields: config.fields,
  });
});

const submitResponseSchema = z.object({
  full_name: z.string().min(1).max(200),
  phone: z.string().max(20).optional(),
  city_id: z.string().uuid().optional(),
  responses: z.record(z.string(), z.unknown()).default({}),
});

/* POST /v1/registration/forms/:kind/responses — submit a response (PUBLIC) */
router.post("/forms/:kind/responses", async (req: Request, res: Response) => {
  const kind = String(req.params.kind);
  if (!isFormKind(kind)) {
    fail(res, 404, "ERR_NOT_FOUND", "Form not found.");
    return;
  }
  let body: z.infer<typeof submitResponseSchema>;
  try {
    body = submitResponseSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid registration data.");
    return;
  }

  const config = await resolveActiveConfig(kind, body.city_id ?? null);
  if (!config) {
    fail(res, 404, "ERR_NOT_FOUND", "No active registration form for this kind.");
    return;
  }

  // Validate required fields are present and non-empty in the responses object.
  const fields = config.fields as RegistrationFieldDef[];
  const missing: string[] = [];
  for (const f of fields) {
    if (!f.required) continue;
    const v = body.responses[f.key];
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
      missing.push(f.key);
    }
  }
  if (missing.length > 0) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Missing required fields.", { missing });
    return;
  }

  const [row] = await db
    .insert(registration_form_responses)
    .values({
      form_config_id: config.id,
      full_name: body.full_name,
      phone: body.phone ?? null,
      status: "submitted",
      responses: body.responses,
    })
    .returning({ id: registration_form_responses.id, status: registration_form_responses.status });
  ok(res, row);
});

/* ═══════════════════════════ ADMIN routes ═══════════════════════════ */

/* GET /v1/registration/configs — scoped list of form configs */
router.get(
  "/configs",
  requireAuth,
  requireAdminPanel,
  async (req: Request, res: Response) => {
    const limit = clampLimit(req.query.limit, 100, 300);
    const filter = await configScopeFilter(req);
    const rows = await db
      .select({
        id: registration_form_configs.id,
        city_id: registration_form_configs.city_id,
        city_name: cities.name,
        form_kind: registration_form_configs.form_kind,
        title_en: registration_form_configs.title_en,
        title_hi: registration_form_configs.title_hi,
        is_active: registration_form_configs.is_active,
        version_no: registration_form_configs.version_no,
        fields: registration_form_configs.fields,
        published_at: registration_form_configs.published_at,
        created_at: registration_form_configs.created_at,
      })
      .from(registration_form_configs)
      .leftJoin(cities, eq(cities.id, registration_form_configs.city_id))
      .where(filter)
      .orderBy(desc(registration_form_configs.created_at))
      .limit(limit);
    const items = rows.map((r) => ({
      ...r,
      published_at: r.published_at ? r.published_at.toISOString() : null,
      created_at: r.created_at.toISOString(),
    }));
    ok(res, { items }, { count: items.length });
  },
);

const fieldDefSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9_]+$/i, "key must be alphanumeric/underscore"),
  label_en: z.string().min(1).max(200),
  label_hi: z.string().max(200).optional(),
  type: z.enum(["text", "number", "date", "select", "tel", "email", "textarea"]),
  required: z.boolean().default(false),
  options: z
    .array(
      z.object({
        value: z.string().min(1).max(120),
        label_en: z.string().min(1).max(200),
        label_hi: z.string().max(200).optional(),
      }),
    )
    .optional(),
});

const createConfigSchema = z.object({
  city_id: z.string().uuid().optional(),
  form_kind: z.enum(FORM_KINDS),
  title_en: z.string().min(1).max(300),
  title_hi: z.string().max(300).optional(),
  fields: z.array(fieldDefSchema).max(60).default([]),
});

/* POST /v1/registration/configs — publish a new config version */
router.post(
  "/configs",
  requireAuth,
  requireAdminPanel,
  async (req: Request, res: Response) => {
    let body: z.infer<typeof createConfigSchema>;
    try {
      body = createConfigSchema.parse(req.body);
    } catch {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid form config data.");
      return;
    }
    const cityId = body.city_id ?? null;

    // Reject duplicate field keys early.
    const keys = body.fields.map((f) => f.key.toLowerCase());
    if (new Set(keys).size !== keys.length) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Duplicate field keys.");
      return;
    }

    if (!(await canActOnCity(req, cityId))) {
      fail(res, 403, "ERR_FORBIDDEN", "City not in your scope.");
      return;
    }

    // Validate any provided city_id actually exists.
    if (cityId) {
      const [c] = await db.select({ id: cities.id }).from(cities).where(eq(cities.id, cityId)).limit(1);
      if (!c) {
        fail(res, 422, "ERR_VALIDATION_FAILED", "Unknown city_id.");
        return;
      }
    }

    // Compute the next version_no for (form_kind, city_id).
    const cityMatch = cityId
      ? eq(registration_form_configs.city_id, cityId)
      : isNull(registration_form_configs.city_id);
    async function maxVersionFor(): Promise<number> {
      const [{ maxVersion }] = await db
        .select({
          maxVersion: sql<number>`coalesce(max(${registration_form_configs.version_no}), 0)::int`,
        })
        .from(registration_form_configs)
        .where(and(eq(registration_form_configs.form_kind, body.form_kind), cityMatch));
      return maxVersion ?? 0;
    }
    async function insertVersion(versionNo: number) {
      const [inserted] = await db
        .insert(registration_form_configs)
        .values({
          city_id: cityId,
          form_kind: body.form_kind,
          title_en: body.title_en,
          title_hi: body.title_hi ?? null,
          is_active: true,
          version_no: versionNo,
          fields: body.fields,
          published_at: new Date(),
          published_by: req.authUser!.id,
        })
        .returning({
          id: registration_form_configs.id,
          version_no: registration_form_configs.version_no,
        });
      return inserted;
    }

    // Compute version_no then insert. A concurrent publish for the same
    // (form_kind, city_id) can win the race and violate the unique index; that
    // surfaces as a Postgres unique-violation (23505). Wrap JUST this insert in
    // a narrow try/catch to convert the race 500 into a single re-read + retry,
    // and a clean 409 if it still conflicts.
    let row: Awaited<ReturnType<typeof insertVersion>>;
    try {
      row = await insertVersion((await maxVersionFor()) + 1);
    } catch (err) {
      if ((err as { code?: string }).code !== "23505") throw err;
      try {
        row = await insertVersion((await maxVersionFor()) + 1);
      } catch (retryErr) {
        if ((retryErr as { code?: string }).code !== "23505") throw retryErr;
        fail(res, 409, "ERR_CONFLICT", "Version conflict, please retry.");
        return;
      }
    }

    await auditFromReq(req, {
      action: "config_change",
      entityKind: "registration_form_config",
      entityId: row.id,
      summary: `Published ${body.form_kind} registration form v${row.version_no}`,
      metadata: { form_kind: body.form_kind, city_id: cityId, version_no: row.version_no },
    });

    ok(res, row);
  },
);

/* GET /v1/registration/responses?kind=&status=&limit= — scoped response list */
router.get(
  "/responses",
  requireAuth,
  requireAdminPanel,
  async (req: Request, res: Response) => {
    const limit = clampLimit(req.query.limit, 100, 300);
    const filters = [];
    const scopeFilter = await configScopeFilter(req);
    if (scopeFilter) filters.push(scopeFilter);

    const kindRaw = req.query.kind;
    if (typeof kindRaw === "string" && kindRaw.length > 0) {
      if (!isFormKind(kindRaw)) {
        fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid kind.");
        return;
      }
      filters.push(eq(registration_form_configs.form_kind, kindRaw));
    }
    const statusRaw = req.query.status;
    if (typeof statusRaw === "string" && statusRaw.length > 0) {
      if (!["submitted", "approved", "rejected"].includes(statusRaw)) {
        fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid status.");
        return;
      }
      filters.push(eq(registration_form_responses.status, statusRaw));
    }

    const rows = await db
      .select({
        id: registration_form_responses.id,
        form_config_id: registration_form_responses.form_config_id,
        form_kind: registration_form_configs.form_kind,
        city_name: cities.name,
        full_name: registration_form_responses.full_name,
        phone: registration_form_responses.phone,
        status: registration_form_responses.status,
        responses: registration_form_responses.responses,
        review_note: registration_form_responses.review_note,
        submitted_at: registration_form_responses.submitted_at,
        reviewed_at: registration_form_responses.reviewed_at,
      })
      .from(registration_form_responses)
      .innerJoin(
        registration_form_configs,
        eq(registration_form_configs.id, registration_form_responses.form_config_id),
      )
      .leftJoin(cities, eq(cities.id, registration_form_configs.city_id))
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(registration_form_responses.submitted_at))
      .limit(limit);
    const items = rows.map((r) => ({
      ...r,
      submitted_at: r.submitted_at.toISOString(),
      reviewed_at: r.reviewed_at ? r.reviewed_at.toISOString() : null,
    }));
    ok(res, { items }, { count: items.length });
  },
);

const reviewSchema = z.object({ review_note: z.string().max(1000).optional() });

/**
 * Fetch a response the admin may act on (its config is in scope). Returns the
 * response id + its config's city_id, or null if missing/out of scope.
 */
async function ownedResponse(
  req: Request,
  id: string,
): Promise<{ id: string; city_id: string | null; status: string } | null> {
  const [row] = await db
    .select({
      id: registration_form_responses.id,
      city_id: registration_form_configs.city_id,
      status: registration_form_responses.status,
    })
    .from(registration_form_responses)
    .innerJoin(
      registration_form_configs,
      eq(registration_form_configs.id, registration_form_responses.form_config_id),
    )
    .where(eq(registration_form_responses.id, id))
    .limit(1);
  if (!row) return null;
  // Reviewing an in-scope global response is allowed for any admin; otherwise
  // the response's city must be one the admin can act on.
  const u = req.authUser!;
  if (u.role === "super_admin") return row;
  if (row.city_id === null) return row; // global form responses are reviewable by any admin in panel
  if (await canActOnCity(req, row.city_id)) return row;
  return null;
}

async function reviewResponse(req: Request, res: Response, status: "approved" | "rejected") {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Response not found.");
    return;
  }
  let body: z.infer<typeof reviewSchema>;
  try {
    body = reviewSchema.parse(req.body ?? {});
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid review data.");
    return;
  }
  const owned = await ownedResponse(req, id);
  if (!owned) {
    fail(res, 404, "ERR_NOT_FOUND", "Response not found.");
    return;
  }

  await db
    .update(registration_form_responses)
    .set({
      status,
      review_note: body.review_note ?? null,
      reviewed_by: req.authUser!.id,
      reviewed_at: new Date(),
    })
    .where(eq(registration_form_responses.id, owned.id));

  await auditFromReq(req, {
    action: status === "approved" ? "approve" : "reject",
    entityKind: "registration_form_response",
    entityId: owned.id,
    summary: `${status === "approved" ? "Approved" : "Rejected"} registration response`,
  });

  ok(res, { id: owned.id, status });
}

/* POST /v1/registration/responses/:id/approve */
router.post(
  "/responses/:id/approve",
  requireAuth,
  requireAdminPanel,
  async (req: Request, res: Response) => {
    await reviewResponse(req, res, "approved");
  },
);

/* POST /v1/registration/responses/:id/reject */
router.post(
  "/responses/:id/reject",
  requireAuth,
  requireAdminPanel,
  async (req: Request, res: Response) => {
    await reviewResponse(req, res, "rejected");
  },
);

export default router;
