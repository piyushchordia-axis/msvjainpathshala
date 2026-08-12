/**
 * /v1/admin/library — draft/publish CRUD for sections, subsections, items,
 * audio upload, and Panchang year drafts.
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { readFile, unlink } from "node:fs/promises";
import { z } from "zod";
import {
  db,
  library_items,
  library_sections,
  library_subsections,
  panchang_years,
  upload_objects,
} from "@workspace/db";
import { and, asc, eq, inArray, isNull, max } from "drizzle-orm";
import { ok, fail } from "../../lib/envelope";
import { requireRole } from "../../middlewares/auth";
import { requireMinRole } from "../../lib/roles";
import { auditFromReq } from "../../lib/audit";
import { sanitizeLibraryHtml } from "../../lib/library-sanitize-html";
import {
  publishItem,
  publishPanchangYear,
  publishSection,
  publishSubsection,
  unpublishItem,
  unpublishPanchangYear,
  unpublishSection,
  unpublishSubsection,
} from "../../lib/library-publish";
import {
  itemCodeFromFilename,
  LIBRARY_AUDIO_MAX_BYTES,
  LibraryAudioError,
  processLibraryMp3,
} from "../../lib/library-audio";
import {
  cleanupLibraryOrphans,
  getLibraryMediaUsage,
} from "../../lib/library-media";
import {
  panchangDaySchema,
  panchangYearSchema,
  zodDetails,
} from "../../lib/panchang-schema";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const requireEditor = requireMinRole("city_admin");
const requirePublisher = requireRole("super_admin");

router.use(requireEditor);

const sectionTypeSchema = z.enum(["item_list", "deeplink", "panchang"]);
const reorderSchema = z.object({ ids: z.array(z.string().uuid()).min(1) });

const audioUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, tmpdir()),
    filename: (_req, file, cb) =>
      cb(null, `jp-lib-audio-${Date.now()}-${file.originalname.replace(/[^\w.-]/g, "_")}`),
  }),
  limits: { fileSize: LIBRARY_AUDIO_MAX_BYTES, files: 40 },
  fileFilter: (_req, file, cb) => {
    const okMime =
      file.mimetype === "audio/mpeg" ||
      file.mimetype === "audio/mp3" ||
      file.originalname.toLowerCase().endsWith(".mp3");
    if (!okMime) {
      cb(new Error("Only MP3 audio is accepted."));
      return;
    }
    cb(null, true);
  },
});

function mapSectionAdmin(row: typeof library_sections.$inferSelect) {
  return {
    id: row.id,
    key: row.key,
    is_published: row.is_published,
    content_version: row.content_version,
    draft: {
      name_en: row.draft_name_en,
      name_hi: row.draft_name_hi,
      name_gu: row.draft_name_gu,
      icon_url: row.draft_icon_url,
      type: row.draft_type,
      deeplink_target: row.draft_deeplink_target,
      requires_login: row.draft_requires_login,
      order_index: row.draft_order_index,
    },
    published: {
      name_en: row.name_en,
      name_hi: row.name_hi,
      name_gu: row.name_gu,
      icon_url: row.icon_url,
      type: row.type,
      deeplink_target: row.deeplink_target,
      requires_login: row.requires_login,
      order_index: row.order_index,
    },
  };
}

function mapSubsectionAdmin(row: typeof library_subsections.$inferSelect) {
  return {
    id: row.id,
    section_id: row.section_id,
    is_published: row.is_published,
    content_version: row.content_version,
    draft: {
      name_en: row.draft_name_en,
      name_hi: row.draft_name_hi,
      name_gu: row.draft_name_gu,
      order_index: row.draft_order_index,
    },
    published: {
      name_en: row.name_en,
      name_hi: row.name_hi,
      name_gu: row.name_gu,
      order_index: row.order_index,
    },
  };
}

function mapItemAdmin(row: typeof library_items.$inferSelect) {
  return {
    id: row.id,
    section_id: row.section_id,
    subsection_id: row.subsection_id,
    item_code: row.item_code,
    is_published: row.is_published,
    content_version: row.content_version,
    draft: {
      title_en: row.draft_title_en,
      title_hi: row.draft_title_hi,
      title_gu: row.draft_title_gu,
      order_index: row.draft_order_index,
      audio_url: row.draft_audio_url,
      audio_size_bytes: row.draft_audio_size_bytes,
      audio_duration_sec: row.draft_audio_duration_sec,
      youtube_url: row.draft_youtube_url,
      text_content_en: row.draft_text_content_en,
      text_content_hi: row.draft_text_content_hi,
      text_content_gu: row.draft_text_content_gu,
    },
    published: {
      title_en: row.title_en,
      title_hi: row.title_hi,
      title_gu: row.title_gu,
      order_index: row.order_index,
      audio_url: row.audio_url,
      audio_size_bytes: row.audio_size_bytes,
      audio_duration_sec: row.audio_duration_sec,
      youtube_url: row.youtube_url,
      text_content_en: row.text_content_en,
      text_content_hi: row.text_content_hi,
      text_content_gu: row.text_content_gu,
    },
  };
}

async function nextSectionDraftOrder(): Promise<number> {
  const [row] = await db
    .select({ m: max(library_sections.draft_order_index) })
    .from(library_sections)
    .where(isNull(library_sections.deleted_at));
  return (row?.m ?? -1) + 1;
}

async function nextSubsectionDraftOrder(sectionId: string): Promise<number> {
  const [row] = await db
    .select({ m: max(library_subsections.draft_order_index) })
    .from(library_subsections)
    .where(
      and(
        eq(library_subsections.section_id, sectionId),
        isNull(library_subsections.deleted_at),
      ),
    );
  return (row?.m ?? -1) + 1;
}

async function nextItemDraftOrder(
  sectionId: string,
  subsectionId: string | null,
): Promise<number> {
  const conds = [
    eq(library_items.section_id, sectionId),
    isNull(library_items.deleted_at),
  ];
  if (subsectionId) conds.push(eq(library_items.subsection_id, subsectionId));
  else conds.push(isNull(library_items.subsection_id));
  const [row] = await db
    .select({ m: max(library_items.draft_order_index) })
    .from(library_items)
    .where(and(...conds));
  return (row?.m ?? -1) + 1;
}

async function nextPublishedOrder(
  table: "sections" | "subsections" | "items",
  sectionId?: string,
  subsectionId?: string | null,
): Promise<number> {
  if (table === "sections") {
    const [row] = await db
      .select({ m: max(library_sections.order_index) })
      .from(library_sections)
      .where(isNull(library_sections.deleted_at));
    return (row?.m ?? -1) + 1;
  }
  if (table === "subsections") {
    const [row] = await db
      .select({ m: max(library_subsections.order_index) })
      .from(library_subsections)
      .where(
        and(
          eq(library_subsections.section_id, sectionId!),
          isNull(library_subsections.deleted_at),
        ),
      );
    return (row?.m ?? -1) + 1;
  }
  const conds = [
    eq(library_items.section_id, sectionId!),
    isNull(library_items.deleted_at),
  ];
  if (subsectionId) conds.push(eq(library_items.subsection_id, subsectionId));
  else conds.push(isNull(library_items.subsection_id));
  const [row] = await db
    .select({ m: max(library_items.order_index) })
    .from(library_items)
    .where(and(...conds));
  return (row?.m ?? -1) + 1;
}

/* ── Tree ─────────────────────────────────────────────────────────────────── */

router.get("/", async (_req: Request, res: Response) => {
  const sections = await db
    .select()
    .from(library_sections)
    .where(isNull(library_sections.deleted_at))
    .orderBy(asc(library_sections.draft_order_index));
  const sectionIds = sections.map((s) => s.id);
  const subsections =
    sectionIds.length === 0
      ? []
      : await db
          .select()
          .from(library_subsections)
          .where(
            and(
              inArray(library_subsections.section_id, sectionIds),
              isNull(library_subsections.deleted_at),
            ),
          )
          .orderBy(asc(library_subsections.draft_order_index));
  const items =
    sectionIds.length === 0
      ? []
      : await db
          .select()
          .from(library_items)
          .where(
            and(
              inArray(library_items.section_id, sectionIds),
              isNull(library_items.deleted_at),
            ),
          )
          .orderBy(asc(library_items.draft_order_index));

  const tree = sections.map((s) => ({
    ...mapSectionAdmin(s),
    subsections: subsections
      .filter((sub) => sub.section_id === s.id)
      .map((sub) => ({
        ...mapSubsectionAdmin(sub),
        items: items
          .filter((i) => i.subsection_id === sub.id)
          .map(mapItemAdmin),
      })),
    items: items.filter((i) => i.section_id === s.id && !i.subsection_id).map(mapItemAdmin),
  }));

  ok(res, { sections: tree, can_edit: true }, { count: tree.length });
});

/* ── Sections ─────────────────────────────────────────────────────────────── */

const sectionCreateSchema = z.object({
  key: z.string().min(1).max(80),
  name_en: z.string().min(1),
  name_hi: z.string().nullable().optional(),
  name_gu: z.string().nullable().optional(),
  icon_url: z.string().nullable().optional(),
  type: sectionTypeSchema,
  deeplink_target: z.string().nullable().optional(),
  requires_login: z.boolean().optional(),
});

router.post("/sections", async (req: Request, res: Response) => {
  const parsed = sectionCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid section payload.", zodDetails(parsed.error));
    return;
  }
  const b = parsed.data;
  const draftOrder = await nextSectionDraftOrder();
  const pubOrder = await nextPublishedOrder("sections");
  try {
    const [row] = await db
      .insert(library_sections)
      .values({
        key: b.key,
        name_en: b.name_en,
        name_hi: b.name_hi ?? null,
        name_gu: b.name_gu ?? null,
        icon_url: b.icon_url ?? null,
        type: b.type,
        deeplink_target: b.deeplink_target ?? null,
        requires_login: b.requires_login ?? false,
        order_index: pubOrder,
        draft_name_en: b.name_en,
        draft_name_hi: b.name_hi ?? null,
        draft_name_gu: b.name_gu ?? null,
        draft_icon_url: b.icon_url ?? null,
        draft_type: b.type,
        draft_deeplink_target: b.deeplink_target ?? null,
        draft_requires_login: b.requires_login ?? false,
        draft_order_index: draftOrder,
        is_published: false,
        content_version: 1,
      })
      .returning();
    await auditFromReq(req, {
      action: "create",
      entityKind: "library_section",
      entityId: row!.id,
      summary: `Library section draft created (${b.key}).`,
    });
    ok(res, { section: mapSectionAdmin(row!) });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("idx_library_sections_key") || msg.includes("unique")) {
      fail(res, 409, "ERR_CONFLICT", "A section with that key already exists.");
      return;
    }
    throw e;
  }
});

router.get("/sections/:id", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "That library section could not be found.");
    return;
  }
  const [row] = await db
    .select()
    .from(library_sections)
    .where(and(eq(library_sections.id, id), isNull(library_sections.deleted_at)))
    .limit(1);
  if (!row) {
    fail(res, 404, "ERR_NOT_FOUND", "That library section could not be found.");
    return;
  }
  ok(res, { section: mapSectionAdmin(row) });
});

const sectionPatchSchema = sectionCreateSchema.partial().omit({ key: true }).extend({
  key: z.string().min(1).max(80).optional(),
});

router.patch("/sections/:id", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "That library section could not be found.");
    return;
  }
  const parsed = sectionPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid section payload.", zodDetails(parsed.error));
    return;
  }
  const b = parsed.data;
  const patch: Record<string, unknown> = { updated_at: new Date() };
  if (b.key !== undefined) patch.key = b.key;
  if (b.name_en !== undefined) patch.draft_name_en = b.name_en;
  if (b.name_hi !== undefined) patch.draft_name_hi = b.name_hi;
  if (b.name_gu !== undefined) patch.draft_name_gu = b.name_gu;
  if (b.icon_url !== undefined) patch.draft_icon_url = b.icon_url;
  if (b.type !== undefined) patch.draft_type = b.type;
  if (b.deeplink_target !== undefined) patch.draft_deeplink_target = b.deeplink_target;
  if (b.requires_login !== undefined) patch.draft_requires_login = b.requires_login;

  const [row] = await db
    .update(library_sections)
    .set(patch)
    .where(and(eq(library_sections.id, id), isNull(library_sections.deleted_at)))
    .returning();
  if (!row) {
    fail(res, 404, "ERR_NOT_FOUND", "That library section could not be found.");
    return;
  }
  await auditFromReq(req, {
    action: "update",
    entityKind: "library_section",
    entityId: id,
    summary: "Library section draft updated.",
  });
  ok(res, { section: mapSectionAdmin(row) });
});

router.delete("/sections/:id", requirePublisher, async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const [row] = await db
    .update(library_sections)
    .set({ deleted_at: new Date(), updated_at: new Date() })
    .where(and(eq(library_sections.id, id), isNull(library_sections.deleted_at)))
    .returning();
  if (!row) {
    fail(res, 404, "ERR_NOT_FOUND", "That library section could not be found.");
    return;
  }
  await auditFromReq(req, {
    action: "delete",
    entityKind: "library_section",
    entityId: id,
    summary: "Library section soft-deleted.",
  });
  ok(res, { id, deleted: true });
});

router.post("/sections/:id/publish", requirePublisher, async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const row = await publishSection(id);
  if (!row) {
    fail(res, 404, "ERR_NOT_FOUND", "That library section could not be found.");
    return;
  }
  await auditFromReq(req, {
    action: "update",
    entityKind: "library_section",
    entityId: id,
    summary: "Library section published.",
    metadata: { content_version: row.content_version },
  });
  ok(res, { section: mapSectionAdmin(row) });
});

router.post("/sections/:id/unpublish", requirePublisher, async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const row = await unpublishSection(id);
  if (!row) {
    fail(res, 404, "ERR_NOT_FOUND", "That library section could not be found.");
    return;
  }
  await auditFromReq(req, {
    action: "update",
    entityKind: "library_section",
    entityId: id,
    summary: "Library section unpublished.",
  });
  ok(res, { section: mapSectionAdmin(row) });
});

router.post("/sections/reorder", async (req: Request, res: Response) => {
  const parsed = reorderSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "ids must be a non-empty UUID array.", zodDetails(parsed.error));
    return;
  }
  const { ids } = parsed.data;
  await db.transaction(async (tx) => {
    // Two-phase to avoid unique collisions on draft_order_index.
    for (let i = 0; i < ids.length; i++) {
      await tx
        .update(library_sections)
        .set({ draft_order_index: 100_000 + i, updated_at: new Date() })
        .where(and(eq(library_sections.id, ids[i]!), isNull(library_sections.deleted_at)));
    }
    for (let i = 0; i < ids.length; i++) {
      await tx
        .update(library_sections)
        .set({ draft_order_index: i, updated_at: new Date() })
        .where(eq(library_sections.id, ids[i]!));
    }
  });
  ok(res, { reordered: ids.length });
});

/* ── Subsections ──────────────────────────────────────────────────────────── */

const subsectionCreateSchema = z.object({
  name_en: z.string().min(1),
  name_hi: z.string().nullable().optional(),
  name_gu: z.string().nullable().optional(),
});

router.post("/sections/:sectionId/subsections", async (req: Request, res: Response) => {
  const sectionId = String(req.params.sectionId);
  if (!UUID_RE.test(sectionId)) {
    fail(res, 404, "ERR_NOT_FOUND", "That library section could not be found.");
    return;
  }
  const [section] = await db
    .select({ id: library_sections.id })
    .from(library_sections)
    .where(and(eq(library_sections.id, sectionId), isNull(library_sections.deleted_at)))
    .limit(1);
  if (!section) {
    fail(res, 404, "ERR_NOT_FOUND", "That library section could not be found.");
    return;
  }
  const parsed = subsectionCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid subsection payload.", zodDetails(parsed.error));
    return;
  }
  const b = parsed.data;
  const draftOrder = await nextSubsectionDraftOrder(sectionId);
  const pubOrder = await nextPublishedOrder("subsections", sectionId);
  const [row] = await db
    .insert(library_subsections)
    .values({
      section_id: sectionId,
      name_en: b.name_en,
      name_hi: b.name_hi ?? null,
      name_gu: b.name_gu ?? null,
      order_index: pubOrder,
      draft_name_en: b.name_en,
      draft_name_hi: b.name_hi ?? null,
      draft_name_gu: b.name_gu ?? null,
      draft_order_index: draftOrder,
      is_published: false,
      content_version: 1,
    })
    .returning();
  await auditFromReq(req, {
    action: "create",
    entityKind: "library_subsection",
    entityId: row!.id,
    summary: "Library subsection draft created.",
  });
  ok(res, { subsection: mapSubsectionAdmin(row!) });
});

router.patch("/subsections/:id", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const parsed = subsectionCreateSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid subsection payload.", zodDetails(parsed.error));
    return;
  }
  const b = parsed.data;
  const patch: Record<string, unknown> = { updated_at: new Date() };
  if (b.name_en !== undefined) patch.draft_name_en = b.name_en;
  if (b.name_hi !== undefined) patch.draft_name_hi = b.name_hi;
  if (b.name_gu !== undefined) patch.draft_name_gu = b.name_gu;
  const [row] = await db
    .update(library_subsections)
    .set(patch)
    .where(and(eq(library_subsections.id, id), isNull(library_subsections.deleted_at)))
    .returning();
  if (!row) {
    fail(res, 404, "ERR_NOT_FOUND", "That subsection could not be found.");
    return;
  }
  ok(res, { subsection: mapSubsectionAdmin(row) });
});

router.delete("/subsections/:id", requirePublisher, async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const [row] = await db
    .update(library_subsections)
    .set({ deleted_at: new Date(), updated_at: new Date() })
    .where(and(eq(library_subsections.id, id), isNull(library_subsections.deleted_at)))
    .returning();
  if (!row) {
    fail(res, 404, "ERR_NOT_FOUND", "That subsection could not be found.");
    return;
  }
  ok(res, { id, deleted: true });
});

router.post("/subsections/:id/publish", requirePublisher, async (req: Request, res: Response) => {
  const row = await publishSubsection(String(req.params.id));
  if (!row) {
    fail(res, 404, "ERR_NOT_FOUND", "That subsection could not be found.");
    return;
  }
  ok(res, { subsection: mapSubsectionAdmin(row) });
});

router.post("/subsections/:id/unpublish", requirePublisher, async (req: Request, res: Response) => {
  const row = await unpublishSubsection(String(req.params.id));
  if (!row) {
    fail(res, 404, "ERR_NOT_FOUND", "That subsection could not be found.");
    return;
  }
  ok(res, { subsection: mapSubsectionAdmin(row) });
});

router.post("/sections/:sectionId/subsections/reorder", async (req: Request, res: Response) => {
  const sectionId = String(req.params.sectionId);
  const parsed = reorderSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "ids must be a non-empty UUID array.", zodDetails(parsed.error));
    return;
  }
  const { ids } = parsed.data;
  await db.transaction(async (tx) => {
    for (let i = 0; i < ids.length; i++) {
      await tx
        .update(library_subsections)
        .set({ draft_order_index: 100_000 + i, updated_at: new Date() })
        .where(
          and(
            eq(library_subsections.id, ids[i]!),
            eq(library_subsections.section_id, sectionId),
            isNull(library_subsections.deleted_at),
          ),
        );
    }
    for (let i = 0; i < ids.length; i++) {
      await tx
        .update(library_subsections)
        .set({ draft_order_index: i, updated_at: new Date() })
        .where(eq(library_subsections.id, ids[i]!));
    }
  });
  ok(res, { reordered: ids.length });
});

/* ── Items ────────────────────────────────────────────────────────────────── */

const itemCreateSchema = z.object({
  section_id: z.string().uuid(),
  subsection_id: z.string().uuid().nullable().optional(),
  item_code: z.string().min(1).max(80),
  title_en: z.string().min(1),
  title_hi: z.string().nullable().optional(),
  title_gu: z.string().nullable().optional(),
  youtube_url: z.string().nullable().optional(),
  text_content_en: z.string().nullable().optional(),
  text_content_hi: z.string().nullable().optional(),
  text_content_gu: z.string().nullable().optional(),
});

router.post("/items", async (req: Request, res: Response) => {
  const parsed = itemCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid item payload.", zodDetails(parsed.error));
    return;
  }
  const b = parsed.data;
  const textEn = b.text_content_en != null ? sanitizeLibraryHtml(b.text_content_en) : null;
  const textHi = b.text_content_hi != null ? sanitizeLibraryHtml(b.text_content_hi) : null;
  const textGu = b.text_content_gu != null ? sanitizeLibraryHtml(b.text_content_gu) : null;
  const subId = b.subsection_id ?? null;
  const draftOrder = await nextItemDraftOrder(b.section_id, subId);
  const pubOrder = await nextPublishedOrder("items", b.section_id, subId);
  try {
    const [row] = await db
      .insert(library_items)
      .values({
        section_id: b.section_id,
        subsection_id: subId,
        item_code: b.item_code,
        title_en: b.title_en,
        title_hi: b.title_hi ?? null,
        title_gu: b.title_gu ?? null,
        order_index: pubOrder,
        youtube_url: b.youtube_url ?? null,
        text_content_en: textEn,
        text_content_hi: textHi,
        text_content_gu: textGu,
        draft_title_en: b.title_en,
        draft_title_hi: b.title_hi ?? null,
        draft_title_gu: b.title_gu ?? null,
        draft_order_index: draftOrder,
        draft_youtube_url: b.youtube_url ?? null,
        draft_text_content_en: textEn,
        draft_text_content_hi: textHi,
        draft_text_content_gu: textGu,
        is_published: false,
        content_version: 1,
      })
      .returning();
    await auditFromReq(req, {
      action: "create",
      entityKind: "library_item",
      entityId: row!.id,
      summary: `Library item draft created (${b.item_code}).`,
    });
    ok(res, { item: mapItemAdmin(row!) });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("item_code") || msg.includes("unique")) {
      fail(res, 409, "ERR_CONFLICT", "An item with that item_code already exists.");
      return;
    }
    throw e;
  }
});

router.get("/items/:id", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const [row] = await db
    .select()
    .from(library_items)
    .where(and(eq(library_items.id, id), isNull(library_items.deleted_at)))
    .limit(1);
  if (!row) {
    fail(res, 404, "ERR_NOT_FOUND", "That library item could not be found.");
    return;
  }
  ok(res, { item: mapItemAdmin(row) });
});

router.patch("/items/:id", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const parsed = itemCreateSchema
    .partial()
    .omit({ section_id: true, item_code: true })
    .extend({
      item_code: z.string().min(1).max(80).optional(),
      subsection_id: z.string().uuid().nullable().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid item payload.", zodDetails(parsed.error));
    return;
  }
  const b = parsed.data;
  const patch: Record<string, unknown> = { updated_at: new Date() };
  if (b.item_code !== undefined) patch.item_code = b.item_code;
  if (b.subsection_id !== undefined) patch.subsection_id = b.subsection_id;
  if (b.title_en !== undefined) patch.draft_title_en = b.title_en;
  if (b.title_hi !== undefined) patch.draft_title_hi = b.title_hi;
  if (b.title_gu !== undefined) patch.draft_title_gu = b.title_gu;
  if (b.youtube_url !== undefined) patch.draft_youtube_url = b.youtube_url;
  if (b.text_content_en !== undefined) {
    patch.draft_text_content_en =
      b.text_content_en == null ? null : sanitizeLibraryHtml(b.text_content_en);
  }
  if (b.text_content_hi !== undefined) {
    patch.draft_text_content_hi =
      b.text_content_hi == null ? null : sanitizeLibraryHtml(b.text_content_hi);
  }
  if (b.text_content_gu !== undefined) {
    patch.draft_text_content_gu =
      b.text_content_gu == null ? null : sanitizeLibraryHtml(b.text_content_gu);
  }
  const [row] = await db
    .update(library_items)
    .set(patch)
    .where(and(eq(library_items.id, id), isNull(library_items.deleted_at)))
    .returning();
  if (!row) {
    fail(res, 404, "ERR_NOT_FOUND", "That library item could not be found.");
    return;
  }
  ok(res, { item: mapItemAdmin(row) });
});

router.delete("/items/:id", requirePublisher, async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const [row] = await db
    .update(library_items)
    .set({ deleted_at: new Date(), updated_at: new Date() })
    .where(and(eq(library_items.id, id), isNull(library_items.deleted_at)))
    .returning();
  if (!row) {
    fail(res, 404, "ERR_NOT_FOUND", "That library item could not be found.");
    return;
  }
  ok(res, { id, deleted: true });
});

router.post("/items/:id/publish", requirePublisher, async (req: Request, res: Response) => {
  const row = await publishItem(String(req.params.id));
  if (!row) {
    fail(res, 404, "ERR_NOT_FOUND", "That library item could not be found.");
    return;
  }
  ok(res, { item: mapItemAdmin(row) });
});

router.post("/items/:id/unpublish", requirePublisher, async (req: Request, res: Response) => {
  const row = await unpublishItem(String(req.params.id));
  if (!row) {
    fail(res, 404, "ERR_NOT_FOUND", "That library item could not be found.");
    return;
  }
  ok(res, { item: mapItemAdmin(row) });
});

router.post("/items/reorder", async (req: Request, res: Response) => {
  const parsed = reorderSchema
    .extend({
      section_id: z.string().uuid().optional(),
      subsection_id: z.string().uuid().nullable().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid reorder payload.", zodDetails(parsed.error));
    return;
  }
  const { ids } = parsed.data;
  await db.transaction(async (tx) => {
    for (let i = 0; i < ids.length; i++) {
      await tx
        .update(library_items)
        .set({ draft_order_index: 100_000 + i, updated_at: new Date() })
        .where(and(eq(library_items.id, ids[i]!), isNull(library_items.deleted_at)));
    }
    for (let i = 0; i < ids.length; i++) {
      await tx
        .update(library_items)
        .set({ draft_order_index: i, updated_at: new Date() })
        .where(eq(library_items.id, ids[i]!));
    }
  });
  ok(res, { reordered: ids.length });
});

/* ── Audio ────────────────────────────────────────────────────────────────── */

async function applyAudioToItem(
  itemId: string,
  filePath: string,
  originalName: string,
  uploadedBy: string | undefined,
) {
  const buf = await readFile(filePath);
  const audio = await processLibraryMp3(buf, originalName);
  if (uploadedBy) {
    await db
      .insert(upload_objects)
      .values({
        key: audio.key,
        uploaded_by: uploadedBy,
        content_type: "audio/mpeg",
      })
      .onConflictDoUpdate({
        target: upload_objects.key,
        set: {
          uploaded_by: uploadedBy,
          content_type: "audio/mpeg",
          created_at: sql`now()`,
        },
      });
  }
  const [row] = await db
    .update(library_items)
    .set({
      draft_audio_url: audio.url,
      draft_audio_size_bytes: audio.size_bytes,
      draft_audio_duration_sec: audio.duration_sec,
      updated_at: new Date(),
    })
    .where(and(eq(library_items.id, itemId), isNull(library_items.deleted_at)))
    .returning();
  return { row, audio };
}

router.post(
  "/items/:id/audio",
  (req: Request, res: Response, next: NextFunction) => {
    audioUpload.single("file")(req, res, (err: unknown) => {
      if (err) {
        fail(
          res,
          422,
          "ERR_VALIDATION_FAILED",
          err instanceof Error ? err.message : "Invalid audio upload.",
        );
        return;
      }
      next();
    });
  },
  async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const file = req.file;
    if (!file?.path) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "No MP3 file provided.");
      return;
    }
    try {
      const { row, audio } = await applyAudioToItem(
        id,
        file.path,
        file.originalname,
        req.authUser?.id,
      );
      if (!row) {
        fail(res, 404, "ERR_NOT_FOUND", "That library item could not be found.");
        return;
      }
      ok(res, {
        item: mapItemAdmin(row),
        audio: {
          url: audio.url,
          duration_sec: audio.duration_sec,
          size_bytes: audio.size_bytes,
        },
      });
    } catch (e) {
      if (e instanceof LibraryAudioError) {
        fail(res, e.status, e.code, e.message);
        return;
      }
      throw e;
    } finally {
      await unlink(file.path).catch(() => undefined);
    }
  },
);

router.post(
  "/audio/bulk",
  (req: Request, res: Response, next: NextFunction) => {
    audioUpload.array("files", 40)(req, res, (err: unknown) => {
      if (err) {
        fail(
          res,
          422,
          "ERR_VALIDATION_FAILED",
          err instanceof Error ? err.message : "Invalid audio upload.",
        );
        return;
      }
      next();
    });
  },
  async (req: Request, res: Response) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const results: Array<{
      filename: string;
      item_code: string | null;
      status: "success" | "failed";
      error?: string;
      item_id?: string;
    }> = [];

    for (const file of files) {
      const code = itemCodeFromFilename(file.originalname);
      try {
        if (!code) {
          results.push({
            filename: file.originalname,
            item_code: null,
            status: "failed",
            error: "Could not parse item_code from filename.",
          });
          continue;
        }
        const [item] = await db
          .select()
          .from(library_items)
          .where(and(eq(library_items.item_code, code), isNull(library_items.deleted_at)))
          .limit(1);
        if (!item) {
          results.push({
            filename: file.originalname,
            item_code: code,
            status: "failed",
            error: "No library item matches that item_code.",
          });
          continue;
        }
        await applyAudioToItem(item.id, file.path, file.originalname, req.authUser?.id);
        results.push({
          filename: file.originalname,
          item_code: code,
          status: "success",
          item_id: item.id,
        });
      } catch (e) {
        results.push({
          filename: file.originalname,
          item_code: code,
          status: "failed",
          error: e instanceof Error ? e.message : "Upload failed.",
        });
      } finally {
        await unlink(file.path).catch(() => undefined);
      }
    }

    ok(res, { results }, { count: results.length });
  },
);

/* ── Panchang years ───────────────────────────────────────────────────────── */

router.get("/panchang/years", async (_req: Request, res: Response) => {
  const rows = await db
    .select({
      id: panchang_years.id,
      year: panchang_years.year,
      sect: panchang_years.sect,
      is_published: panchang_years.is_published,
      content_version: panchang_years.content_version,
    })
    .from(panchang_years)
    .where(isNull(panchang_years.deleted_at))
    .orderBy(asc(panchang_years.year));
  ok(res, { items: rows }, { count: rows.length });
});

router.get("/panchang/years/:year", async (req: Request, res: Response) => {
  const year = Number(req.params.year);
  if (!Number.isFinite(year)) {
    fail(res, 404, "ERR_NOT_FOUND", "That Panchang year could not be found.");
    return;
  }
  const [row] = await db
    .select()
    .from(panchang_years)
    .where(and(eq(panchang_years.year, year), isNull(panchang_years.deleted_at)))
    .limit(1);
  if (!row) {
    fail(res, 404, "ERR_NOT_FOUND", "That Panchang year could not be found.");
    return;
  }
  ok(res, {
    year: row.year,
    is_published: row.is_published,
    content_version: row.content_version,
    draft: row.draft_payload,
    published: row.published_payload,
  });
});

router.post("/panchang/years", async (req: Request, res: Response) => {
  const parsed = panchangYearSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(
      res,
      400,
      "ERR_VALIDATION_FAILED",
      "Panchang year JSON failed validation.",
      zodDetails(parsed.error),
    );
    return;
  }
  const payload = parsed.data;
  const year = payload.year;
  if (year == null) {
    fail(res, 400, "ERR_VALIDATION_FAILED", "year is required on the payload.", [
      { path: "year", message: "Required" },
    ]);
    return;
  }
  try {
    const [row] = await db
      .insert(panchang_years)
      .values({
        year,
        sect: payload.sect,
        vikram_samvat: payload.vikramSamvat,
        veer_samvat: payload.veerSamvat,
        draft_payload: payload,
        is_published: false,
        content_version: 1,
      })
      .returning();
    ok(res, {
      year: row!.year,
      is_published: false,
      content_version: 1,
      draft: row!.draft_payload,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("uq_panchang") || msg.includes("unique")) {
      fail(res, 409, "ERR_CONFLICT", "A Panchang draft for that year already exists.");
      return;
    }
    throw e;
  }
});

router.put("/panchang/years/:year", async (req: Request, res: Response) => {
  const year = Number(req.params.year);
  const parsed = panchangYearSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(
      res,
      400,
      "ERR_VALIDATION_FAILED",
      "Panchang year JSON failed validation.",
      zodDetails(parsed.error),
    );
    return;
  }
  const payload = { ...parsed.data, year };
  const [row] = await db
    .update(panchang_years)
    .set({
      draft_payload: payload,
      sect: payload.sect,
      vikram_samvat: payload.vikramSamvat,
      veer_samvat: payload.veerSamvat,
      updated_at: new Date(),
    })
    .where(and(eq(panchang_years.year, year), isNull(panchang_years.deleted_at)))
    .returning();
  if (!row) {
    fail(res, 404, "ERR_NOT_FOUND", "That Panchang year could not be found.");
    return;
  }
  ok(res, {
    year: row.year,
    is_published: row.is_published,
    content_version: row.content_version,
    draft: row.draft_payload,
  });
});

router.patch("/panchang/years/:year/days/:date", async (req: Request, res: Response) => {
  const year = Number(req.params.year);
  const date = String(req.params.date);
  const parsed = panchangDaySchema.safeParse({ ...req.body, date });
  if (!parsed.success) {
    fail(
      res,
      400,
      "ERR_VALIDATION_FAILED",
      "Panchang day failed validation.",
      zodDetails(parsed.error),
    );
    return;
  }
  const [row] = await db
    .select()
    .from(panchang_years)
    .where(and(eq(panchang_years.year, year), isNull(panchang_years.deleted_at)))
    .limit(1);
  if (!row) {
    fail(res, 404, "ERR_NOT_FOUND", "That Panchang year could not be found.");
    return;
  }
  const draft = row.draft_payload as {
    days?: unknown[];
    [k: string]: unknown;
  };
  const days = Array.isArray(draft.days) ? [...draft.days] : [];
  const idx = days.findIndex(
    (d) => d && typeof d === "object" && (d as { date?: string }).date === date,
  );
  if (idx >= 0) days[idx] = parsed.data;
  else days.push(parsed.data);
  const next = { ...draft, days };
  const yearCheck = panchangYearSchema.safeParse(next);
  if (!yearCheck.success) {
    fail(
      res,
      400,
      "ERR_VALIDATION_FAILED",
      "Updated year payload failed validation.",
      zodDetails(yearCheck.error),
    );
    return;
  }
  const [updated] = await db
    .update(panchang_years)
    .set({ draft_payload: yearCheck.data, updated_at: new Date() })
    .where(eq(panchang_years.id, row.id))
    .returning();
  ok(res, {
    year: updated!.year,
    draft: updated!.draft_payload,
    day: parsed.data,
  });
});

router.post(
  "/panchang/years/:year/publish",
  requirePublisher,
  async (req: Request, res: Response) => {
    const year = Number(req.params.year);
    const row = await publishPanchangYear(year);
    if (!row) {
      fail(res, 404, "ERR_NOT_FOUND", "That Panchang year could not be found.");
      return;
    }
    ok(res, {
      year: row.year,
      is_published: row.is_published,
      content_version: row.content_version,
      published: row.published_payload,
    });
  },
);

router.post(
  "/panchang/years/:year/unpublish",
  requirePublisher,
  async (req: Request, res: Response) => {
    const year = Number(req.params.year);
    const row = await unpublishPanchangYear(year);
    if (!row) {
      fail(res, 404, "ERR_NOT_FOUND", "That Panchang year could not be found.");
      return;
    }
    ok(res, { year: row.year, is_published: false });
  },
);

/* ── Media usage / orphan cleanup ─────────────────────────────────────────── */

router.get("/media/usage", async (_req: Request, res: Response) => {
  const usage = await getLibraryMediaUsage();
  ok(res, usage, { count: usage.orphans.length });
});

const orphanCleanupSchema = z.object({
  keys: z.array(z.string().min(1)).optional(),
});

router.post(
  "/media/orphans/cleanup",
  requirePublisher,
  async (req: Request, res: Response) => {
    const parsed = orphanCleanupSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid cleanup payload.", zodDetails(parsed.error));
      return;
    }
    const result = await cleanupLibraryOrphans(parsed.data.keys ?? []);
    await auditFromReq(req, {
      action: "delete",
      entityKind: "library_media",
      entityId: null,
      summary: `Library orphan cleanup deleted ${result.deleted} file(s).`,
      metadata: { deleted: result.deleted, failed: result.failed },
    });
    ok(res, result);
  },
);

export default router;
