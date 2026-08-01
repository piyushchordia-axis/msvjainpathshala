import { boolean, index, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { softDelete, timestamps } from "./_helpers";
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
 * Every item now carries a real uploaded image (image_url) plus an optional
 * thumbnail and bilingual caption. student_id / niyam_id are nullable so
 * non-student media can be inserted; the seed still inserts student-tied rows.
 * deleted_at is a soft-delete used by admin takedown so a removed image is gone
 * from every read without losing the audit trail row.
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
    // Real media. image_url is the displayed image; thumbnail_url is an optional
    // smaller variant for grids; caption / caption_hi are an optional bilingual
    // description shown under the tile.
    image_url: text("image_url"),
    thumbnail_url: text("thumbnail_url"),
    caption: text("caption"),
    caption_hi: text("caption_hi"),
    is_featured: boolean("is_featured").notNull().default(false),
    is_public: boolean("is_public").notNull().default(true),
    // Admin who created the item (null for legacy/seed rows).
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
  }),
);

export type GalleryItem = typeof gallery_items.$inferSelect;
export type NewGalleryItem = typeof gallery_items.$inferInsert;
