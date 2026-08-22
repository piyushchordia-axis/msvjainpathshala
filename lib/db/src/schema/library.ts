import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { softDelete, timestamps } from "./_helpers";
import {
  libraryAccessEventEnum,
  libraryContentRequestStatusEnum,
  librarySectionTypeEnum,
} from "./enums";
import { cities } from "./geography";
import { users } from "./identity";

/**
 * Library rebuild: Section → SubSection → LibraryItem.
 * Clients branch on `type` (item_list | deeplink | panchang | granth) — never on name_*.
 *
 * Published columns (name_en, …) are what public/member APIs read.
 * draft_* columns are the working copy; publish copies draft → published.
 */
export const library_sections = pgTable(
  "library_sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    name_en: text("name_en").notNull(),
    name_hi: text("name_hi"),
    name_gu: text("name_gu"),
    icon_url: text("icon_url"),
    order_index: integer("order_index").notNull().default(0),
    type: librarySectionTypeEnum("type").notNull(),
    deeplink_target: text("deeplink_target"),
    requires_login: boolean("requires_login").notNull().default(false),
    draft_name_en: text("draft_name_en").notNull(),
    draft_name_hi: text("draft_name_hi"),
    draft_name_gu: text("draft_name_gu"),
    draft_icon_url: text("draft_icon_url"),
    draft_type: librarySectionTypeEnum("draft_type").notNull(),
    draft_deeplink_target: text("draft_deeplink_target"),
    draft_requires_login: boolean("draft_requires_login").notNull().default(false),
    draft_order_index: integer("draft_order_index").notNull().default(0),
    is_published: boolean("is_published").notNull().default(false),
    content_version: integer("content_version").notNull().default(1),
    ...softDelete(),
    ...timestamps(),
  },
  (t) => ({
    key_uq: uniqueIndex("idx_library_sections_key").on(t.key),
    type_idx: index("idx_library_sections_type").on(t.type),
    order_alive_uq: uniqueIndex("idx_library_sections_order")
      .on(t.order_index)
      .where(sql`${t.deleted_at} IS NULL`),
    draft_order_alive_uq: uniqueIndex("idx_library_sections_draft_order")
      .on(t.draft_order_index)
      .where(sql`${t.deleted_at} IS NULL`),
  }),
);

export const library_subsections = pgTable(
  "library_subsections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    section_id: uuid("section_id")
      .notNull()
      .references(() => library_sections.id, { onDelete: "restrict" }),
    name_en: text("name_en").notNull(),
    name_hi: text("name_hi"),
    name_gu: text("name_gu"),
    order_index: integer("order_index").notNull().default(0),
    draft_name_en: text("draft_name_en").notNull(),
    draft_name_hi: text("draft_name_hi"),
    draft_name_gu: text("draft_name_gu"),
    draft_order_index: integer("draft_order_index").notNull().default(0),
    is_published: boolean("is_published").notNull().default(false),
    content_version: integer("content_version").notNull().default(1),
    ...softDelete(),
    ...timestamps(),
  },
  (t) => ({
    section_idx: index("idx_library_subsections_section").on(t.section_id),
    order_alive_uq: uniqueIndex("idx_library_subsections_order")
      .on(t.section_id, t.order_index)
      .where(sql`${t.deleted_at} IS NULL`),
    draft_order_alive_uq: uniqueIndex("idx_library_subsections_draft_order")
      .on(t.section_id, t.draft_order_index)
      .where(sql`${t.deleted_at} IS NULL`),
  }),
);

export const library_items = pgTable(
  "library_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    section_id: uuid("section_id")
      .notNull()
      .references(() => library_sections.id, { onDelete: "restrict" }),
    subsection_id: uuid("subsection_id").references(() => library_subsections.id, {
      onDelete: "restrict",
    }),
    item_code: text("item_code").notNull(),
    title_en: text("title_en").notNull(),
    title_hi: text("title_hi"),
    title_gu: text("title_gu"),
    order_index: integer("order_index").notNull().default(0),
    audio_url: text("audio_url"),
    audio_size_bytes: bigint("audio_size_bytes", { mode: "number" }),
    audio_duration_sec: integer("audio_duration_sec"),
    youtube_url: text("youtube_url"),
    text_content_en: text("text_content_en"),
    text_content_hi: text("text_content_hi"),
    text_content_gu: text("text_content_gu"),
    /**
     * v3 §17.1.3 — the melody a piece is sung to. Metadata, not a modality:
     * an item with only a tarj is still contentless. Single-line plain text,
     * search-indexed, rendered nowhere when both are null.
     */
    tarj_en: text("tarj_en"),
    tarj_hi: text("tarj_hi"),
    /**
     * Reserved for SPEC media_assets.id — no FK until that table exists
     * (same holding pattern as team_members.photo_override_asset_id).
     * Never written today: pdf_url below is where a PDF actually lives,
     * matching audio_url rather than v2's audio_asset_id.
     */
    pdf_asset_id: uuid("pdf_asset_id"),
    /** Stored PDF, served through the signed /uploads gate (v3 §17.11.2). */
    pdf_url: text("pdf_url"),
    pdf_size_bytes: bigint("pdf_size_bytes", { mode: "number" }),
    /** Extracted asynchronously post-upload (v3 §17.11.2); null until then. */
    pdf_page_count: integer("pdf_page_count"),
    /** Third-party *document* download. Never video — video stays youtube_url (Q7). */
    external_url: text("external_url"),
    draft_title_en: text("draft_title_en").notNull(),
    draft_title_hi: text("draft_title_hi"),
    draft_title_gu: text("draft_title_gu"),
    draft_order_index: integer("draft_order_index").notNull().default(0),
    draft_audio_url: text("draft_audio_url"),
    draft_audio_size_bytes: bigint("draft_audio_size_bytes", { mode: "number" }),
    draft_audio_duration_sec: integer("draft_audio_duration_sec"),
    draft_youtube_url: text("draft_youtube_url"),
    draft_text_content_en: text("draft_text_content_en"),
    draft_text_content_hi: text("draft_text_content_hi"),
    draft_text_content_gu: text("draft_text_content_gu"),
    /**
     * §17.1.3 — Tarj is edited through the draft gate like every other item
     * field, so a melody correction reaches readers only on publish and bumps
     * content_version, which is what tells offline clients to resync.
     */
    draft_tarj_en: text("draft_tarj_en"),
    draft_tarj_hi: text("draft_tarj_hi"),
    draft_pdf_url: text("draft_pdf_url"),
    draft_pdf_size_bytes: bigint("draft_pdf_size_bytes", { mode: "number" }),
    draft_pdf_page_count: integer("draft_pdf_page_count"),
    draft_external_url: text("draft_external_url"),
    content_version: integer("content_version").notNull().default(1),
    is_published: boolean("is_published").notNull().default(false),
    ...softDelete(),
    ...timestamps(),
  },
  (t) => ({
    item_code_uq: uniqueIndex("idx_library_items_item_code").on(t.item_code),
    section_idx: index("idx_library_items_section").on(t.section_id),
    subsection_idx: index("idx_library_items_subsection").on(t.subsection_id),
    /**
     * v3 §17.1.3 modality constraint, gated on is_published.
     *
     * The spec's unconditional form assumes an item carries its modality from
     * creation. This build does not work that way: `POST /v1/admin/library/items`
     * inserts a title-only draft and audio is attached by a later request, so an
     * unconditional CHECK would reject every item creation. Gating on
     * is_published keeps the guarantee that matters — a reader never opens a
     * published item and finds nothing — while leaving the draft-first flow alone.
     *
     * Column names are this build's, not v2's: audio_url (v2 audio_asset_id),
     * youtube_url (v2 embed_url). v2's generic asset_id has no counterpart here.
     */
    modality_when_published: check(
      "library_items_modality_check",
      sql`NOT ${t.is_published}
          OR ${t.audio_url} IS NOT NULL
          OR ${t.youtube_url} IS NOT NULL
          OR ${t.text_content_en} IS NOT NULL
          OR ${t.pdf_url} IS NOT NULL
          OR ${t.pdf_asset_id} IS NOT NULL
          OR ${t.external_url} IS NOT NULL`,
    ),
  }),
);

/**
 * v3 §17.10 — user-submitted "please add this content" requests.
 *
 * Open to guests: a row is anchored by requester_user_id OR requester_device_id
 * (the same pre-login device identifier §17.9 uses), enforced by CHECK. On first
 * login the device rows are re-keyed to the account, so history and publish
 * notifications become retroactive.
 *
 * No deleted_at: requests are never deleted. `rejected` and `published` are
 * terminal states retained for history and duplicate-spotting.
 */
export const library_content_requests = pgTable(
  "library_content_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * Target section, or suggested_section when the requester picked "Other".
     * ON DELETE restrict, not set null: nulling this out would break the
     * section-or-suggestion CHECK on a row that was valid when written.
     */
    section_id: uuid("section_id").references(() => library_sections.id, {
      onDelete: "restrict",
    }),
    suggested_section: text("suggested_section"),
    title: text("title").notNull(),
    details: text("details").notNull(),
    reference_url: text("reference_url"),
    /** restrict for the same reason as section_id — the requester CHECK depends on it. */
    requester_user_id: uuid("requester_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    /** Pre-login device identifier; null once the requester is a known user. */
    requester_device_id: text("requester_device_id"),
    /** Prefilled from the profile for members, mandatory input for guests. */
    requester_name: text("requester_name").notNull(),
    /** Unverified in v1 (Open Decision 1). Redacted by the PII log filter. */
    requester_phone: varchar("requester_phone", { length: 15 }).notNull(),
    status: libraryContentRequestStatusEnum("status").notNull().default("pending"),
    /** Shown to the requester; recommended on rejection. */
    admin_note: text("admin_note"),
    /** Set when an admin spawns a draft item from the request. */
    linked_item_id: uuid("linked_item_id").references(() => library_items.id, {
      onDelete: "set null",
    }),
    actioned_by: uuid("actioned_by").references(() => users.id, { onDelete: "set null" }),
    actioned_at: timestamp("actioned_at", { withTimezone: true }),
    // X-17 (review 2026-08) — per-row marker so a publish fan-out that fails
    // partway through (one recipient's notifyUsers call throws) can be
    // retried for just the rows still missing a notification, instead of
    // stranding them forever once the row is already terminal (`published`).
    notified_at: timestamp("notified_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => ({
    /** Admin queue: pending first, oldest first. */
    status_created_idx: index("idx_library_content_requests_status_created").on(
      t.status,
      t.created_at,
    ),
    requester_user_idx: index("idx_library_content_requests_user").on(t.requester_user_id),
    requester_device_idx: index("idx_library_content_requests_device").on(t.requester_device_id),
    requester_present: check(
      "library_content_requests_requester_check",
      sql`${t.requester_user_id} IS NOT NULL OR ${t.requester_device_id} IS NOT NULL`,
    ),
    section_present: check(
      "library_content_requests_section_check",
      sql`${t.section_id} IS NOT NULL OR ${t.suggested_section} IS NOT NULL`,
    ),
  }),
);

/**
 * v3 §17.11.3 — physical libraries where granths can be read or borrowed.
 * A directory, not content. Contact details live here only; granth_entries
 * never duplicate them.
 */
export const granth_libraries = pgTable(
  "granth_libraries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name_en: text("name_en").notNull(),
    name_hi: text("name_hi"),
    address_en: text("address_en").notNull(),
    address_hi: text("address_hi"),
    /** Same representation centres use — cities.id, not a string or a new table. */
    city_id: uuid("city_id")
      .notNull()
      .references(() => cities.id, { onDelete: "restrict" }),
    contact_name: text("contact_name"),
    contact_phone: varchar("contact_phone", { length: 15 }),
    /** Drives the WhatsApp deep link on library detail (§17.11.4). */
    has_whatsapp: boolean("has_whatsapp").notNull().default(false),
    timings_en: text("timings_en"),
    timings_hi: text("timings_hi"),
    /** Maps hand-off uses these when present, else an address query. Same precision as centres. */
    lat: numeric("lat", { precision: 10, scale: 7 }),
    lng: numeric("lng", { precision: 10, scale: 7 }),
    note_en: text("note_en"),
    note_hi: text("note_hi"),
    order: integer("order").notNull().default(0),
    /**
     * §17.11.5 — draft/publish per existing library rules. Editing writes
     * here; publish copies across and bumps content_version, which is what
     * tells a device holding the cached directory to refetch it.
     */
    draft_name_en: text("draft_name_en").notNull(),
    draft_name_hi: text("draft_name_hi"),
    draft_address_en: text("draft_address_en").notNull(),
    draft_address_hi: text("draft_address_hi"),
    /**
     * The scoping key, drafted like everything else. A city_admin may not
     * change it — moving a library out of their city is how a scope check
     * that only looked at the live row would be walked around.
     */
    draft_city_id: uuid("draft_city_id")
      .notNull()
      .references(() => cities.id, { onDelete: "restrict" }),
    draft_contact_name: text("draft_contact_name"),
    draft_contact_phone: varchar("draft_contact_phone", { length: 15 }),
    draft_has_whatsapp: boolean("draft_has_whatsapp").notNull().default(false),
    draft_timings_en: text("draft_timings_en"),
    draft_timings_hi: text("draft_timings_hi"),
    draft_lat: numeric("draft_lat", { precision: 10, scale: 7 }),
    draft_lng: numeric("draft_lng", { precision: 10, scale: 7 }),
    draft_note_en: text("draft_note_en"),
    draft_note_hi: text("draft_note_hi"),
    draft_order: integer("draft_order").notNull().default(0),
    is_published: boolean("is_published").notNull().default(false),
    /** Incremented on publish; drives manifest sync (§17.7). */
    content_version: integer("content_version").notNull().default(1),
    ...softDelete(),
    ...timestamps(),
  },
  (t) => ({
    city_idx: index("idx_granth_libraries_city").on(t.city_id),
    draft_city_idx: index("idx_granth_libraries_draft_city").on(t.draft_city_id),
    published_order_idx: index("idx_granth_libraries_published_order")
      .on(t.is_published, t.order)
      .where(sql`${t.deleted_at} IS NULL`),
  }),
);

/**
 * v3 §17.11.3 — granths in the physical directory. Availability is the M2M
 * join; linked_item_id is the optional "Read online" cross-link to a library
 * item (which is where the PDF / text / external link actually lives).
 */
export const granth_entries = pgTable(
  "granth_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title_en: text("title_en").notNull(),
    title_hi: text("title_hi"),
    author_en: text("author_en"),
    author_hi: text("author_hi"),
    /** Free text — granths run to Prakrit, Sanskrit and Gujarati, so not language_enum. */
    language: text("language"),
    description_en: text("description_en"),
    description_hi: text("description_hi"),
    linked_item_id: uuid("linked_item_id").references(() => library_items.id, {
      onDelete: "set null",
    }),
    order: integer("order").notNull().default(0),
    /** §17.11.5 — draft/publish per existing library rules. */
    draft_title_en: text("draft_title_en").notNull(),
    draft_title_hi: text("draft_title_hi"),
    draft_author_en: text("draft_author_en"),
    draft_author_hi: text("draft_author_hi"),
    draft_language: text("draft_language"),
    draft_description_en: text("draft_description_en"),
    draft_description_hi: text("draft_description_hi"),
    draft_linked_item_id: uuid("draft_linked_item_id").references(
      () => library_items.id,
      { onDelete: "set null" },
    ),
    draft_order: integer("draft_order").notNull().default(0),
    is_published: boolean("is_published").notNull().default(false),
    content_version: integer("content_version").notNull().default(1),
    ...softDelete(),
    ...timestamps(),
  },
  (t) => ({
    /** Reverse cross-link: "Available at N libraries" on an online granth item. */
    linked_item_idx: index("idx_granth_entries_linked_item").on(t.linked_item_id),
    published_order_idx: index("idx_granth_entries_published_order")
      .on(t.is_published, t.order)
      .where(sql`${t.deleted_at} IS NULL`),
  }),
);

/** v3 §17.11.3 — which granth is held at which library. Browsable both ways. */
export const granth_availability = pgTable(
  "granth_availability",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    granth_id: uuid("granth_id")
      .notNull()
      .references(() => granth_entries.id, { onDelete: "cascade" }),
    library_id: uuid("library_id")
      .notNull()
      .references(() => granth_libraries.id, { onDelete: "cascade" }),
    /** e.g. "reference only, not for issue". */
    note: text("note"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    granth_library_uq: uniqueIndex("uq_granth_availability_granth_library").on(
      t.granth_id,
      t.library_id,
    ),
    /** Browse-by-library needs the non-leading column of the unique index. */
    library_idx: index("idx_granth_availability_library").on(t.library_id),
  }),
);

/** Admin-authored Panchang year JSON (draft until published). */
export const panchang_years = pgTable(
  "panchang_years",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    year: integer("year").notNull(),
    sect: text("sect").notNull(),
    vikram_samvat: integer("vikram_samvat").notNull(),
    veer_samvat: integer("veer_samvat").notNull(),
    draft_payload: jsonb("draft_payload").$type<Record<string, unknown>>().notNull(),
    published_payload: jsonb("published_payload").$type<Record<string, unknown>>(),
    is_published: boolean("is_published").notNull().default(false),
    content_version: integer("content_version").notNull().default(1),
    ...softDelete(),
    ...timestamps(),
  },
  (t) => ({
    year_uq: uniqueIndex("uq_panchang_years_year").on(t.year),
    published_idx: index("idx_panchang_years_published").on(t.is_published),
  }),
);

/**
 * v3 §17.9 — who reached what, and how.
 *
 * Distinct reach, not an event stream: one row per (item, actor, event)
 * with a count. 0048 collapsed the original append-forever table for that
 * reason and 0056 dropped it only as collateral of the library rebuild.
 *
 * Guests are first-class here — the Library is browsable pre-login, so the
 * actor is a user id OR the same device identifier §17.9 uses before sign-in,
 * enforced by CHECK. On first login the device rows are folded into the
 * account so one human is not counted twice.
 *
 * Analytics only. Nothing here awards Punya (§17.8).
 */
export const library_access_logs = pgTable(
  "library_access_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * Nullable + SET NULL (as 0047 made it): losing an item must not erase
     * the record that people read it.
     */
    library_item_id: uuid("library_item_id").references(() => library_items.id, {
      onDelete: "set null",
    }),
    /**
     * §17.9 `granth_view` is a SECTION open, not a content read. Mutually
     * exclusive with library_item_id — one row targets one thing.
     */
    library_section_id: uuid("library_section_id").references(() => library_sections.id, {
      onDelete: "set null",
    }),
    user_id: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    device_id: text("device_id"),
    event: libraryAccessEventEnum("event").notNull().default("view"),
    access_count: integer("access_count").notNull().default(1),
    accessed_at: timestamp("accessed_at", { withTimezone: true }).notNull().defaultNow(),
    last_accessed_at: timestamp("last_accessed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ...timestamps(),
  },
  (t) => ({
    item_idx: index("idx_library_access_logs_item").on(t.library_item_id),
    section_idx: index("idx_library_access_logs_section").on(t.library_section_id),
    user_idx: index("idx_library_access_logs_user").on(t.user_id),
    /**
     * Partial uniques rather than one wide unique: NULLs compare distinct in
     * a plain unique index, so a guest's every tap would insert a fresh row
     * and access_count would never move off 1. Four of them because the
     * target may be an item or a section, and the actor a user or a device.
     */
    item_user_uq: uniqueIndex("idx_library_access_logs_item_user_event")
      .on(t.library_item_id, t.event, t.user_id)
      .where(sql`${t.library_item_id} IS NOT NULL AND ${t.user_id} IS NOT NULL`),
    item_device_uq: uniqueIndex("idx_library_access_logs_item_device_event")
      .on(t.library_item_id, t.event, t.device_id)
      .where(
        sql`${t.library_item_id} IS NOT NULL AND ${t.user_id} IS NULL AND ${t.device_id} IS NOT NULL`,
      ),
    section_user_uq: uniqueIndex("idx_library_access_logs_section_user_event")
      .on(t.library_section_id, t.event, t.user_id)
      .where(sql`${t.library_section_id} IS NOT NULL AND ${t.user_id} IS NOT NULL`),
    section_device_uq: uniqueIndex("idx_library_access_logs_section_device_event")
      .on(t.library_section_id, t.event, t.device_id)
      .where(
        sql`${t.library_section_id} IS NOT NULL AND ${t.user_id} IS NULL AND ${t.device_id} IS NOT NULL`,
      ),
    actor_present: check(
      "library_access_logs_actor_check",
      sql`${t.user_id} IS NOT NULL OR ${t.device_id} IS NOT NULL`,
    ),
  }),
);

export type LibrarySection = typeof library_sections.$inferSelect;
export type NewLibrarySection = typeof library_sections.$inferInsert;
export type LibrarySubsection = typeof library_subsections.$inferSelect;
export type NewLibrarySubsection = typeof library_subsections.$inferInsert;
export type LibraryItem = typeof library_items.$inferSelect;
export type NewLibraryItem = typeof library_items.$inferInsert;
export type PanchangYearRow = typeof panchang_years.$inferSelect;
export type NewPanchangYearRow = typeof panchang_years.$inferInsert;
export type LibraryContentRequest = typeof library_content_requests.$inferSelect;
export type NewLibraryContentRequest = typeof library_content_requests.$inferInsert;
export type GranthLibrary = typeof granth_libraries.$inferSelect;
export type NewGranthLibrary = typeof granth_libraries.$inferInsert;
export type GranthEntry = typeof granth_entries.$inferSelect;
export type NewGranthEntry = typeof granth_entries.$inferInsert;
export type LibraryAccessLog = typeof library_access_logs.$inferSelect;
export type NewLibraryAccessLog = typeof library_access_logs.$inferInsert;
export type GranthAvailability = typeof granth_availability.$inferSelect;
export type NewGranthAvailability = typeof granth_availability.$inferInsert;
