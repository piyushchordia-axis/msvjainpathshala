import { boolean, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { softDelete, timestamps } from "./_helpers";
import { cities } from "./geography";
import { users } from "./identity";
import { niyams, niyam_submissions } from "./niyams";
import { students } from "./students";

/**
 * Public gallery items. Two flavours share the table:
 *  - student media (student_id set) — celebrates a child completing a niyam; the
 *    public read only ever shows these when the owning user has opted in to
 *    gallery visibility (users.gallery_visibility_opt_in), a minors-privacy gate.
 *  - non-student media (student_id null) — centre / event / general photos with
 *    no child attached; always allowed publicly when is_public is true.
 *
 * Curation flags (independent):
 *  - is_public        — not soft-hidden by an admin
 *  - featured_gallery — appears on the public Punya Wall
 *  - featured_home    — appears in the logged-in home dashboard carousel
 * Featuring never overrides parent opt-in (Q6).
 *
 * city_id is denormalised from the student's centre at insert for hot filters.
 */
export const gallery_items = pgTable(
  "gallery_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    student_id: uuid("student_id").references(() => students.id, {
      onDelete: "cascade",
    }),
    niyam_id: uuid("niyam_id").references(() => niyams.id, {
      onDelete: "cascade",
    }),
    submission_id: uuid("submission_id").references(() => niyam_submissions.id, {
      onDelete: "set null",
    }),
    city_id: uuid("city_id").references(() => cities.id, {
      onDelete: "set null",
    }),
    // Real media. image_url is the displayed image; thumbnail_url is an optional
    // smaller variant for grids; caption / caption_hi are an optional bilingual
    // description shown under the tile.
    image_url: text("image_url"),
    thumbnail_url: text("thumbnail_url"),
    caption: text("caption"),
    caption_hi: text("caption_hi"),
    /** Appears on the public Punya Wall (explicit curation). */
    featured_gallery: boolean("featured_gallery").notNull().default(false),
    /** Appears in the logged-in home dashboard carousel (explicit curation). */
    featured_home: boolean("featured_home").notNull().default(false),
    featured_at: timestamp("featured_at", { withTimezone: true }),
    featured_by: uuid("featured_by").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Soft-hide by an admin — independent of featuring. */
    is_public: boolean("is_public").notNull().default(true),
    // Admin who created the item (null for auto-inserted niyam proof rows).
    created_by: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    ...softDelete(),
    ...timestamps(),
  },
  (t) => ({
    student_idx: index("idx_gallery_items_student").on(t.student_id),
    niyam_idx: index("idx_gallery_items_niyam").on(t.niyam_id),
    public_idx: index("idx_gallery_items_public").on(t.is_public),
    submission_idx: index("idx_gallery_items_submission").on(t.submission_id),
    featured_gallery_created_idx: index("idx_gallery_items_featured_gallery_created")
      .on(t.featured_gallery, t.created_at)
      .where(sql`${t.deleted_at} IS NULL`),
    featured_home_created_idx: index("idx_gallery_items_featured_home_created")
      .on(t.featured_home, t.created_at)
      .where(sql`${t.deleted_at} IS NULL`),
    city_created_idx: index("idx_gallery_items_city_created").on(t.city_id, t.created_at),
  }),
);

export type GalleryItem = typeof gallery_items.$inferSelect;
export type NewGalleryItem = typeof gallery_items.$inferInsert;
