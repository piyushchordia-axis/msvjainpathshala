// Public enquiry / contact form submissions + the admin inbox they feed.
import { pgTable, text, uuid } from "drizzle-orm/pg-core";

import { timestamps } from "./_helpers";
import { users } from "./identity";

// Plain text columns (no enum) per module spec:
//   kind   -> "contact" | "enquire" | "donate"
//   status -> "new" | "in_review" | "closed"
export const enquiries = pgTable("enquiries", {
  id: uuid("id").primaryKey().defaultRandom(),

  kind: text("kind").notNull(),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  subject: text("subject"),
  message: text("message").notNull(),
  city: text("city"),
  status: text("status").notNull().default("new"),

  // Audit FK: nullable + set null — the admin who last actioned the enquiry.
  handled_by: uuid("handled_by").references(() => users.id, { onDelete: "set null" }),

  ...timestamps(),
});

export type Enquiry = typeof enquiries.$inferSelect;
export type NewEnquiry = typeof enquiries.$inferInsert;
