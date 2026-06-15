import { boolean, index, integer, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { timestamps } from "./_helpers";
import { donationPaymentStatusEnum } from "./enums";
import { cities } from "./geography";
import { users } from "./identity";

export const donation_campaigns = pgTable(
  "donation_campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    city_id: uuid("city_id").references(() => cities.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description"),
    target_amount_paise: integer("target_amount_paise"),
    raised_amount_paise: integer("raised_amount_paise").notNull().default(0),
    is_public: boolean("is_public").notNull().default(false),
    ...timestamps(),
  },
  (t) => ({
    city_idx: index("idx_donation_campaigns_city").on(t.city_id),
  }),
);

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
  // Razorpay payment lifecycle (order created on client checkout, captured via webhook/verify).
  payment_status: donationPaymentStatusEnum("payment_status").notNull().default("created"),
  razorpay_order_id: text("razorpay_order_id"),
  razorpay_payment_id: text("razorpay_payment_id"),
  razorpay_signature: text("razorpay_signature"),
  payment_captured_at: timestamp("payment_captured_at", { withTimezone: true }),
  eighty_g_eligible: boolean("eighty_g_eligible").notNull().default(false),
  // 80G receipt number, unique across all donations (gapless per-FY series).
  receipt_number: text("receipt_number").unique(),
  financial_year: text("financial_year"),
  ...timestamps(),
}, (t) => ({
  donor_idx: index("idx_donations_donor").on(t.donor_user_id),
  campaign_idx: index("idx_donations_campaign").on(t.campaign_id),
  razorpay_order_idx: index("idx_donations_razorpay_order").on(t.razorpay_order_id),
}));

/**
 * Per-financial-year gapless counter for 80G receipt numbers (JP/<fy>/<no>).
 * Incremented atomically inside the capture transaction so receipts are
 * sequential, unguessable-by-id, and unique. 80G compliance favours a
 * monotonic registered series over the old id-derived value.
 */
export const donation_receipt_counters = pgTable("donation_receipt_counters", {
  financial_year: text("financial_year").primaryKey(),
  last_no: integer("last_no").notNull().default(0),
  ...timestamps(),
});
