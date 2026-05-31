import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { timestamps } from "./_helpers";
import { noticeAudienceEnum } from "./enums";
import { cities, states } from "./geography";
import { centres } from "./centres";
import { users } from "./identity";

export const notices = pgTable("notices", {
  id: uuid("id").primaryKey().defaultRandom(),
  title_en: text("title_en").notNull(),
  title_hi: text("title_hi"),
  content_en: text("content_en"),
  content_hi: text("content_hi"),
  audience: noticeAudienceEnum("audience").notNull().default("national"),
  state_id: uuid("state_id").references(() => states.id, { onDelete: "cascade" }),
  city_id: uuid("city_id").references(() => cities.id, { onDelete: "cascade" }),
  centre_id: uuid("centre_id").references(() => centres.id, { onDelete: "cascade" }),
  is_public: boolean("is_public").notNull().default(false),
  pinned: boolean("pinned").notNull().default(false),
  is_critical: boolean("is_critical").notNull().default(false),
  published_at: timestamp("published_at", { withTimezone: true }),
  created_by: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  ...timestamps(),
});

export const notice_reads = pgTable("notice_reads", {
  id: uuid("id").primaryKey().defaultRandom(),
  notice_id: uuid("notice_id")
    .notNull()
    .references(() => notices.id, { onDelete: "cascade" }),
  user_id: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  read_at: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  ...timestamps(),
});

export type Notice = typeof notices.$inferSelect;
export type NewNotice = typeof notices.$inferInsert;
