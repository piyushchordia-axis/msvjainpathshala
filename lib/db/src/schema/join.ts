/**
 * Seasonal / event gan registration (MSV SNP-style join journeys).
 * Public submit creates a pending registration; account provisioning happens on approve.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { timestamps } from "./_helpers";
import { centres } from "./centres";
import { cities } from "./geography";
import { users } from "./identity";
import { students } from "./students";

export const JOIN_KINDS = ["student", "shikshak", "sanchalak"] as const;
export type JoinKind = (typeof JOIN_KINDS)[number];

export const JOIN_STATUSES = ["pending", "approved", "rejected"] as const;
export type JoinStatus = (typeof JOIN_STATUSES)[number];

export const JOIN_FIELD_TYPES = [
  "text",
  "number",
  "yesno",
  "dropdown",
  "textarea",
  "photo",
] as const;
export type JoinFieldType = (typeof JOIN_FIELD_TYPES)[number];

export const join_form_fields = pgTable(
  "join_form_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    field_key: text("field_key").notNull(),
    label_hi: text("label_hi").notNull(),
    label_en: text("label_en").notNull(),
    field_type: text("field_type").notNull().default("text"),
    options: jsonb("options").$type<string[] | null>(),
    placeholder_hi: text("placeholder_hi"),
    placeholder_en: text("placeholder_en"),
    is_required: boolean("is_required").notNull().default(false),
    is_active: boolean("is_active").notNull().default(true),
    display_order: integer("display_order").notNull().default(0),
    ...timestamps(),
  },
  (t) => ({
    kind_key_uq: uniqueIndex("join_form_fields_kind_key_uq").on(t.kind, t.field_key),
    kind_order_idx: index("idx_join_form_fields_kind_order").on(t.kind, t.display_order),
  }),
);

export const join_settings = pgTable(
  "join_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    label: text("label"),
    ...timestamps(),
  },
  (t) => ({
    kind_key_uq: uniqueIndex("join_settings_kind_key_uq").on(t.kind, t.key),
  }),
);

const approvalCols = {
  status: text("status").notNull().default("pending"),
  reviewed_at: timestamp("reviewed_at", { withTimezone: true }),
  reviewed_by: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  rejection_reason: text("rejection_reason"),
  provisioned_user_id: uuid("provisioned_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
};

export const join_student_registrations = pgTable(
  "join_student_registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    display_code: varchar("display_code", { length: 32 }).notNull(),
    city_id: uuid("city_id")
      .notNull()
      .references(() => cities.id, { onDelete: "restrict" }),
    centre_id: uuid("centre_id")
      .notNull()
      .references(() => centres.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    /** Parent / Abhivaavak phone — used for OTP login + tagging on approve. */
    parent_mobile: text("parent_mobile").notNull(),
    /** Optional student contact phone (not used for parent login). */
    mobile: text("mobile"),
    email: text("email"),
    father_name: text("father_name"),
    age: integer("age"),
    sex: text("sex"),
    education: text("education"),
    address: text("address"),
    sang_name: text("sang_name"),
    pathshala_nearby: text("pathshala_nearby"),
    attended_last_season: text("attended_last_season"),
    family_members: integer("family_members").notNull().default(1),
    will_attend: text("will_attend").notNull().default("yes"),
    has_paid: text("has_paid").notNull().default("no"),
    payment_note: text("payment_note"),
    special_note: text("special_note"),
    photo_url: text("photo_url"),
    payment_screenshot_url: text("payment_screenshot_url"),
    extra_data: jsonb("extra_data").$type<Record<string, unknown>>().notNull().default({}),
    ...approvalCols,
    provisioned_student_id: uuid("provisioned_student_id").references(() => students.id, {
      onDelete: "set null",
    }),
    ...timestamps(),
  },
  (t) => ({
    display_code_uq: uniqueIndex("join_student_registrations_display_code_uq").on(t.display_code),
    city_idx: index("idx_join_student_registrations_city").on(t.city_id),
    centre_idx: index("idx_join_student_registrations_centre").on(t.centre_id),
    mobile_idx: index("idx_join_student_registrations_mobile").on(t.mobile),
    parent_mobile_idx: index("idx_join_student_registrations_parent_mobile").on(t.parent_mobile),
    status_centre_idx: index("idx_join_student_registrations_status_centre").on(
      t.status,
      t.centre_id,
    ),
    status_city_idx: index("idx_join_student_registrations_status_city").on(t.status, t.city_id),
  }),
);

export const join_shikshak_registrations = pgTable(
  "join_shikshak_registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    display_code: varchar("display_code", { length: 32 }).notNull(),
    centre_id: uuid("centre_id")
      .notNull()
      .references(() => centres.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    s_o: text("s_o"),
    age: integer("age"),
    school_qualification: text("school_qualification"),
    address: text("address"),
    religious_education: text("religious_education"),
    years_at_pathshala: integer("years_at_pathshala"),
    current_pathshala: text("current_pathshala"),
    vision: text("vision"),
    whatsapp_contact: text("whatsapp_contact").notNull(),
    pathshala_timing: text("pathshala_timing"),
    pathshala_name: text("pathshala_name"),
    role: text("role"),
    photo_url: text("photo_url"),
    has_paid: text("has_paid").notNull().default("no"),
    payment_screenshot_url: text("payment_screenshot_url"),
    extra_data: jsonb("extra_data").$type<Record<string, unknown>>().notNull().default({}),
    ...approvalCols,
    ...timestamps(),
  },
  (t) => ({
    display_code_uq: uniqueIndex("join_shikshak_registrations_display_code_uq").on(t.display_code),
    centre_idx: index("idx_join_shikshak_registrations_centre").on(t.centre_id),
    whatsapp_idx: index("idx_join_shikshak_registrations_whatsapp").on(t.whatsapp_contact),
    status_centre_idx: index("idx_join_shikshak_registrations_status_centre").on(
      t.status,
      t.centre_id,
    ),
  }),
);

export const join_sanchalak_registrations = pgTable(
  "join_sanchalak_registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    display_code: varchar("display_code", { length: 32 }).notNull(),
    centre_id: uuid("centre_id")
      .notNull()
      .references(() => centres.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    s_o: text("s_o"),
    age: integer("age"),
    school_qualification: text("school_qualification"),
    address: text("address"),
    religious_education: text("religious_education"),
    years_at_pathshala: integer("years_at_pathshala"),
    current_pathshala: text("current_pathshala"),
    vision: text("vision"),
    whatsapp_contact: text("whatsapp_contact").notNull(),
    pathshala_timing: text("pathshala_timing"),
    pathshala_name: text("pathshala_name"),
    role: text("role"),
    photo_url: text("photo_url"),
    has_paid: text("has_paid").notNull().default("no"),
    payment_screenshot_url: text("payment_screenshot_url"),
    extra_data: jsonb("extra_data").$type<Record<string, unknown>>().notNull().default({}),
    ...approvalCols,
    ...timestamps(),
  },
  (t) => ({
    display_code_uq: uniqueIndex("join_sanchalak_registrations_display_code_uq").on(t.display_code),
    centre_idx: index("idx_join_sanchalak_registrations_centre").on(t.centre_id),
    whatsapp_idx: index("idx_join_sanchalak_registrations_whatsapp").on(t.whatsapp_contact),
    status_centre_idx: index("idx_join_sanchalak_registrations_status_centre").on(
      t.status,
      t.centre_id,
    ),
  }),
);

export type JoinFormField = typeof join_form_fields.$inferSelect;
export type JoinSetting = typeof join_settings.$inferSelect;
export type JoinStudentRegistration = typeof join_student_registrations.$inferSelect;
export type JoinShikshakRegistration = typeof join_shikshak_registrations.$inferSelect;
export type JoinSanchalakRegistration = typeof join_sanchalak_registrations.$inferSelect;
