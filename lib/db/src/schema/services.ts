import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { timestamps } from "./_helpers";
import { serviceRequestStatusEnum } from "./enums";
import { centres } from "./centres";
import { cities } from "./geography";
import { students } from "./students";
import { users } from "./identity";

export const service_requests = pgTable("service_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  parent_user_id: uuid("parent_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  student_id: uuid("student_id").references(() => students.id, { onDelete: "set null" }),
  category: text("category").notNull(),
  subject: text("subject").notNull(),
  description: text("description").notNull(),
  status: serviceRequestStatusEnum("status").notNull().default("submitted"),
  assigned_to: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
  centre_id: uuid("centre_id").references(() => centres.id, { onDelete: "set null" }),
  city_id: uuid("city_id").references(() => cities.id, { onDelete: "set null" }),
  last_response_at: timestamp("last_response_at", { withTimezone: true }),
  resolved_at: timestamp("resolved_at", { withTimezone: true }),
  ...timestamps(),
});

export const service_request_messages = pgTable("service_request_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  request_id: uuid("request_id")
    .notNull()
    .references(() => service_requests.id, { onDelete: "cascade" }),
  author_user_id: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
  message: text("message").notNull(),
  ...timestamps(),
});

export type ServiceRequest = typeof service_requests.$inferSelect;
export type NewServiceRequest = typeof service_requests.$inferInsert;
export type ServiceRequestMessage = typeof service_request_messages.$inferSelect;
export type NewServiceRequestMessage = typeof service_request_messages.$inferInsert;
