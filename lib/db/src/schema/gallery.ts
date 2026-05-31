import { boolean, pgTable, uuid } from "drizzle-orm/pg-core";

import { timestamps } from "./_helpers";
import { niyams, niyam_submissions } from "./niyams";
import { students } from "./students";

export const gallery_items = pgTable("gallery_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  student_id: uuid("student_id")
    .notNull()
    .references(() => students.id, { onDelete: "cascade" }),
  niyam_id: uuid("niyam_id")
    .notNull()
    .references(() => niyams.id, { onDelete: "cascade" }),
  submission_id: uuid("submission_id").references(() => niyam_submissions.id, {
    onDelete: "set null",
  }),
  is_featured: boolean("is_featured").notNull().default(false),
  is_public: boolean("is_public").notNull().default(true),
  ...timestamps(),
});

export type GalleryItem = typeof gallery_items.$inferSelect;
export type NewGalleryItem = typeof gallery_items.$inferInsert;
