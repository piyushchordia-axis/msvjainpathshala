/**
 * Geography — states + cities (SPEC §5.2).
 *
 * No FKs out; everything else FKs INTO these (centres.city_id,
 * users.state_id / city_id, etc.). Reference data — restricted-delete by
 * default.
 */

import { pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';

export const states = pgTable('states', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  code: text('code').notNull(),
  ...timestamps(),
});

export const cities = pgTable('cities', {
  id: uuid('id').primaryKey().defaultRandom(),
  state_id: uuid('state_id')
    .notNull()
    .references(() => states.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  code: text('code').notNull(),
  ...timestamps(),
});

export type State = typeof states.$inferSelect;
export type NewState = typeof states.$inferInsert;
export type City = typeof cities.$inferSelect;
export type NewCity = typeof cities.$inferInsert;
