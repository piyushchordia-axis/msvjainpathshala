/** Service requests + message threads (SPEC §5.15). */

import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { centres } from './centres';
import { serviceRequestStatusEnum } from './enums';
import { cities } from './geography';
import { users } from './identity';
import { students } from './students';

export const service_requests = pgTable('service_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  parent_user_id: uuid('parent_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  student_id: uuid('student_id').references(() => students.id, { onDelete: 'set null' }),
  category: text('category').notNull(),
  description: text('description').notNull(),
  status: serviceRequestStatusEnum('status').notNull(),
  assigned_to_user_id: uuid('assigned_to_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  centre_id: uuid('centre_id')
    .notNull()
    .references(() => centres.id, { onDelete: 'restrict' }),
  city_id: uuid('city_id')
    .notNull()
    .references(() => cities.id, { onDelete: 'restrict' }),
  last_response_at: timestamp('last_response_at', { withTimezone: true }),
  resolved_at: timestamp('resolved_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const service_request_messages = pgTable('service_request_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  request_id: uuid('request_id')
    .notNull()
    .references(() => service_requests.id, { onDelete: 'cascade' }),
  author_user_id: uuid('author_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  message: text('message').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ServiceRequest = typeof service_requests.$inferSelect;
export type NewServiceRequest = typeof service_requests.$inferInsert;
export type ServiceRequestMessage = typeof service_request_messages.$inferSelect;
export type NewServiceRequestMessage = typeof service_request_messages.$inferInsert;
