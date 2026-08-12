import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { softDelete, timestamps } from "./_helpers";
import { librarySectionTypeEnum } from "./enums";

/**
 * Library rebuild: Section → SubSection → LibraryItem.
 * Clients branch on `type` (item_list | deeplink | panchang) — never on name_*.
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
    content_version: integer("content_version").notNull().default(1),
    is_published: boolean("is_published").notNull().default(false),
    ...softDelete(),
    ...timestamps(),
  },
  (t) => ({
    item_code_uq: uniqueIndex("idx_library_items_item_code").on(t.item_code),
    section_idx: index("idx_library_items_section").on(t.section_id),
    subsection_idx: index("idx_library_items_subsection").on(t.subsection_id),
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

export type LibrarySection = typeof library_sections.$inferSelect;
export type NewLibrarySection = typeof library_sections.$inferInsert;
export type LibrarySubsection = typeof library_subsections.$inferSelect;
export type NewLibrarySubsection = typeof library_subsections.$inferInsert;
export type LibraryItem = typeof library_items.$inferSelect;
export type NewLibraryItem = typeof library_items.$inferInsert;
export type PanchangYearRow = typeof panchang_years.$inferSelect;
export type NewPanchangYearRow = typeof panchang_years.$inferInsert;
