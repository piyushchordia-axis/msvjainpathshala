import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { timestamps } from "./_helpers";
import { noticeAudienceEnum } from "./enums";
import { cities, states } from "./geography";
import { centres, batches } from "./centres";
import { users } from "./identity";

export const notices = pgTable(
  "notices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title_en: text("title_en").notNull(),
    title_hi: text("title_hi"),
    content_en: text("content_en"),
    content_hi: text("content_hi"),
    audience: noticeAudienceEnum("audience").notNull().default("national"),
    state_id: uuid("state_id").references(() => states.id, { onDelete: "cascade" }),
    city_id: uuid("city_id").references(() => cities.id, { onDelete: "cascade" }),
    centre_id: uuid("centre_id").references(() => centres.id, { onDelete: "cascade" }),
    // Target a specific batch when audience = 'batch'. Without this column the
    // 'batch' audience could never be targeted, so the enum value was dead.
    batch_id: uuid("batch_id").references(() => batches.id, { onDelete: "cascade" }),
    is_public: boolean("is_public").notNull().default(false),
    pinned: boolean("pinned").notNull().default(false),
    is_critical: boolean("is_critical").notNull().default(false),
    published_at: timestamp("published_at", { withTimezone: true }),
    // Nullable end of visibility. Null = standing announcement (never expires).
    expires_at: timestamp("expires_at", { withTimezone: true }),
    created_by: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => ({
    centre_idx: index("idx_notices_centre").on(t.centre_id),
    city_idx: index("idx_notices_city").on(t.city_id),
    state_idx: index("idx_notices_state").on(t.state_id),
    batch_idx: index("idx_notices_batch").on(t.batch_id),
  }),
);

export const notice_reads = pgTable(
  "notice_reads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    notice_id: uuid("notice_id")
      .notNull()
      .references(() => notices.id, { onDelete: "cascade" }),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    read_at: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => ({
    notice_idx: index("idx_notice_reads_notice").on(t.notice_id),
    user_idx: index("idx_notice_reads_user").on(t.user_id),
    // A user reads a given notice at most once; enables the idempotent
    // onConflictDoNothing upsert in the mark-read endpoint.
    notice_user_unique: uniqueIndex("notice_reads_notice_user_unique").on(t.notice_id, t.user_id),
  }),
);

export type Notice = typeof notices.$inferSelect;
export type NewNotice = typeof notices.$inferInsert;
