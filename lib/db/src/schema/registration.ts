import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { timestamps } from "./_helpers";
import { cities } from "./geography";
import { students } from "./students";
import { users } from "./identity";

/**
 * Dynamic registration forms. `form_kind` is plain text (student / parent /
 * shikshak / sanchalak / city_admin). `fields` is a JSON array of field defs:
 *   { key, label_en, label_hi, type: 'text'|'number'|'date'|'select'|'tel'|'email'|'textarea',
 *     required: boolean, options?: { value, label_en, label_hi }[] }
 * A NULL city_id is the global default config for that kind; a city overrides
 * by publishing a row with its own city_id. Highest active version_no wins.
 */
export interface RegistrationFieldDef {
  key: string;
  label_en: string;
  label_hi?: string;
  type: "text" | "number" | "date" | "select" | "tel" | "email" | "textarea";
  required: boolean;
  options?: { value: string; label_en: string; label_hi?: string }[];
}

export const registration_form_configs = pgTable(
  "registration_form_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    city_id: uuid("city_id").references(() => cities.id, { onDelete: "set null" }),
    form_kind: text("form_kind").notNull(),
    title_en: text("title_en").notNull(),
    title_hi: text("title_hi"),
    is_active: boolean("is_active").notNull().default(true),
    version_no: integer("version_no").notNull().default(1),
    fields: jsonb("fields").$type<RegistrationFieldDef[]>().notNull().default([]),
    published_at: timestamp("published_at", { withTimezone: true }),
    published_by: uuid("published_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => ({
    kind_city_version_unique: uniqueIndex("registration_form_configs_kind_city_version_unique").on(
      t.form_kind,
      t.city_id,
      t.version_no,
    ),
    city_idx: index("idx_registration_form_configs_city").on(t.city_id),
  }),
);

export const registration_form_responses = pgTable(
  "registration_form_responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    form_config_id: uuid("form_config_id")
      .notNull()
      .references(() => registration_form_configs.id, { onDelete: "restrict" }),
    // Optional links: a logged-in submitter and/or a resulting student.
    user_id: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    student_id: uuid("student_id").references(() => students.id, { onDelete: "set null" }),
    full_name: text("full_name").notNull(),
    phone: text("phone"),
    // 'submitted' | 'approved' | 'rejected'
    status: text("status").notNull().default("submitted"),
    responses: jsonb("responses").$type<Record<string, unknown>>().notNull().default({}),
    review_note: text("review_note"),
    reviewed_by: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewed_at: timestamp("reviewed_at", { withTimezone: true }),
    submitted_at: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => ({
    config_idx: index("idx_registration_form_responses_config").on(t.form_config_id),
    user_idx: index("idx_registration_form_responses_user").on(t.user_id),
    student_idx: index("idx_registration_form_responses_student").on(t.student_id),
  }),
);

export type RegistrationFormConfig = typeof registration_form_configs.$inferSelect;
export type NewRegistrationFormConfig = typeof registration_form_configs.$inferInsert;
export type RegistrationFormResponse = typeof registration_form_responses.$inferSelect;
export type NewRegistrationFormResponse = typeof registration_form_responses.$inferInsert;
