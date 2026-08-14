import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { softDelete, timestamps } from "./_helpers";
import { centres } from "./centres";
import {
  teamDisplayStyleEnum,
  teamGroupByEnum,
  teamScopeLevelEnum,
} from "./enums";
import { cities, states } from "./geography";
import { users } from "./identity";

/**
 * Public Team directory categories (Core Team, Sanchalak, Gurujis & Didis, …).
 * Render from `key` / display fields loaded from the DB — never hardcode category
 * keys in UI. `display_style = featured` has no dedicated renderer; fall back to grid.
 */
export const team_categories = pgTable(
  "team_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    name_en: text("name_en").notNull(),
    name_hi: text("name_hi").notNull(),
    order: integer("order").notNull().default(0),
    display_style: teamDisplayStyleEnum("display_style").notNull().default("grid"),
    group_by: teamGroupByEnum("group_by").notNull().default("none"),
    is_lazy_loaded: boolean("is_lazy_loaded").notNull().default(false),
    is_published: boolean("is_published").notNull().default(false),
    ...timestamps(),
  },
  (t) => ({
    key_uq: uniqueIndex("team_categories_key_uq").on(t.key),
  }),
);

/**
 * One public Team card. Linked user optional — guest/manual cards use display_name_*.
 * city_id is denormalised onto centre-scoped rows so the city page is a single
 * indexed filter (not a centres join).
 *
 * photo_override_asset_id reserves a media_assets UUID (SPEC); that table is not
 * in this monorepo yet, so there is no FK.
 */
export const team_members = pgTable(
  "team_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    category_id: uuid("category_id")
      .notNull()
      .references(() => team_categories.id, { onDelete: "restrict" }),
    user_id: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    scope_level: teamScopeLevelEnum("scope_level").notNull(),
    state_id: uuid("state_id").references(() => states.id, { onDelete: "restrict" }),
    city_id: uuid("city_id").references(() => cities.id, { onDelete: "restrict" }),
    centre_id: uuid("centre_id").references(() => centres.id, { onDelete: "restrict" }),
    honorific: text("honorific"),
    display_name_en: text("display_name_en"),
    display_name_hi: text("display_name_hi"),
    designation_en: text("designation_en"),
    designation_hi: text("designation_hi"),
    bio_en: text("bio_en"),
    bio_hi: text("bio_hi"),
    /** Reserved for SPEC media_assets.id — no FK until that table exists. */
    photo_override_asset_id: uuid("photo_override_asset_id"),
    associated_since: integer("associated_since"),
    is_in_memoriam: boolean("is_in_memoriam").notNull().default(false),
    order: integer("order").notNull().default(0),
    is_published: boolean("is_published").notNull().default(false),
    published_at: timestamp("published_at", { withTimezone: true }),
    /**
     * Set when an admin explicitly unpublishes the card. Survives user
     * reactivation — system unpublish (deactivate / role removal) leaves this null.
     */
    unpublished_by: uuid("unpublished_by").references(() => users.id, { onDelete: "set null" }),
    content_version: integer("content_version").notNull().default(1),
    ...softDelete(),
    ...timestamps(),
  },
  (t) => ({
    name_required: check(
      "team_members_name_required",
      sql`${t.user_id} IS NOT NULL OR ${t.display_name_en} IS NOT NULL`,
    ),
    scope_consistency: check(
      "team_members_scope_consistency",
      sql`(
        (${t.scope_level} = 'national' AND ${t.state_id} IS NULL AND ${t.city_id} IS NULL AND ${t.centre_id} IS NULL)
        OR (${t.scope_level} = 'state' AND ${t.state_id} IS NOT NULL AND ${t.city_id} IS NULL AND ${t.centre_id} IS NULL)
        OR (${t.scope_level} = 'city' AND ${t.state_id} IS NOT NULL AND ${t.city_id} IS NOT NULL AND ${t.centre_id} IS NULL)
        OR (${t.scope_level} = 'centre' AND ${t.state_id} IS NOT NULL AND ${t.city_id} IS NOT NULL AND ${t.centre_id} IS NOT NULL)
      )`,
    ),
    user_active_uq: uniqueIndex("team_members_user_id_active_uq")
      .on(t.user_id)
      .where(sql`${t.user_id} IS NOT NULL AND ${t.deleted_at} IS NULL`),
    city_published_idx: index("idx_team_members_city_published")
      .on(t.city_id, t.is_published)
      .where(sql`${t.deleted_at} IS NULL`),
    centre_idx: index("idx_team_members_centre")
      .on(t.centre_id)
      .where(sql`${t.deleted_at} IS NULL`),
  }),
);

export type TeamCategory = typeof team_categories.$inferSelect;
export type NewTeamCategory = typeof team_categories.$inferInsert;
export type TeamMember = typeof team_members.$inferSelect;
export type NewTeamMember = typeof team_members.$inferInsert;
