/**
 * Atomic counters for human-readable entity codes (STU / PAR / SHK / …).
 * Scope key is city code, state code, Pathshala code, or "GLOBAL" (MSV).
 */
import { integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";

import { timestamps } from "./_helpers";

export const entity_code_counters = pgTable(
  "entity_code_counters",
  {
    series: text("series").notNull(),
    scope_key: text("scope_key").notNull(),
    last_no: integer("last_no").notNull().default(0),
    ...timestamps(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.series, t.scope_key] }),
  }),
);
