import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { timestamps } from "./_helpers";
import { cities } from "./geography";
import { students } from "./students";

export const online_exams = pgTable("online_exams", {
  id: uuid("id").primaryKey().defaultRandom(),
  city_id: uuid("city_id")
    .notNull()
    .references(() => cities.id, { onDelete: "restrict" }),
  title_en: text("title_en").notNull(),
  title_hi: text("title_hi").notNull(),
  description_en: text("description_en"),
  description_hi: text("description_hi"),
  window_start: timestamp("window_start", { withTimezone: true }).notNull(),
  window_end: timestamp("window_end", { withTimezone: true }).notNull(),
  max_attempts: integer("max_attempts").notNull().default(1),
  total_marks: integer("total_marks").notNull().default(100),
  pass_mark: integer("pass_mark").notNull().default(40),
  exam_otp: text("exam_otp"),
  results_released: boolean("results_released").notNull().default(false),
  ...timestamps(),
});

export const exam_attempts = pgTable("exam_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  exam_id: uuid("exam_id")
    .notNull()
    .references(() => online_exams.id, { onDelete: "cascade" }),
  student_id: uuid("student_id")
    .notNull()
    .references(() => students.id, { onDelete: "cascade" }),
  started_at: timestamp("started_at", { withTimezone: true }).notNull(),
  submitted_at: timestamp("submitted_at", { withTimezone: true }),
  score: integer("score"),
  status: text("status").notNull().default("in_progress"),
  ...timestamps(),
});
