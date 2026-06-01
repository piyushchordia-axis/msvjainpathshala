import { boolean, integer, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { timestamps } from "./_helpers";
import { cities } from "./geography";
import { users } from "./identity";

export const donation_campaigns = pgTable("donation_campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  city_id: uuid("city_id").references(() => cities.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  description: text("description"),
  target_amount_paise: integer("target_amount_paise"),
  raised_amount_paise: integer("raised_amount_paise").notNull().default(0),
  is_public: boolean("is_public").notNull().default(false),
  ...timestamps(),
});

export const donations = pgTable("donations", {
  id: uuid("id").primaryKey().defaultRandom(),
  donor_user_id: uuid("donor_user_id").references(() => users.id, { onDelete: "set null" }),
  donor_name: text("donor_name").notNull(),
  donor_phone: varchar("donor_phone", { length: 15 }),
  donor_email: varchar("donor_email", { length: 255 }),
  amount_paise: integer("amount_paise").notNull(),
  purpose: text("purpose").notNull().default("general"),
  campaign_id: uuid("campaign_id").references(() => donation_campaigns.id, {
    onDelete: "set null",
  }),
  frequency: text("frequency").notNull().default("one_time"),
  status: text("status").notNull().default("captured"),
  payment_captured_at: timestamp("payment_captured_at", { withTimezone: true }),
  eighty_g_eligible: boolean("eighty_g_eligible").notNull().default(false),
  receipt_number: text("receipt_number"),
  financial_year: text("financial_year"),
  ...timestamps(),
});
