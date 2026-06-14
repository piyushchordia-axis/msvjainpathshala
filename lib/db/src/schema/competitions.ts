import { boolean, date, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { timestamps } from "./_helpers";
import { ageGroupEnum, competitionStatusEnum } from "./enums";
import { cities } from "./geography";
import { students } from "./students";
import { users } from "./identity";

export const competitions = pgTable("competitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  city_id: uuid("city_id")
    .notNull()
    .references(() => cities.id, { onDelete: "restrict" }),
  name_en: text("name_en").notNull(),
  name_hi: text("name_hi").notNull(),
  description_en: text("description_en"),
  description_hi: text("description_hi"),
  category: text("category").notNull().default("general"),
  eligible_age_groups: ageGroupEnum("eligible_age_groups").array().notNull().default([]),
  msv_only: boolean("msv_only").notNull().default(false),
  registration_window_start: timestamp("registration_window_start", { withTimezone: true }).notNull(),
  registration_window_end: timestamp("registration_window_end", { withTimezone: true }).notNull(),
  event_date: date("event_date").notNull(),
  winner_points: integer("winner_points").notNull().default(0),
  participant_points: integer("participant_points").notNull().default(0),
  max_participants: integer("max_participants"),
  status: competitionStatusEnum("status").notNull().default("draft"),
  results_published_at: timestamp("results_published_at", { withTimezone: true }),
  created_by: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  ...timestamps(),
});

export const competition_registrations = pgTable(
  "competition_registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    competition_id: uuid("competition_id")
      .notNull()
      .references(() => competitions.id, { onDelete: "cascade" }),
    student_id: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    registered_at: timestamp("registered_at", { withTimezone: true }).notNull().defaultNow(),
    result_rank: integer("result_rank"),
    result_note: text("result_note"),
    ...timestamps(),
  },
  (t) => ({
    competition_student_unique: uniqueIndex("competition_registrations_competition_student_unique").on(
      t.competition_id,
      t.student_id,
    ),
  }),
);

export type Competition = typeof competitions.$inferSelect;
export type NewCompetition = typeof competitions.$inferInsert;
export type CompetitionRegistration = typeof competition_registrations.$inferSelect;
