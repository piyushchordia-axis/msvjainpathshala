import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { timestamps } from "./_helpers";
import { libraryAccessTierEnum, libraryContentTypeEnum } from "./enums";
import { users } from "./identity";

export const library_items = pgTable("library_items", {
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
  ...timestamps(),
});

export const library_access_logs = pgTable("library_access_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  library_item_id: uuid("library_item_id")
    .notNull()
    .references(() => library_items.id, { onDelete: "cascade" }),
  user_id: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  accessed_at: timestamp("accessed_at", { withTimezone: true }).notNull().defaultNow(),
  ...timestamps(),
});

export type LibraryItem = typeof library_items.$inferSelect;
export type NewLibraryItem = typeof library_items.$inferInsert;
