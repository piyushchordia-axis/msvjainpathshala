/**
 * /v1/join — seasonal gan registration (Student / Shikshak / Sanchalak).
 * Public intake + payment; admin list/settings under JWT.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { open, unlink } from "node:fs/promises";
import { fileTypeFromBuffer } from "file-type";
import { z } from "zod";
import {
  db,
  cities,
  centres,
  join_form_fields,
  join_settings,
  join_student_registrations,
  join_shikshak_registrations,
  join_sanchalak_registrations,
  JOIN_KINDS,
  JOIN_STATUSES,
  type JoinKind,
  type JoinStatus,
} from "@workspace/db";
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { ok, fail } from "../../lib/envelope";
import { requireAuth, requireAdminPanel } from "../../middlewares/auth";
import { auditFromReq } from "../../lib/audit";
import { clampLimit } from "../../lib/route-helpers";
import {
  allocateStudentCode,
  allocateShikshakCode,
  allocateSanchalakCode,
} from "../../lib/entity-codes";
import { resolveAdminScope, inCentreScope } from "../../lib/scope";
import { hasMinRole } from "../../lib/roles";
import {
  canReviewJoinKind,
  JoinProvisionError,
  joinKindsForRole,
  provisionStaffRegistration,
  provisionStudentRegistration,
} from "../../lib/join-provision";
import {
  uploadMultipart,
  ALLOWED_MIME_TYPES,
  normalizeUploadMime,
  storageExtForUpload,
} from "../../lib/upload";
import { storage, makeKey } from "../../lib/storage";
import { stripImageMetadataToFile, ImageNormaliseError } from "../../lib/image-normalise";

const router: IRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAGIC_SAMPLE_BYTES = 4096;

function isJoinKind(v: unknown): v is JoinKind {
  return typeof v === "string" && (JOIN_KINDS as readonly string[]).includes(v);
}

function parseKind(req: Request): JoinKind | null {
  const raw = String(req.query.kind ?? req.params.kind ?? req.body?.kind ?? "");
  return isJoinKind(raw) ? raw : null;
}

async function getSetting(kind: JoinKind, key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: join_settings.value })
    .from(join_settings)
    .where(and(eq(join_settings.kind, kind), eq(join_settings.key, key)))
    .limit(1);
  return row?.value ?? null;
}

async function assertRegistrationOpen(kind: JoinKind, res: Response): Promise<boolean> {
  const open = await getSetting(kind, "registration_open");
  if (open !== "yes") {
    fail(
      res,
      403,
      "ERR_FORBIDDEN",
      "Registration is closed for this path. Please check back later.",
    );
    return false;
  }
  return true;
}

const STUDENT_FIXED = new Set([
  "name",
  "mobile",
  "parent_mobile",
  "parentMobile",
  "email",
  "father_name",
  "fatherName",
  "age",
  "sex",
  "education",
  "address",
  "sang_name",
  "sangName",
  "pathshala_nearby",
  "pathshalaNearby",
  "attended_last_season",
  "attendedLastSeason",
  "family_members",
  "familyMembers",
  "will_attend",
  "willAttend",
  "payment_note",
  "paymentNote",
  "special_note",
  "specialNote",
  "photo",
  "photo_url",
  "photoUrl",
  "city_id",
  "centre_id",
  "has_paid",
  "hasPaid",
]);

const STAFF_FIXED = new Set([
  "name",
  "s_o",
  "sO",
  "age",
  "school_qualification",
  "schoolQualification",
  "address",
  "religious_education",
  "religiousEducation",
  "years_at_pathshala",
  "yearsAtPathshala",
  "current_pathshala",
  "currentPathshala",
  "vision",
  "whatsapp_contact",
  "whatsappContact",
  "pathshala_timing",
  "pathshalaTiming",
  "pathshala_name",
  "pathshalaName",
  "role",
  "photo",
  "photo_url",
  "photoUrl",
  "centre_id",
  "has_paid",
  "hasPaid",
]);

function pickExtra(
  body: Record<string, unknown>,
  fixed: Set<string>,
): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  const fromExtra =
    body.extra_data && typeof body.extra_data === "object" && !Array.isArray(body.extra_data)
      ? (body.extra_data as Record<string, unknown>)
      : {};
  Object.assign(extra, fromExtra);
  for (const [k, v] of Object.entries(body)) {
    if (fixed.has(k) || k === "kind" || k === "extra_data" || k === "extraData") continue;
    if (v === undefined || v === "") continue;
    extra[k] = v;
  }
  return extra;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  return String(v);
}

/* ---------- Public: settings ---------- */
router.get("/settings", async (req: Request, res: Response) => {
  const kind = parseKind(req);
  if (!kind) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Query kind must be student, shikshak, or sanchalak.");
    return;
  }
  const rows = await db
    .select({ key: join_settings.key, value: join_settings.value, label: join_settings.label })
    .from(join_settings)
    .where(eq(join_settings.kind, kind));
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  ok(res, {
    kind,
    registration_open: map.registration_open === "yes",
    payment_amount: map.payment_amount ?? "501",
    payment_upi_id: map.payment_upi_id ?? "",
    payment_name: map.payment_name ?? "",
    payment_qr_image: map.payment_qr_image ?? "",
  });
});

/* ---------- Public: form fields ---------- */
router.get("/form-fields", async (req: Request, res: Response) => {
  const kind = parseKind(req);
  if (!kind) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Query kind must be student, shikshak, or sanchalak.");
    return;
  }
  const items = await db
    .select()
    .from(join_form_fields)
    .where(and(eq(join_form_fields.kind, kind), eq(join_form_fields.is_active, true)))
    .orderBy(asc(join_form_fields.display_order));
  ok(res, { kind, items }, { count: items.length });
});

/* ---------- Public: create registration ---------- */
const studentCreateSchema = z.object({
  kind: z.literal("student").optional(),
  city_id: z.string().uuid(),
  centre_id: z.string().uuid(),
  name: z.string().min(1),
  parent_mobile: z.string().regex(/^\d{10}$/),
  mobile: z.union([z.string().regex(/^\d{10}$/), z.literal(""), z.null()]).optional(),
  email: z.union([z.string().email(), z.literal(""), z.null()]).optional(),
  father_name: z.string().optional().nullable(),
  age: z.coerce.number().int().min(3).max(35).optional().nullable(),
  sex: z.string().optional().nullable(),
  education: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  sang_name: z.string().optional().nullable(),
  pathshala_nearby: z.string().optional().nullable(),
  attended_last_season: z.string().optional().nullable(),
  family_members: z.coerce.number().int().min(1).default(1),
  will_attend: z.string().default("yes"),
  payment_note: z.string().optional().nullable(),
  special_note: z.string().optional().nullable(),
  photo_url: z.string().optional().nullable(),
  extra_data: z.record(z.string(), z.unknown()).optional(),
});

const staffCreateSchema = z.object({
  kind: z.enum(["shikshak", "sanchalak"]).optional(),
  centre_id: z.string().uuid(),
  name: z.string().min(1),
  whatsapp_contact: z.string().regex(/^\d{10}$/),
  s_o: z.string().optional().nullable(),
  age: z.coerce.number().int().min(15).max(90).optional().nullable(),
  school_qualification: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  religious_education: z.string().optional().nullable(),
  years_at_pathshala: z.coerce.number().int().optional().nullable(),
  current_pathshala: z.string().optional().nullable(),
  vision: z.string().optional().nullable(),
  pathshala_timing: z.string().optional().nullable(),
  pathshala_name: z.string().optional().nullable(),
  role: z.string().optional().nullable(),
  photo_url: z.string().optional().nullable(),
  extra_data: z.record(z.string(), z.unknown()).optional(),
});

router.post("/registrations", async (req: Request, res: Response) => {
  const kindRaw = String(req.body?.kind ?? "");
  if (!isJoinKind(kindRaw)) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Body kind must be student, shikshak, or sanchalak.");
    return;
  }
  if (!(await assertRegistrationOpen(kindRaw, res))) return;

  const body = req.body as Record<string, unknown>;
  // Accept camelCase aliases from ported clients.
  if (body.fatherName !== undefined && body.father_name === undefined) body.father_name = body.fatherName;
  if (body.parentMobile !== undefined && body.parent_mobile === undefined) {
    body.parent_mobile = body.parentMobile;
  }
  if (body.sangName !== undefined && body.sang_name === undefined) body.sang_name = body.sangName;
  if (body.pathshalaNearby !== undefined && body.pathshala_nearby === undefined) {
    body.pathshala_nearby = body.pathshalaNearby;
  }
  if (body.attendedLastSeason !== undefined && body.attended_last_season === undefined) {
    body.attended_last_season = body.attendedLastSeason;
  }
  if (body.familyMembers !== undefined && body.family_members === undefined) {
    body.family_members = body.familyMembers;
  }
  if (body.willAttend !== undefined && body.will_attend === undefined) body.will_attend = body.willAttend;
  if (body.paymentNote !== undefined && body.payment_note === undefined) body.payment_note = body.paymentNote;
  if (body.specialNote !== undefined && body.special_note === undefined) body.special_note = body.specialNote;
  if (body.photoUrl !== undefined && body.photo_url === undefined) body.photo_url = body.photoUrl;
  if (body.whatsappContact !== undefined && body.whatsapp_contact === undefined) {
    body.whatsapp_contact = body.whatsappContact;
  }
  if (body.sO !== undefined && body.s_o === undefined) body.s_o = body.sO;
  if (body.schoolQualification !== undefined && body.school_qualification === undefined) {
    body.school_qualification = body.schoolQualification;
  }
  if (body.religiousEducation !== undefined && body.religious_education === undefined) {
    body.religious_education = body.religiousEducation;
  }
  if (body.yearsAtPathshala !== undefined && body.years_at_pathshala === undefined) {
    body.years_at_pathshala = body.yearsAtPathshala;
  }
  if (body.currentPathshala !== undefined && body.current_pathshala === undefined) {
    body.current_pathshala = body.currentPathshala;
  }
  if (body.pathshalaTiming !== undefined && body.pathshala_timing === undefined) {
    body.pathshala_timing = body.pathshalaTiming;
  }
  if (body.pathshalaName !== undefined && body.pathshala_name === undefined) {
    body.pathshala_name = body.pathshalaName;
  }

  if (kindRaw === "student") {
    const parsed = studentCreateSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid student registration.", parsed.error.flatten());
      return;
    }
    const data = parsed.data;
    const [city] = await db
      .select({ id: cities.id, code: cities.code })
      .from(cities)
      .where(eq(cities.id, data.city_id))
      .limit(1);
    if (!city) {
      fail(res, 404, "ERR_NOT_FOUND", "City not found.");
      return;
    }
    const [centre] = await db
      .select({ id: centres.id, city_id: centres.city_id })
      .from(centres)
      .where(and(eq(centres.id, data.centre_id), eq(centres.status, "active")))
      .limit(1);
    if (!centre) {
      fail(res, 404, "ERR_NOT_FOUND", "Centre not found.");
      return;
    }
    if (centre.city_id !== data.city_id) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Centre must belong to the selected city.");
      return;
    }
    const extra = pickExtra(body, STUDENT_FIXED);
    const row = await db.transaction(async (tx) => {
      const display_code = await allocateStudentCode(tx, city.code);
      const [inserted] = await tx
        .insert(join_student_registrations)
        .values({
          display_code,
          city_id: data.city_id,
          centre_id: data.centre_id,
          name: data.name,
          parent_mobile: data.parent_mobile,
          mobile: data.mobile && data.mobile.length > 0 ? data.mobile : null,
          email: data.email && data.email.length > 0 ? data.email : null,
          father_name: data.father_name ?? null,
          age: data.age ?? null,
          sex: data.sex ?? null,
          education: data.education ?? null,
          address: data.address ?? null,
          sang_name: data.sang_name ?? null,
          pathshala_nearby: data.pathshala_nearby ?? null,
          attended_last_season: data.attended_last_season ?? null,
          family_members: data.family_members,
          will_attend: data.will_attend,
          has_paid: "no",
          payment_note: data.payment_note ?? null,
          special_note: data.special_note ?? null,
          photo_url: data.photo_url ?? null,
          extra_data: extra,
          status: "pending",
        })
        .returning();
      return inserted;
    });
    ok(res, row, undefined, 201);
    return;
  }

  const parsed = staffCreateSchema.safeParse({ ...body, kind: kindRaw });
  if (!parsed.success) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid staff registration.", parsed.error.flatten());
    return;
  }
  const data = parsed.data;
  if (kindRaw === "shikshak" && !data.role) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Role (Guruji / Didi) is required.");
    return;
  }
  const staffRole = data.role ?? (kindRaw === "sanchalak" ? "संचालक" : null);
  const [centre] = await db
    .select({ id: centres.id, code: centres.code })
    .from(centres)
    .where(and(eq(centres.id, data.centre_id), eq(centres.status, "active")))
    .limit(1);
  if (!centre) {
    fail(res, 404, "ERR_NOT_FOUND", "Centre not found.");
    return;
  }
  if (!centre.code) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "This centre has no Pathshala code yet — pick another centre.");
    return;
  }
  const extra = pickExtra(body, STAFF_FIXED);
  const table = kindRaw === "shikshak" ? join_shikshak_registrations : join_sanchalak_registrations;
  const row = await db.transaction(async (tx) => {
    const display_code =
      kindRaw === "shikshak"
        ? await allocateShikshakCode(tx, centre.code!)
        : await allocateSanchalakCode(tx, centre.code!);
    const [inserted] = await tx
      .insert(table)
      .values({
        display_code,
        centre_id: data.centre_id,
        name: data.name,
        s_o: data.s_o ?? null,
        age: data.age ?? null,
        school_qualification: data.school_qualification ?? null,
        address: data.address ?? null,
        religious_education: data.religious_education ?? null,
        years_at_pathshala: data.years_at_pathshala ?? null,
        current_pathshala: data.current_pathshala ?? null,
        vision: data.vision ?? null,
        whatsapp_contact: data.whatsapp_contact,
        pathshala_timing: data.pathshala_timing ?? null,
        pathshala_name: data.pathshala_name ?? null,
        role: staffRole,
        photo_url: data.photo_url ?? null,
        has_paid: "no",
        extra_data: extra,
        status: "pending",
      })
      .returning();
    return inserted;
  });
  ok(res, row, undefined, 201);
});

/* ---------- Public: lookup ---------- */
router.get("/registrations/lookup", async (req: Request, res: Response) => {
  const kind = parseKind(req);
  if (!kind) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Query kind must be student, shikshak, or sanchalak.");
    return;
  }
  const displayCode = str(req.query.display_code)?.toUpperCase() ?? null;
  const mobile = str(req.query.mobile) ?? null;
  if (!displayCode && !mobile) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Provide display_code or mobile.");
    return;
  }

  if (kind === "student") {
    const conds = [];
    if (displayCode) conds.push(eq(join_student_registrations.display_code, displayCode));
    if (mobile) {
      conds.push(
        or(
          eq(join_student_registrations.parent_mobile, mobile),
          eq(join_student_registrations.mobile, mobile),
        )!,
      );
    }
    const items = await db
      .select({
        id: join_student_registrations.id,
        display_code: join_student_registrations.display_code,
        name: join_student_registrations.name,
        mobile: join_student_registrations.mobile,
        parent_mobile: join_student_registrations.parent_mobile,
        has_paid: join_student_registrations.has_paid,
        father_name: join_student_registrations.father_name,
      })
      .from(join_student_registrations)
      .where(or(...conds))
      .limit(20);
    if (items.length === 0) {
      fail(res, 404, "ERR_NOT_FOUND", "No registration found.");
      return;
    }
    ok(res, { items });
    return;
  }

  const table = kind === "shikshak" ? join_shikshak_registrations : join_sanchalak_registrations;
  const conds = [];
  if (displayCode) conds.push(eq(table.display_code, displayCode));
  if (mobile) conds.push(eq(table.whatsapp_contact, mobile));
  const items = await db
    .select({
      id: table.id,
      display_code: table.display_code,
      name: table.name,
      mobile: table.whatsapp_contact,
      has_paid: table.has_paid,
    })
    .from(table)
    .where(or(...conds))
    .limit(20);
  if (items.length === 0) {
    fail(res, 404, "ERR_NOT_FOUND", "No registration found.");
    return;
  }
  ok(res, { items });
});

/* ---------- Public: payment patch ---------- */
const paymentSchema = z.object({
  kind: z.enum(["student", "shikshak", "sanchalak"]),
  payment_screenshot_url: z.string().min(1),
  has_paid: z.enum(["yes", "no"]).optional().default("yes"),
});

router.patch("/registrations/:id/payment", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Registration not found.");
    return;
  }
  const parsed = paymentSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid payment payload.", parsed.error.flatten());
    return;
  }
  const { kind, payment_screenshot_url, has_paid } = parsed.data;

  if (kind === "student") {
    const [row] = await db
      .update(join_student_registrations)
      .set({
        payment_screenshot_url,
        has_paid,
        updated_at: new Date(),
      })
      .where(eq(join_student_registrations.id, id))
      .returning();
    if (!row) {
      fail(res, 404, "ERR_NOT_FOUND", "Registration not found.");
      return;
    }
    ok(res, row);
    return;
  }

  const table = kind === "shikshak" ? join_shikshak_registrations : join_sanchalak_registrations;
  const [row] = await db
    .update(table)
    .set({
      payment_screenshot_url,
      has_paid,
      updated_at: new Date(),
    })
    .where(eq(table.id, id))
    .returning();
  if (!row) {
    fail(res, 404, "ERR_NOT_FOUND", "Registration not found.");
    return;
  }
  ok(res, row);
});

/* ---------- Public: upload (join-registration folder only) ---------- */
async function readMagicSample(filePath: string): Promise<Buffer> {
  const handle = await open(filePath, "r");
  try {
    const buf = Buffer.alloc(MAGIC_SAMPLE_BYTES);
    const { bytesRead } = await handle.read(buf, 0, MAGIC_SAMPLE_BYTES, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function safeUnlink(filePath: string | undefined): Promise<void> {
  if (!filePath) return;
  try {
    await unlink(filePath);
  } catch {
    /* already gone */
  }
}

router.post("/uploads", uploadMultipart.single("file"), async (req: Request, res: Response) => {
  const tempPath = req.file?.path;
  try {
    const file = req.file;
    if (!file || !tempPath) {
      fail(
        res,
        422,
        "ERR_VALIDATION_FAILED",
        "No file provided — choose a clear image and try again.",
      );
      return;
    }
    const declared = normalizeUploadMime(file.mimetype);
    if (!declared || !ALLOWED_MIME_TYPES.has(declared) || !declared.startsWith("image/")) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Only image uploads are allowed for join registration.");
      return;
    }
    const head = await readMagicSample(tempPath);
    const detected = head.length > 0 ? await fileTypeFromBuffer(head) : undefined;
    const detectedMime = normalizeUploadMime(detected?.mime ?? null);
    // Match /v1/uploads: accept detected MIME, or declared when magic is unknown
    // (common for some HEIC / iOS exports where file-type returns undefined).
    const contentMime =
      detectedMime && ALLOWED_MIME_TYPES.has(detectedMime) && detectedMime.startsWith("image/")
        ? detectedMime
        : detected == null && file.size > 0 && declared && ALLOWED_MIME_TYPES.has(declared)
          ? declared
          : null;
    if (!contentMime) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "File content does not match an allowed image type.");
      return;
    }
    let storeBody: Buffer | string = tempPath;
    let storeMime = contentMime;
    try {
      const normalised = await stripImageMetadataToFile(tempPath, contentMime, `${tempPath}.norm`);
      storeBody = normalised.path;
      storeMime = normalised.mime;
    } catch (err) {
      const message =
        err instanceof ImageNormaliseError
          ? err.message
          : "Could not process this image. Please try another photo.";
      fail(res, 422, "ERR_VALIDATION_FAILED", message);
      return;
    }
    const ext = storageExtForUpload(storeMime, storeMime === contentMime ? detected?.ext : undefined);
    const key = makeKey("join-registration", `upload.${ext}`);
    const stored = await storage.put(key, storeBody, storeMime);
    ok(res, stored);
  } finally {
    await safeUnlink(tempPath);
    await safeUnlink(`${tempPath}.norm`);
  }
});

/* ---------- Admin: settings upsert (city_admin+) ---------- */
router.put(
  "/settings/:key",
  requireAuth,
  requireAdminPanel,
  async (req: Request, res: Response) => {
    if (!hasMinRole(req.authUser!.role, "city_admin")) {
      fail(res, 403, "ERR_FORBIDDEN", "Only city admins and above can change join settings.");
      return;
    }
    const kind = parseKind(req);
    if (!kind) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Query kind must be student, shikshak, or sanchalak.");
      return;
    }
    const key = String(req.params.key);
    const value = str(req.body?.value);
    if (value === null) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Body value is required.");
      return;
    }
    const label = str(req.body?.label);
    const [existing] = await db
      .select()
      .from(join_settings)
      .where(and(eq(join_settings.kind, kind), eq(join_settings.key, key)))
      .limit(1);
    let row;
    if (existing) {
      [row] = await db
        .update(join_settings)
        .set({ value, label: label ?? existing.label, updated_at: new Date() })
        .where(eq(join_settings.id, existing.id))
        .returning();
    } else {
      [row] = await db
        .insert(join_settings)
        .values({ kind, key, value, label })
        .returning();
    }
    await auditFromReq(req, {
      action: "config_change",
      entityKind: "join_settings",
      entityId: row!.id,
      summary: `Updated join setting ${kind}/${key}`,
    });
    ok(res, row);
  },
);

function parseJoinStatus(raw: unknown): JoinStatus | null {
  if (typeof raw !== "string" || raw === "") return null;
  return (JOIN_STATUSES as readonly string[]).includes(raw) ? (raw as JoinStatus) : null;
}

/* ---------- Admin: scoped list / stats / delete / approve / reject ---------- */
router.get(
  "/registrations",
  requireAuth,
  requireAdminPanel,
  async (req: Request, res: Response) => {
    const kind = parseKind(req);
    if (!kind) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Query kind must be student, shikshak, or sanchalak.");
      return;
    }
    if (!canReviewJoinKind(req.authUser!.role, kind)) {
      fail(res, 403, "ERR_FORBIDDEN", "You cannot review this registration kind.");
      return;
    }
    const q = str(req.query.q)?.trim() ?? "";
    const statusFilter = parseJoinStatus(req.query.status) ?? "pending";
    const limit = clampLimit(req.query.limit, 100, 300);
    const scope = await resolveAdminScope(req.authUser!);

    if (kind === "student") {
      const conds = [eq(join_student_registrations.status, statusFilter)];
      if (scope.centreIds !== null) {
        if (scope.centreIds.length === 0) {
          ok(res, { items: [] }, { count: 0 });
          return;
        }
        conds.push(inArray(join_student_registrations.centre_id, scope.centreIds));
      }
      if (q) {
        conds.push(
          or(
            ilike(join_student_registrations.name, `%${q}%`),
            ilike(join_student_registrations.display_code, `%${q}%`),
            ilike(join_student_registrations.mobile, `%${q}%`),
          )!,
        );
      }
      const items = await db
        .select({
          id: join_student_registrations.id,
          display_code: join_student_registrations.display_code,
          name: join_student_registrations.name,
          mobile: join_student_registrations.mobile,
          has_paid: join_student_registrations.has_paid,
          status: join_student_registrations.status,
          city_id: join_student_registrations.city_id,
          centre_id: join_student_registrations.centre_id,
          centre_name: centres.name,
          city_name: cities.name,
          photo_url: join_student_registrations.photo_url,
          payment_screenshot_url: join_student_registrations.payment_screenshot_url,
          age: join_student_registrations.age,
          sex: join_student_registrations.sex,
          father_name: join_student_registrations.father_name,
          rejection_reason: join_student_registrations.rejection_reason,
          provisioned_user_id: join_student_registrations.provisioned_user_id,
          provisioned_student_id: join_student_registrations.provisioned_student_id,
          created_at: join_student_registrations.created_at,
        })
        .from(join_student_registrations)
        .innerJoin(centres, eq(centres.id, join_student_registrations.centre_id))
        .innerJoin(cities, eq(cities.id, join_student_registrations.city_id))
        .where(and(...conds))
        .orderBy(desc(join_student_registrations.created_at))
        .limit(limit);
      ok(res, { items }, { count: items.length });
      return;
    }

    const table = kind === "shikshak" ? join_shikshak_registrations : join_sanchalak_registrations;
    const conds = [eq(table.status, statusFilter)];
    if (scope.centreIds !== null) {
      if (scope.centreIds.length === 0) {
        ok(res, { items: [] }, { count: 0 });
        return;
      }
      conds.push(inArray(table.centre_id, scope.centreIds));
    }
    if (q) {
      conds.push(
        or(
          ilike(table.name, `%${q}%`),
          ilike(table.display_code, `%${q}%`),
          ilike(table.whatsapp_contact, `%${q}%`),
        )!,
      );
    }
    const items = await db
      .select({
        id: table.id,
        display_code: table.display_code,
        name: table.name,
        whatsapp_contact: table.whatsapp_contact,
        has_paid: table.has_paid,
        status: table.status,
        centre_id: table.centre_id,
        centre_name: centres.name,
        city_name: cities.name,
        role: table.role,
        photo_url: table.photo_url,
        payment_screenshot_url: table.payment_screenshot_url,
        rejection_reason: table.rejection_reason,
        provisioned_user_id: table.provisioned_user_id,
        created_at: table.created_at,
      })
      .from(table)
      .innerJoin(centres, eq(centres.id, table.centre_id))
      .innerJoin(cities, eq(cities.id, centres.city_id))
      .where(and(...conds))
      .orderBy(desc(table.created_at))
      .limit(limit);
    ok(res, { items }, { count: items.length });
  },
);

router.get(
  "/registrations/stats",
  requireAuth,
  requireAdminPanel,
  async (req: Request, res: Response) => {
    const kind = parseKind(req);
    if (!kind) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Query kind must be student, shikshak, or sanchalak.");
      return;
    }
    if (!canReviewJoinKind(req.authUser!.role, kind)) {
      fail(res, 403, "ERR_FORBIDDEN", "You cannot review this registration kind.");
      return;
    }
    const scope = await resolveAdminScope(req.authUser!);
    const centreFilter =
      scope.centreIds === null
        ? undefined
        : scope.centreIds.length === 0
          ? sql`false`
          : inArray(
              kind === "student"
                ? join_student_registrations.centre_id
                : kind === "shikshak"
                  ? join_shikshak_registrations.centre_id
                  : join_sanchalak_registrations.centre_id,
              scope.centreIds,
            );

    if (kind === "student") {
      const [totals] = await db
        .select({
          total: count(),
          pending: sql<number>`count(*) filter (where ${join_student_registrations.status} = 'pending')::int`,
          approved: sql<number>`count(*) filter (where ${join_student_registrations.status} = 'approved')::int`,
          rejected: sql<number>`count(*) filter (where ${join_student_registrations.status} = 'rejected')::int`,
          paid: sql<number>`count(*) filter (where ${join_student_registrations.has_paid} = 'yes')::int`,
        })
        .from(join_student_registrations)
        .where(centreFilter);
      ok(res, {
        total: Number(totals?.total ?? 0),
        pending: Number(totals?.pending ?? 0),
        approved: Number(totals?.approved ?? 0),
        rejected: Number(totals?.rejected ?? 0),
        paid: Number(totals?.paid ?? 0),
      });
      return;
    }
    const table = kind === "shikshak" ? join_shikshak_registrations : join_sanchalak_registrations;
    const [totals] = await db
      .select({
        total: count(),
        pending: sql<number>`count(*) filter (where ${table.status} = 'pending')::int`,
        approved: sql<number>`count(*) filter (where ${table.status} = 'approved')::int`,
        rejected: sql<number>`count(*) filter (where ${table.status} = 'rejected')::int`,
        paid: sql<number>`count(*) filter (where ${table.has_paid} = 'yes')::int`,
      })
      .from(table)
      .where(centreFilter);
    ok(res, {
      total: Number(totals?.total ?? 0),
      pending: Number(totals?.pending ?? 0),
      approved: Number(totals?.approved ?? 0),
      rejected: Number(totals?.rejected ?? 0),
      paid: Number(totals?.paid ?? 0),
    });
  },
);

router.post(
  "/registrations/:id/approve",
  requireAuth,
  requireAdminPanel,
  async (req: Request, res: Response) => {
    const kind = parseKind(req);
    if (!kind) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Query kind must be student, shikshak, or sanchalak.");
      return;
    }
    if (!canReviewJoinKind(req.authUser!.role, kind)) {
      fail(res, 403, "ERR_FORBIDDEN", "You cannot approve this registration kind.");
      return;
    }
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) {
      fail(res, 404, "ERR_NOT_FOUND", "Registration not found.");
      return;
    }
    const scope = await resolveAdminScope(req.authUser!);
    const reviewerId = req.authUser!.id;

    try {
      if (kind === "student") {
        const [reg] = await db
          .select()
          .from(join_student_registrations)
          .where(eq(join_student_registrations.id, id))
          .limit(1);
        if (!reg) {
          fail(res, 404, "ERR_NOT_FOUND", "Registration not found.");
          return;
        }
        if (!inCentreScope(scope, reg.centre_id)) {
          fail(res, 403, "ERR_FORBIDDEN", "This registration is outside your centre scope.");
          return;
        }
        if (reg.status === "approved" && reg.provisioned_user_id && reg.provisioned_student_id) {
          ok(res, reg);
          return;
        }
        if (reg.status === "rejected") {
          fail(res, 409, "ERR_CONFLICT", "This registration was rejected — it cannot be approved.");
          return;
        }
        const provisioned = await provisionStudentRegistration(reg, reviewerId);
        const [updated] = await db
          .update(join_student_registrations)
          .set({
            status: "approved",
            reviewed_at: new Date(),
            reviewed_by: reviewerId,
            rejection_reason: null,
            provisioned_user_id: provisioned.userId,
            provisioned_student_id: provisioned.studentId,
            updated_at: new Date(),
          })
          .where(eq(join_student_registrations.id, id))
          .returning();
        await auditFromReq(req, {
          action: "approve",
          entityKind: "join_registration",
          entityId: id,
          summary: `Approved join student ${reg.display_code}`,
          metadata: provisioned,
        });
        ok(res, updated);
        return;
      }

      const table = kind === "shikshak" ? join_shikshak_registrations : join_sanchalak_registrations;
      const [reg] = await db.select().from(table).where(eq(table.id, id)).limit(1);
      if (!reg) {
        fail(res, 404, "ERR_NOT_FOUND", "Registration not found.");
        return;
      }
      if (!inCentreScope(scope, reg.centre_id)) {
        fail(res, 403, "ERR_FORBIDDEN", "This registration is outside your centre scope.");
        return;
      }
      if (reg.status === "approved" && reg.provisioned_user_id) {
        ok(res, reg);
        return;
      }
      if (reg.status === "rejected") {
        fail(res, 409, "ERR_CONFLICT", "This registration was rejected — it cannot be approved.");
        return;
      }
      const provisioned = await provisionStaffRegistration(kind, reg, reviewerId);
      const [updated] = await db
        .update(table)
        .set({
          status: "approved",
          reviewed_at: new Date(),
          reviewed_by: reviewerId,
          rejection_reason: null,
          provisioned_user_id: provisioned.userId,
          updated_at: new Date(),
        })
        .where(eq(table.id, id))
        .returning();
      await auditFromReq(req, {
        action: "approve",
        entityKind: "join_registration",
        entityId: id,
        summary: `Approved join ${kind} ${reg.display_code}`,
        metadata: provisioned,
      });
      ok(res, updated);
    } catch (err) {
      if (err instanceof JoinProvisionError) {
        fail(res, err.httpStatus, err.code, err.message);
        return;
      }
      throw err;
    }
  },
);

router.post(
  "/registrations/:id/reject",
  requireAuth,
  requireAdminPanel,
  async (req: Request, res: Response) => {
    const kind = parseKind(req);
    if (!kind) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Query kind must be student, shikshak, or sanchalak.");
      return;
    }
    if (!canReviewJoinKind(req.authUser!.role, kind)) {
      fail(res, 403, "ERR_FORBIDDEN", "You cannot reject this registration kind.");
      return;
    }
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) {
      fail(res, 404, "ERR_NOT_FOUND", "Registration not found.");
      return;
    }
    const reason = str(req.body?.reason)?.trim() ?? "";
    if (!reason) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Rejection reason is required.");
      return;
    }
    const scope = await resolveAdminScope(req.authUser!);
    const reviewerId = req.authUser!.id;

    if (kind === "student") {
      const [reg] = await db
        .select()
        .from(join_student_registrations)
        .where(eq(join_student_registrations.id, id))
        .limit(1);
      if (!reg) {
        fail(res, 404, "ERR_NOT_FOUND", "Registration not found.");
        return;
      }
      if (!inCentreScope(scope, reg.centre_id)) {
        fail(res, 403, "ERR_FORBIDDEN", "This registration is outside your centre scope.");
        return;
      }
      if (reg.status === "approved") {
        fail(res, 409, "ERR_CONFLICT", "Already approved — cannot reject.");
        return;
      }
      const [updated] = await db
        .update(join_student_registrations)
        .set({
          status: "rejected",
          reviewed_at: new Date(),
          reviewed_by: reviewerId,
          rejection_reason: reason,
          updated_at: new Date(),
        })
        .where(eq(join_student_registrations.id, id))
        .returning();
      await auditFromReq(req, {
        action: "reject",
        entityKind: "join_registration",
        entityId: id,
        summary: `Rejected join student ${reg.display_code}`,
        metadata: { reason },
      });
      ok(res, updated);
      return;
    }

    const table = kind === "shikshak" ? join_shikshak_registrations : join_sanchalak_registrations;
    const [reg] = await db.select().from(table).where(eq(table.id, id)).limit(1);
    if (!reg) {
      fail(res, 404, "ERR_NOT_FOUND", "Registration not found.");
      return;
    }
    if (!inCentreScope(scope, reg.centre_id)) {
      fail(res, 403, "ERR_FORBIDDEN", "This registration is outside your centre scope.");
      return;
    }
    if (reg.status === "approved") {
      fail(res, 409, "ERR_CONFLICT", "Already approved — cannot reject.");
      return;
    }
    const [updated] = await db
      .update(table)
      .set({
        status: "rejected",
        reviewed_at: new Date(),
        reviewed_by: reviewerId,
        rejection_reason: reason,
        updated_at: new Date(),
      })
      .where(eq(table.id, id))
      .returning();
    await auditFromReq(req, {
      action: "reject",
      entityKind: "join_registration",
      entityId: id,
      summary: `Rejected join ${kind} ${reg.display_code}`,
      metadata: { reason },
    });
    ok(res, updated);
  },
);

router.delete(
  "/registrations/:id",
  requireAuth,
  requireAdminPanel,
  async (req: Request, res: Response) => {
    if (!hasMinRole(req.authUser!.role, "city_admin")) {
      fail(res, 403, "ERR_FORBIDDEN", "Only city admins and above can delete join registrations.");
      return;
    }
    const kind = parseKind(req);
    if (!kind) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Query kind must be student, shikshak, or sanchalak.");
      return;
    }
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) {
      fail(res, 404, "ERR_NOT_FOUND", "Registration not found.");
      return;
    }
    if (kind === "student") {
      const [row] = await db
        .delete(join_student_registrations)
        .where(eq(join_student_registrations.id, id))
        .returning({ id: join_student_registrations.id });
      if (!row) {
        fail(res, 404, "ERR_NOT_FOUND", "Registration not found.");
        return;
      }
    } else {
      const table = kind === "shikshak" ? join_shikshak_registrations : join_sanchalak_registrations;
      const [row] = await db
        .delete(table)
        .where(eq(table.id, id))
        .returning({ id: table.id });
      if (!row) {
        fail(res, 404, "ERR_NOT_FOUND", "Registration not found.");
        return;
      }
    }
    await auditFromReq(req, {
      action: "delete",
      entityKind: "join_registration",
      entityId: id,
      summary: `Deleted join ${kind} registration`,
    });
    ok(res, { deleted: true });
  },
);

router.get("/me/kinds", requireAuth, requireAdminPanel, async (req: Request, res: Response) => {
  ok(res, { kinds: joinKindsForRole(req.authUser!.role) });
});

export default router;
