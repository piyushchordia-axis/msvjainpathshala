import { integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { timestamps } from "./_helpers";
import { cities } from "./geography";

export const curricula = pgTable("curricula", {
  id: uuid("id").primaryKey().defaultRandom(),
  city_id: uuid("city_id").references(() => cities.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("standard"),
  academic_year: text("academic_year"),
  status: text("status").notNull().default("active"),
  ...timestamps(),
});

export const curriculum_sections = pgTable("curriculum_sections", {
  id: uuid("id").primaryKey().defaultRandom(),
  curriculum_id: uuid("curriculum_id")
    .notNull()
    .references(() => curricula.id, { onDelete: "cascade" }),
  title_en: text("title_en").notNull(),
  title_hi: text("title_hi").notNull(),
  order_index: integer("order_index").notNull().default(0),
  ...timestamps(),
});

export const curriculum_items = pgTable("curriculum_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  section_id: uuid("section_id")
    .notNull()
    .references(() => curriculum_sections.id, { onDelete: "cascade" }),
  title_en: text("title_en").notNull(),
  title_hi: text("title_hi").notNull(),
  description_en: text("description_en"),
  description_hi: text("description_hi"),
  order_index: integer("order_index").notNull().default(0),
  ...timestamps(),
});
