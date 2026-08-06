import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { softDelete, timestamps } from "./_helpers";
import { libraryAccessTierEnum, libraryContentTypeEnum } from "./enums";
import { users } from "./identity";

export const library_items = pgTable(
  "library_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    content_type: libraryContentTypeEnum("content_type").notNull(),
    title_en: text("title_en").notNull(),
    title_hi: text("title_hi"),
    description_en: text("description_en"),
    description_hi: text("description_hi"),
    embed_url: text("embed_url"),
    file_url: text("file_url"),
    access_tier: libraryAccessTierEnum("access_tier").notNull().default("public"),
    is_published: boolean("is_published").notNull().default(true),
    ...softDelete(),
    ...timestamps(),
  },
  (t) => ({
    // Migration creates (created_at DESC); column order here documents the intent.
    alive_created_idx: index("idx_library_items_alive")
      .on(t.created_at)
      .where(sql`${t.deleted_at} IS NULL`),
  }),
);

export const library_access_logs = pgTable(
  "library_access_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable + SET NULL so a future hard purge cannot cascade-delete history.
    library_item_id: uuid("library_item_id").references(() => library_items.id, {
      onDelete: "set null",
    }),
    user_id: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /** First open (kept stable across re-opens). */
    accessed_at: timestamp("accessed_at", { withTimezone: true }).notNull().defaultNow(),
    /** Most recent open. */
    last_accessed_at: timestamp("last_accessed_at", { withTimezone: true }).notNull().defaultNow(),
    /** Opens by this member; admin "Members" counts rows (distinct reach). */
    access_count: integer("access_count").notNull().default(1),
    ...timestamps(),
  },
  (t) => ({
    item_idx: index("idx_library_access_logs_item").on(t.library_item_id),
    user_idx: index("idx_library_access_logs_user").on(t.user_id),
    item_user_uq: uniqueIndex("idx_library_access_logs_item_user")
      .on(t.library_item_id, t.user_id)
      .where(sql`${t.user_id} IS NOT NULL`),
  }),
);

export type LibraryItem = typeof library_items.$inferSelect;
export type NewLibraryItem = typeof library_items.$inferInsert;
