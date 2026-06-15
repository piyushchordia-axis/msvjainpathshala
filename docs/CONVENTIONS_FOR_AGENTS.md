# Jain Pathshala — Conventions for Builder Agents

This is the **canonical** guide for every builder agent implementing a feature module in the Jain Pathshala monorepo. Read it fully before writing any code. All paths are absolute. All templates are copy-pasteable and reflect the existing codebase verbatim.

> **READ THIS FIRST → [Section 8: CONTENTION RULES](#8-contention-rules-critical).** You may ONLY create NEW files for your module. You must NEVER edit shared files. For every shared file, you RETURN the exact snippet and the orchestrator applies it serially. Violating this corrupts other agents' work.

A "module" is one feature implemented across layers: a DB schema file, an API route file, web pages, mobile screen(s), and tests. Use a single lowercase module slug throughout (e.g. `awards`). Examples below use `awards` / `widgets` — replace with your slug.

---

## Table of contents
1. [Repo layout & where each layer lives](#1-repo-layout--where-each-layer-lives)
2. [DB layer](#2-db-layer)
3. [API layer](#3-api-layer)
4. [Web layer](#4-web-layer)
5. [Mobile layer](#5-mobile-layer)
6. [Tooling](#6-tooling)
7. [Missing dependencies to add](#7-missing-dependencies-to-add)
8. [CONTENTION RULES (critical)](#8-contention-rules-critical)

---

## 1. Repo layout & where each layer lives

pnpm workspaces monorepo. `pnpm-workspace.yaml` globs: `apps/*`, `lib/*`, `lib/integrations/*`, `scripts`. Shared dependency **catalog** (`catalog:` protocol) + `workspace:*` internal deps + TypeScript project references.

```
/Users/sumit/Projects/Pathshala/
├── lib/
│   ├── db/                       @workspace/db      — Drizzle schema, client, seed (TS source, no build)
│   │   ├── src/schema/           one file per domain + _helpers.ts + enums.ts + index.ts (barrel)
│   │   ├── src/schema.ts         re-exports ./schema/index  (drizzle-kit entry)
│   │   ├── src/index.ts          exports `db`, `pool`, `* as schema`  (THROWS if DATABASE_URL unset)
│   │   ├── src/seed.ts           single seed script
│   │   └── drizzle.config.ts
│   └── api-zod/                  @workspace/api-zod — shared Zod contracts + types (TS source, no build)
│       └── src/contracts.ts      re-exported from src/index.ts
├── apps/
│   ├── api-server/              @workspace/api-server — Express 5 + Drizzle, ESM ("type":"module")
│   │   ├── src/app.ts            Express app (default export, NO listen) — SHARED, do not edit
│   │   ├── src/index.ts          listen entry (reads PORT)
│   │   ├── src/routes/v1.ts      /v1 mount table — SHARED
│   │   ├── src/routes/v1/        one route file per module (admin.ts, me.ts, public.ts, ...)
│   │   ├── src/lib/envelope.ts   ok() / fail()
│   │   ├── src/lib/scope.ts      resolveAdminScope()
│   │   ├── src/middlewares/auth.ts
│   │   └── build.mjs             esbuild bundler
│   ├── jain-pathshala/          @workspace/jain-pathshala — web (Vite + React + wouter)
│   │   └── src/                  alias @/ → src/  (ALWAYS use @/ imports)
│   │       ├── App.tsx           routes — SHARED
│   │       ├── pages/admin/      AdminListPages.tsx (grouped), AdminExtendedPages.tsx, standalone files
│   │       ├── pages/public/     one file per public page (export default)
│   │       ├── components/admin/ AdminPageShell.tsx, sidebar-nav.ts (SHARED)
│   │       ├── lib/              api-client.ts, auth.ts, auth-context.tsx, locale-context.tsx
│   │       └── hooks/            useAdminList.ts
│   └── jain-pathshala-mobile/   @workspace/jain-pathshala-mobile — Expo + expo-router
│       └── (alias @/ → repo root: @/lib/api = lib/api.ts)
│           ├── app/_layout.tsx   root stack — SHARED
│           ├── app/<group>/      persona groups (student, parent, shikshak, admin, guest)
│           ├── app/<group>/_layout.tsx   PersonaTabs — SHARED per group
│           ├── lib/api.ts        fetch wrapper
│           ├── lib/queries.ts    ALL react-query hooks + qk — SHARED
│           ├── lib/types.ts      re-exports @workspace/api-zod
│           ├── contexts/         AuthContext, LocaleContext, SessionViewContext
│           └── components/       ui.tsx, AppHeader.tsx, PersonaTabs.tsx
├── tsconfig.base.json            extended by every package
├── tsconfig.json                 root tsc --build graph
└── package.json                  root scripts
```

**Single import sources:**
- DB client + all tables + types → `@workspace/db`
- Drizzle operators → `drizzle-orm` (and `drizzle-orm/pg-core` for column types)
- Shared Zod contracts/types → `@workspace/api-zod`

---

## 2. DB layer

Schema files live in `/Users/sumit/Projects/Pathshala/lib/db/src/schema/`. **You create ONE new file**: `schema/<module>.ts`. You RETURN snippets for `schema/index.ts` and `seed.ts` (both shared — see §8).

### 2.1 Helpers (`schema/_helpers.ts`) — already exists, just use it

Two spread-helpers exist; ID and audit columns are **inlined per-table** (no helper):

```ts
// timestamps() -> created_at + updated_at, both notNull().defaultNow(), tz-aware. Spread LAST.
// softDelete() -> nullable deleted_at. Spread immediately BEFORE timestamps(). Only on soft-deletable tables.
```

- `...timestamps()` — spread into EVERY table as the **last** entry.
- `...softDelete()` — only on tables that are soft-deletable (`users`, `centres`, `batches`, `students`-style top-level entities). Child/junction/log/event tables do NOT get it. Place it immediately before `...timestamps()`.
- **ID column — inline, first, verbatim:** `id: uuid("id").primaryKey().defaultRandom(),`
- **Audit columns — inline (no helper):** "who" columns are nullable FKs to `users` with `onDelete: "set null"`, named by verb (`created_by`, `decided_by`, `marked_by`, `awarded_by`). "When" columns are inline `timestamp(..., { withTimezone: true })` (`decided_at`, `published_at`).

### 2.2 Enums (`schema/enums.ts`) — shared file; RETURN a snippet if you need a new enum

Two-step declaration. If your module needs a NEW enum, do NOT edit `enums.ts` yourself — RETURN this snippet for the orchestrator. If you reuse an existing enum, just import it.

```ts
// 1. const tuple, UPPER_SNAKE name (usually plural), `as const`
export const AWARD_TIERS = ["bronze", "silver", "gold"] as const;
// 2. (grouped at bottom of file) camelCase ...Enum export; SQL name = snake_case + "_enum"
export const awardTierEnum = pgEnum("award_tier_enum", AWARD_TIERS);
```

Reuse in a table file: `import { tierEnum } from "./enums";` then `tier: tierEnum("tier").notNull().default("jigyasu")`. The column name (string arg) is independent of the enum name.

### 2.3 Naming conventions

- **Columns:** `snake_case`; JS key === SQL string arg (`full_name: text("full_name")`). Bilingual content uses `_en`/`_hi` suffixes (`title_en`, `title_hi`).
- **Table JS const:** `snake_case`, plural, matching the `pgTable` SQL name exactly: `export const award_grants = pgTable("award_grants", {...})`.
- **FK columns:** `<singular_referenced>_id` (`student_id`, `centre_id`). Disambiguated FKs prepend context (`requested_centre_id`, `donor_user_id`). Audit FKs end in `_by`.
- **FK `onDelete`:** `"cascade"` for children/junctions/logs that belong to a parent; `"set null"` for optional/audit references; `"restrict"` for geography/reference parents (`state_id`, `city_id`).
- **Indexes (rare):** optional 2nd `pgTable` arg `(t) => ({ ... })`. Use `uniqueIndex("<table>_<cols>_unique").on(t.x)`.
- **Inferred types:** export `type <Pascal> = typeof <table>.$inferSelect;` and `New<Pascal>` for the file's principal tables.

### 2.4 Full schema-file template — create `schema/<module>.ts`

Modeled on `attendance.ts` (parent + child + audit). Save as `/Users/sumit/Projects/Pathshala/lib/db/src/schema/awards.ts`:

```ts
// Import ONLY the pg-core column types you use, alphabetized.
import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Helpers first, then enums, then cross-file table refs (one import per source file).
import { softDelete, timestamps } from "./_helpers";
import { tierEnum } from "./enums";
import { students } from "./students";
import { users } from "./identity";

// --- Parent / primary table -------------------------------------------------
export const awards = pgTable("awards", {
  id: uuid("id").primaryKey().defaultRandom(),          // id ALWAYS first, inlined

  title_en: text("title_en").notNull(),
  title_hi: text("title_hi").notNull(),                 // bilingual pair
  description_en: text("description_en"),               // nullable = no .notNull()
  description_hi: text("description_hi"),
  points: integer("points").notNull().default(10),
  tier: tierEnum("tier").notNull().default("jigyasu"),  // reused enum
  is_active: boolean("is_active").notNull().default(true),

  ...softDelete(),                                       // only if soft-deletable; before timestamps
  ...timestamps(),                                       // ALWAYS last
});

// --- Child table (FK back to the parent) ------------------------------------
export const award_grants = pgTable("award_grants", {
  id: uuid("id").primaryKey().defaultRandom(),

  // Owning FK: required + cascade. 3-line form when chained with .notNull():
  award_id: uuid("award_id")
    .notNull()
    .references(() => awards.id, { onDelete: "cascade" }),
  student_id: uuid("student_id")
    .notNull()
    .references(() => students.id, { onDelete: "cascade" }),

  // Audit FK: nullable + set null, single-line form is fine when not chained:
  granted_by: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
  granted_at: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),

  ...timestamps(),
});

// --- Inferred types: Select + New for the file's principal tables ------------
export type Award = typeof awards.$inferSelect;
export type NewAward = typeof awards.$inferInsert;
export type AwardGrant = typeof award_grants.$inferSelect;
export type NewAwardGrant = typeof award_grants.$inferInsert;
```

Style: `.references()` callback is always `() => parentTable.id`. A `.notNull()` FK is 3 lines; a nullable FK is 1 line.

### 2.5 SHARED snippet — add the barrel export to `schema/index.ts`

`/Users/sumit/Projects/Pathshala/lib/db/src/schema/index.ts` is a flat barrel (one `export *` per file, after its dependencies). **Do NOT edit it.** RETURN this one line to append:

```ts
export * from "./awards";
```

No other registration is needed: `schema.ts` re-exports the barrel; `index.ts` re-exports `* as schema`; drizzle-kit reads `schema.ts`, so new tables are picked up automatically.

### 2.6 SHARED snippet — seed pattern in `seed.ts`

`/Users/sumit/Projects/Pathshala/lib/db/src/seed.ts`. **Do NOT edit it.** RETURN three pieces for the orchestrator:

1. **Import additions** — add your table consts to the big destructured `from "./schema"` block:
   ```ts
   awards, award_grants,
   ```
2. **Truncate-list additions** — add your table names to the single `truncate table ... restart identity cascade` statement (child before parent within your group; CASCADE makes order non-critical but match house style):
   ```ts
   award_grants, awards,
   ```
3. **Insert section** — a new commented section in dependency order (parent before child). Capture parent rows with `.returning()`; bulk-insert children with a `.values([...])` array. Reuse already-seeded vars (`maharashtra`, `mumbai`, `centreA`, `batchA1`, `shikshak`, `superAdmin`, `insertedStudents[i]`):
   ```ts
   /* ---------------- Awards ---------------- */
   const [award1] = await db
     .insert(awards)
     .values({ title_en: "Best Attendance", title_hi: "सर्वश्रेष्ठ उपस्थिति", points: 50 })
     .returning();
   await db.insert(award_grants).values([
     { award_id: award1.id, student_id: insertedStudents[0].id, granted_by: shikshak.id },
   ]);
   ```
   Enum-typed seed literals are plain strings; use `as const` where the type needs narrowing (`status: "active" as const`).

### 2.7 Push commands (run by the orchestrator after merging schema/index.ts)

This project uses **`drizzle-kit push`** (schema-diff, no SQL migration files). `DATABASE_URL` must be set.

```bash
pnpm --filter @workspace/db run push-force   # non-interactive apply of schema changes
pnpm --filter @workspace/db run seed         # repopulate (requires DATABASE_URL)
```

Scripts: `push` (interactive), `push-force` (non-interactive, used in dev reset), `seed` (`tsx ./src/seed.ts`). There is **no** `generate`/`migrate`. Standard local reset = `push-force` + `seed` against native Homebrew Postgres on `:5432`.

---

## 3. API layer

Express 5 (path-to-regexp v8 — **explicit named params, no glob wildcards**), Drizzle (`drizzle-orm/node-postgres`), Zod, ESM. You create ONE new file: `src/routes/v1/<module>.ts`. You RETURN snippets for `v1.ts` (or `admin.ts`) mounting and, only if shared with clients, `lib/api-zod/src/contracts.ts`.

### 3.1 Response envelope — `src/lib/envelope.ts`

```ts
import { ok, fail } from "../../lib/envelope";   // "../lib/envelope" for files directly under routes/
// ok<T>(res, data, meta?, status = 200): void   -> { data } or { data, meta }
// fail(res, status, code, message, details?): void -> { error: { code, message } } (+ details if defined)
```

- **List responses:** `ok(res, { items }, { count: items.length })`.
- **Single-object responses:** `ok(res, row)` (no meta).
- `fail(...)` is ALWAYS immediately followed by `return;`. Handlers are `void`, never `return res...`.
- Error codes are **string literals** (no exported constants). Conventional codes:

| Code | HTTP | Meaning |
|---|---|---|
| `ERR_VALIDATION_FAILED` | 422 | Zod parse failed / bad query param |
| `ERR_FORBIDDEN` | 403 | role/scope denied (mutation create out-of-scope) |
| `ERR_NOT_FOUND` | 404 | row missing OR out of scope (detail/action) |
| `ERR_UNAUTHENTICATED` / `ERR_TOKEN_INVALID` / `ERR_USER_INACTIVE` | 401 | from `requireAuth` |

### 3.2 Auth middleware — `src/middlewares/auth.ts`

```ts
import { requireAuth, requireAdminPanel, requireRole } from "../../middlewares/auth";
```
- `req.authUser` (NOT `req.user`) is the authed user; read it as `req.authUser!` inside post-`requireAuth` handlers. Its `.id`, `.role`, `.city_id`, `.state_id` drive scoping.
- `requireAuth` — Bearer header OR `jp_access` cookie; rejects inactive/deleted.
- `requireRole(...roles)` — returns middleware; 403 unless role ∈ roles.
- `requireAdminPanel` — 403 unless role ∈ {super_admin, state_admin, city_admin, sanchalak, shikshak}.

Mount at top of router with `router.use(...)`:
- Admin module: `router.use(requireAuth, requireAdminPanel);`
- Persona/me module: `router.use(requireAuth);`
- Super-admin-only: child router with `subRouter.use(requireRole("super_admin"));`
- Public module: no auth `router.use` at all.

`Role` and `canAccessAdminPanel` come from `@workspace/api-zod`.

### 3.3 Scope helper — `src/lib/scope.ts`

```ts
import { resolveAdminScope, type AdminScope } from "../../lib/scope";
// interface AdminScope { centreIds: string[] | null }  // null = all (super_admin); [] = nothing
// resolveAdminScope(user): Promise<AdminScope>
// Also exports cityIdsForState(stateId) and a re-exported inArray.
```

Each route file copy-pastes these two local helpers verbatim:

```ts
import type { PgColumn } from "drizzle-orm/pg-core";

function scopedCentreFilter(scope: AdminScope, column: PgColumn) {
  if (scope.centreIds === null) return undefined;        // unrestricted
  if (scope.centreIds.length === 0) return sql`false`;   // nothing
  return inArray(column, scope.centreIds);
}
function inScope(scope: AdminScope, centreId: string | null): boolean {
  if (scope.centreIds === null) return true;
  if (!centreId) return false;
  return scope.centreIds.includes(centreId);
}
```

Pattern: list endpoints pass `scopedCentreFilter(scope, X.centre_id)` into `.where(...)`. Detail/mutation endpoints fetch the single row then guard with `if (!row || !inScope(scope, row.centre_id)) { fail(res, 404, "ERR_NOT_FOUND", ...); return; }` — **out-of-scope on detail/action is 404, not 403.** (On create, an out-of-scope `centre_id` in the body is reported as 403.)

### 3.4 Zod validation — `@workspace/api-zod` + route-local

- Shared contracts: `/Users/sumit/Projects/Pathshala/lib/api-zod/src/contracts.ts`, imported via `import { type Role } from "@workspace/api-zod";`. Add here ONLY when the schema/type is shared with web/mobile (RETURN a snippet — it's shared; see §8).
- **Route-local request schemas are defined inline** with `import { z } from "zod";` — do NOT add them to api-zod.

Body parse (dominant pattern — bare catch, generic message):
```ts
let body: z.infer<typeof createXSchema>;
try { body = createXSchema.parse(req.body); }
catch { fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid X data."); return; }
```
Query-param validation uses `.safeParse`. Common idioms: `z.string().uuid()`, `z.coerce.number().int().positive().max(N)`, `z.enum([...]).default(...)`, dates `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)`, datetimes `z.string().datetime()`. Optional fields written to DB as `body.x ?? null`.

`clampLimit` is a plain (non-zod) helper redefined in every list route file:
```ts
function clampLimit(raw: unknown, fallback: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}
```

### 3.5 DB client + schema import

One source for the Drizzle client and all tables/types:
```ts
import { db, awards, award_grants, students, centres, type User } from "@workspace/db";
import { and, asc, count, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
```
Subpaths: `@workspace/db/enums`, `@workspace/db/schema` exist; prefer root `@workspace/db` for tables/types.

### 3.6 Full route-file template — create `src/routes/v1/<module>.ts`

Models `admin-resources.ts` + `me.ts`. Save as `/Users/sumit/Projects/Pathshala/apps/api-server/src/routes/v1/widgets.ts`:

```ts
/**
 * /v1/admin/widgets — admin CRUD for widgets, Postgres-backed.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, widgets, centres } from "@workspace/db";
import { desc, eq, inArray, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth, requireAdminPanel } from "../../middlewares/auth";
import { resolveAdminScope, type AdminScope } from "../../lib/scope";

const router: IRouter = Router();
router.use(requireAuth, requireAdminPanel);   // order: auth first, then panel check

/* ---- local helpers copy-pasted into every admin route file ---- */
function scopedCentreFilter(scope: AdminScope, column: PgColumn) {
  if (scope.centreIds === null) return undefined;
  if (scope.centreIds.length === 0) return sql`false`;
  return inArray(column, scope.centreIds);
}
function inScope(scope: AdminScope, centreId: string | null): boolean {
  if (scope.centreIds === null) return true;
  if (!centreId) return false;
  return scope.centreIds.includes(centreId);
}
function clampLimit(raw: unknown, fallback: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

/* GET /v1/admin/widgets?limit= — scoped list */
router.get("/widgets", async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const limit = clampLimit(req.query.limit, 100, 300);
  const centreFilter = scopedCentreFilter(scope, widgets.centre_id);
  const rows = await db
    .select({
      id: widgets.id,
      name: widgets.name,
      centre_name: centres.name,
      created_at: widgets.created_at,
    })
    .from(widgets)
    .innerJoin(centres, eq(centres.id, widgets.centre_id))
    .where(centreFilter)                          // undefined = no filter
    .orderBy(desc(widgets.created_at))
    .limit(limit);
  // Every Date column -> .toISOString(); nullable -> x ? x.toISOString() : null
  const items = rows.map((r) => ({ ...r, created_at: r.created_at.toISOString() }));
  ok(res, { items }, { count: items.length });
});

/* ---- route-local create schema (inline, NOT in api-zod) ---- */
const createWidgetSchema = z.object({
  name: z.string().min(1).max(200),
  centre_id: z.string().uuid(),
  size: z.coerce.number().int().min(1).max(500).default(30),
  note: z.string().max(500).optional(),
});

/* POST /v1/admin/widgets */
router.post("/widgets", async (req: Request, res: Response) => {
  let body: z.infer<typeof createWidgetSchema>;
  try { body = createWidgetSchema.parse(req.body); }
  catch { fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid widget data."); return; }

  const scope = await resolveAdminScope(req.authUser!);
  if (!inScope(scope, body.centre_id)) {
    fail(res, 403, "ERR_FORBIDDEN", "Centre not in your scope."); return;  // create out-of-scope = 403
  }

  const [row] = await db.insert(widgets).values({
    name: body.name,
    centre_id: body.centre_id,
    size: body.size,
    note: body.note ?? null,
    created_by: req.authUser!.id,
  }).returning({ id: widgets.id, name: widgets.name });   // return minimal row
  ok(res, row);
});

/* POST /v1/admin/widgets/:id/archive — detail action: fetch, scope-guard (404), mutate */
router.post("/widgets/:id/archive", async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const [item] = await db
    .select({ id: widgets.id, centre_id: widgets.centre_id })
    .from(widgets)
    .where(eq(widgets.id, String(req.params.id)))        // String(req.params.id)
    .limit(1);
  if (!item || !inScope(scope, item.centre_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Widget not found."); return;   // out-of-scope = 404
  }
  await db.update(widgets).set({ archived: true }).where(eq(widgets.id, item.id));
  ok(res, { id: item.id, archived: true });
});

export default router;
```

Hard conventions: `const router: IRouter = Router();`; handlers `async (req: Request, res: Response)`; `req.authUser!`; path params via `String(req.params.id)`; single-row reads via `const [x] = await db.select()...limit(1)`; inserts via `.returning({ ...minimal })`; new timestamps via `new Date()`; `fail`-then-`return`. **No try/catch around DB calls** (Express 5 forwards async rejections); no `next(err)`; no comments beyond the `/* METHOD /path */` banner.

### 3.7 SHARED snippet — mount the router

**`app.ts` does NOT change** (it already does `app.use("/v1", v1Router)` and `app.use("/api", router)`). **Do NOT edit `app.ts`, `v1.ts`, or `admin.ts`** — RETURN snippets.

Most feature routers mount in `src/routes/v1.ts`. RETURN these two lines (an import alongside the others, a mount alongside the others):
```ts
// import line:
import widgetsRouter from "./v1/widgets";
// mount line (served at /v1/widgets/...):
router.use("/widgets", widgetsRouter);
```

If instead your routes belong under the existing `/v1/admin` surface, RETURN snippets for `src/routes/v1/admin.ts` instead (your file must still `router.use(requireAuth, requireAdminPanel)` itself, since admin sub-routers are self-contained):
```ts
// import line in admin.ts:
import widgetsRouter from "./widgets";
// mount line in admin.ts (resolves at /v1/admin/widgets):
router.use(widgetsRouter);
```

State clearly in your RETURN block which target file (`v1.ts` vs `admin.ts`) the snippet is for.

---

## 4. Web layer

Root: `/Users/sumit/Projects/Pathshala/apps/jain-pathshala/src`. **Always use `@/...` imports, never relative.** Router: `wouter`. Data layer: hand-rolled `fetch` wrapper in `@/lib/api-client` (**NOT axios** for web; the axios memory note is for mobile/future clients). `@tanstack/react-query` is installed but **not used by any page** — do not introduce it. Admin pages use `useAdminList`; public pages use raw `fetch`.

You create NEW files (a grouped page can be a named export added to `AdminListPages.tsx` ONLY if you treat that file as yours — but it is shared by other agents; therefore **create a standalone file** to avoid contention; see §8). You RETURN snippets for `App.tsx` and `sidebar-nav.ts`.

### 4.1 API client — `@/lib/api-client.ts`

Base URL `import.meta.env.VITE_API_BASE_URL ?? ''`; all requests `credentials: 'include'`; `Content-Type` only when a body is present.
```ts
export class ApiError extends Error { /* .code, .statusCode, .details */ }
export function get<T>(path): Promise<T>     // raw, does NOT unwrap envelope
export function post<T>(path, body): Promise<T>
export function del<T>(path, body?): Promise<T>
export async function apiGet<T>(path): Promise<T>   // unwraps { data } — admin pages use this
export async function apiPost<T>(path, body): Promise<T>
```
Envelope unwrap: `apiGet<{ items: Row[] }>('/v1/admin/x')` yields the **inner** `{ items: [...] }`. Non-2xx throws `ApiError`. `204` → `undefined`. There is no `apiDel`; admin mutations use `apiPost` against action endpoints (`POST /v1/admin/students/:id/status`), not DELETE.

Standard error-toast idiom:
```ts
catch (err) {
  toast.error('Failed to create X.', err instanceof ApiError ? err.message : undefined);
}
```

### 4.2 Shared admin data hook — `@/hooks/useAdminList.ts`

```ts
export function useAdminList<T>(path: string, deps: unknown[] = [])
  : { items: T[]; loading: boolean; error: string | null; reload: () => Promise<void> }
```
Internally `apiGet<{ items: T[] }>(path)`, stores `res?.items ?? []`. **Your endpoint MUST return `{ data: { items: [...] } }`.** On error stores `err.message`. `loading` starts `true`. Pass `reload` as the `onAdded`/`onChanged` callback. Usage:
```ts
const { items, loading, error, reload } = useAdminList<AwardRow>('/v1/admin/awards?limit=100');
```
For non-`{items}` shapes, inline `useState`+`apiGet` in a `useEffect` (see GeographyPage/QueuesPage). Prefer `useAdminList` whenever the endpoint returns `{ items }`.

Toast: `import { toast } from '@/components/ui/toast-jp';` (`toast.success/error/warning/info`) — `<ToasterJP/>` is already mounted; do not add another.

### 4.3 Admin page shell — `@/components/admin/AdminPageShell.tsx`

Exports `AdminPageShell({title, subtitle?, actions?, children})`, `AdminTable({columns, loading?, empty, colSpan, children, footer?})`, `AdminError({message})`, `AdminEmptyRow({colSpan, message})`. Cell conventions: rows `className="hover:bg-muted/30"`; cells `px-4 py-3`; name column adds `font-medium`; meta adds `text-xs text-muted-foreground`; IDs/codes `font-mono text-xs`; enums `capitalize`; null fallback is the em-dash `'—'`; dates `new Date(x).toLocaleDateString('en-GB')`; money paise → `₹${(paise/100).toLocaleString('en-IN')}`.

Admin pages are **English-only** (no `useLocale`).

### 4.4 Full admin page template — create a NEW standalone file

To avoid contention with other agents editing `AdminListPages.tsx`, create your own file `/Users/sumit/Projects/Pathshala/apps/jain-pathshala/src/pages/admin/AwardsPage.tsx` with a **default export**. (Standalone admin pages like Students/Batches already follow this.)

```tsx
import { useState } from 'react';
import { apiPost, ApiError } from '@/lib/api-client';
import { useAdminList } from '@/hooks/useAdminList';
import { toast } from '@/components/ui/toast-jp';
import { AdminPageShell, AdminTable, AdminError, AdminEmptyRow } from '@/components/admin/AdminPageShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from '@/components/ui/dialog';
import { Plus } from 'lucide-react';

// Row type mirrors the API's snake_case fields exactly.
interface AwardRow {
  id: string;
  title_en: string;
  category: string;
  points: number;
  is_active: boolean;
  created_at: string;
}

// File-local form-row helper (redefined per file, not shared).
function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-xs font-medium">{label}</Label>{children}</div>;
}

function AddAwardDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [points, setPoints] = useState('10');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;                          // required-field guard
    setBusy(true);
    try {
      await apiPost('/v1/admin/awards', { title_en: title.trim(), points: Number(points) });
      toast.success('Award created.');
      setOpen(false);
      setTitle(''); setPoints('10');                    // reset
      onAdded();                                        // parent reload()
    } catch (err) {
      toast.error('Failed.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-1 h-4 w-4" />New award</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Create award</DialogTitle></DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <FormRow label="Title (English) *">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </FormRow>
          <FormRow label="Points">
            <Input type="number" min={0} value={points} onChange={(e) => setPoints(e.target.value)} />
          </FormRow>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={busy || !title.trim()}>{busy ? 'Saving…' : 'Create'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function AwardsPage() {
  const { items, loading, error, reload } = useAdminList<AwardRow>('/v1/admin/awards?limit=100');
  return (
    <AdminPageShell title="Awards" subtitle="Recognition catalogue in your scope."
      actions={<AddAwardDialog onAdded={reload} />}>
      {error ? <AdminError message={error} /> : null}
      <AdminTable columns={['Title', 'Category', 'Points', 'Active', 'Created']} loading={loading} empty="" colSpan={5}>
        {items.length === 0 && !loading ? <AdminEmptyRow colSpan={5} message="No awards yet." /> : null}
        {items.map((a) => (
          <tr key={a.id} className="hover:bg-muted/30">
            <td className="px-4 py-3 font-medium">{a.title_en}</td>
            <td className="px-4 py-3 text-xs capitalize">{a.category}</td>
            <td className="px-4 py-3">{a.points}</td>
            <td className="px-4 py-3">{a.is_active ? 'Yes' : 'No'}</td>
            <td className="px-4 py-3 text-xs text-muted-foreground">
              {new Date(a.created_at).toLocaleDateString('en-GB')}
            </td>
          </tr>
        ))}
      </AdminTable>
    </AdminPageShell>
  );
}
```

For per-row mutations: a small component with its own `busy` state calling `apiPost('/v1/admin/.../action', {})`, toasting, then `onChanged()`/`reload()`. For per-row busy on the page, key it: `const [busy, setBusy] = useState<string | null>(null)`.

### 4.5 Full public page template — create `pages/public/<Module>Page.tsx`

Public pages use **raw `fetch`** (not `apiGet`), are **bilingual** via `useLocale`, are `export default`, and wrap content in `<section className="container py-12 md:py-16">`. The public envelope `{ data: { items } }` is read directly. Save as `/Users/sumit/Projects/Pathshala/apps/jain-pathshala/src/pages/public/AwardsPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { useLocale } from '@/lib/locale-context';

interface AwardItem { id: string; title_en?: string | null; title_hi?: string | null; category?: string | null; }

export default function AwardsPage() {
  const locale = useLocale();
  const hi = locale === 'hi';                            // universal bilingual flag
  const [items, setItems] = useState<AwardItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/v1/public/awards', { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : { data: { items: [] } }))
      .then((json: { data?: { items?: AwardItem[] } }) => setItems(json.data?.items ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="container py-12 md:py-16">
      <p className="text-sm font-medium uppercase tracking-[0.18em] text-primary">{hi ? 'सम्मान' : 'Awards'}</p>
      <h1 className="mt-3 font-display text-4xl text-secondary md:text-5xl">
        {hi ? 'मान्यता और सम्मान' : 'Recognition & awards'}
      </h1>
      {loading ? (
        <div className="mt-10 text-muted-foreground">Loading…</div>
      ) : items.length === 0 ? (
        <Card className="mt-10 p-6 text-muted-foreground">{hi ? 'अभी कोई सम्मान सूचीबद्ध नहीं है।' : 'No awards listed yet.'}</Card>
      ) : (
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {items.map((a) => {
            const title = (hi ? a.title_hi : a.title_en) ?? a.title_en ?? a.title_hi ?? null;
            return (
              <Card key={a.id} className="h-full p-5">
                <div className="font-display text-lg text-secondary">{title}</div>
                {a.category ? <div className="mt-1 text-xs uppercase tracking-[0.14em] text-ink-sub">{a.category}</div> : null}
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
```
For a detail route, read params via wouter: `import { useParams } from 'wouter'; const { id } = useParams<{ id: string }>();`.

### 4.6 SHARED snippet — route line in `App.tsx`

Routing is three-tiered: `/admin/login` standalone, `/admin`-prefixed → `AdminRoutes` (wrapped in `<AdminLayout>` which enforces auth — pages do NOT re-check auth), everything else → `PublicRoutes`. Both switches end with `<Route component={NotFound} />` as fallthrough; new routes go **above** it. **Do NOT edit `App.tsx`** — RETURN snippets.

For the admin page (standalone default import):
```tsx
// import line:
import AwardsAdminPage from '@/pages/admin/AwardsPage';
// route line in AdminRoutes <Switch>, above NotFound:
<Route path="/admin/awards" component={AwardsAdminPage} />
```
For the public page:
```tsx
// import line:
import AwardsPage from '@/pages/public/AwardsPage';
// route line in PublicRoutes <Switch>, above NotFound:
<Route path="/awards" component={AwardsPage} />
```
The `path` MUST exactly match the sidebar `href`. Alias an admin import if a public name collides (e.g. `AwardsAdminPage`).

### 4.7 SHARED snippet — sidebar nav entry in `sidebar-nav.ts`

`/Users/sumit/Projects/Pathshala/apps/jain-pathshala/src/components/admin/sidebar-nav.ts`. `ADMIN_NAV: NavGroup[]` of `{ heading, items }`; each item `{ href, label, icon, min }` where `icon` is a lucide-react icon and `min` is the minimum `Role` to see it. Groups: `Overview`, `People`, `Programme`, `Operations`, `Insights`, `System`. **Do NOT edit the file** — RETURN snippets (icon import + the item, naming the target group):
```ts
// add to the lucide-react import block (alphabetized):
import { Award } from 'lucide-react';
// add to the matching group's items array (e.g. group heading 'Programme'):
{ href: '/admin/awards', label: 'Awards', icon: Award, min: 'city_admin' },
```
The nav entry and the `App.tsx` route are independent and **both required** to surface the page. `min` is one of: `super_admin`, `state_admin`, `city_admin`, `sanchalak`, `shikshak`. Page-level extra gating (e.g. super_admin-only) is done in-page via `useAuth()` short-circuit; menu-level gating is the `min` field.

To surface a public page in the public nav, add a link in `@/components/public/TopNav.tsx` (also shared — RETURN a snippet).

---

## 5. Mobile layer

App root: `/Users/sumit/Projects/Pathshala/apps/jain-pathshala-mobile`. Path alias `@/*` → repo root (`@/lib/api` = `lib/api.ts`). **Uses `fetch`, NOT axios.** You create a NEW screen file. You RETURN snippets for `lib/queries.ts`, the persona `_layout.tsx`, and (only for detail screens) `app/_layout.tsx`.

### 5.1 API client — `lib/api.ts` (already exists)

```ts
import { apiGet, apiPost } from "@/lib/api";   // apiGet/apiPost UNWRAP { data }
// del<T>(path, body?) is raw (not unwrapped); setAuthToken is AuthContext-only.
// ApiError has .code/.statusCode/.details. 204 -> undefined. 30s timeout.
```
Always call `apiGet`/`apiPost` in hooks. Token is injected automatically (Bearer, memory-only — never touch it in a screen). Pass paths starting `/v1/...` (auth uses `/api/auth/...`). **Do NOT catch errors in hooks** — react-query surfaces them; screens render `StateView status="error"`.

### 5.2 Query layer — `lib/queries.ts` (SHARED — RETURN snippets)

All hooks live in this one file. **Do NOT edit it.** RETURN: (a) DTO import, (b) a `qk` entry, (c) the hook.

`qk` keys: static → `as const` tuples; parameterized → functions; first element is domain scope (`"public"`, `"me"`, `"admin"`).

Query hook (list endpoints typed `List<T>` = `ListResponse<T>` = `{ items: T[] }`; the screen does `data?.items ?? []`):
```ts
// (a) import the DTO with the others:
import type { AchievementRow } from "@/lib/types";
// (b) add to qk (id-parameterized -> function form, "me" scope):
achievements: (id: string) => ["me", "achievements", id] as const,
// (c) add the hook (id-gated: enabled !!id, key uses id ?? ""):
export function useAchievements(studentId?: string) {
  return useQuery({
    queryKey: qk.achievements(studentId ?? ""),
    queryFn: () => apiGet<List<AchievementRow>>(`/v1/me/students/${studentId}/achievements`),
    enabled: !!studentId,
  });
}
```
Conventions: `enabled = true` default param for role/auth-gated hooks; `enabled: !!id` for id-parameterized; no `staleTime`/`select`/`retry` overrides. Mutation hooks (`useXxxAction`) grab `qc = useQueryClient()`, take a single object arg, and `onSuccess` invalidates by **prefix** (`["admin","enrolments"]`) or exact `qk.*`. Surface mutation errors with `Alert.alert(...)` via `onError`; per-row loading via `mutate.isPending && mutate.variables?.id === e.id`.

DTO types come from `@/lib/types`, which re-exports `@workspace/api-zod` (single source of truth). Prefer adding the DTO to api-zod (RETURN a contracts.ts snippet) and re-exporting; only inline-type as a last resort.

### 5.3 Contexts

```ts
import { useAuth } from "@/contexts/AuthContext";       // { user, loading, signIn, logout }; user.full_name/role/phone
import { useLocale } from "@/contexts/LocaleContext";   // { hi, locale, setLocale, toggleLocale }; use inline `hi ? hin : en`
import { useSessionView } from "@/contexts/SessionViewContext"; // { activeStudentId, activeChild, loading, isError, refetch, children, setActiveStudentId }
```
`activeStudentId` feeds id-parameterized hooks (`useAchievements(activeStudentId ?? undefined)`). SessionView is only enabled for `parent`/`student` roles; null otherwise.

### 5.4 Shared UI primitives

```ts
import { useColors } from "@/hooks/useColors";          // c.background, c.primary, c.border, c.muted, c.radius... NEVER hardcode hex
import { AppHeader } from "@/components/AppHeader";      // every authed tab screen renders this at top
import { Body, Button, Card, Pill, Row, Screen, StateView, Title, Numeric, Kicker } from "@/components/ui";
import { formatDate, formatTimeRange, formatPaise } from "@/lib/format";
import { useRouter, useLocalSearchParams } from "expo-router";
```
- `Screen` — scrollable brand body with pull-to-refresh (`refreshing`, `onRefresh`, `scroll`).
- `StateView` — universal `status: "loading"|"empty"|"error"` with `emptyText`/`errorText`/`onRetry`/`retryLabel`.
- `Title`/`Body`/`Numeric`/`Kicker` auto-switch font by locale; `Pill` has `tone` (define a local `statusTone` mapper); `Button` has `variant` + `loading` + Ionicons `icon`.
- Standard wrapper: `<View style={{ flex:1, backgroundColor: c.background }}><AppHeader .../><Screen .../></View>`.
- **Bilingual:** inline `hi ? "हिंदी" : "English"`; DTO fields `hi ? row.title_hi : row.title_en`.

### 5.5 expo-router structure

File at `app/<group>/<name>.tsx` → route `/<group>/<name>`; default export is the screen. Dynamic: `app/<x>/[id].tsx`, read with `useLocalSearchParams<{ id: string }>()`. Navigate via `useRouter()` → `router.push("/centre/" + id)`. Provider tree (root `_layout.tsx`, outer→inner): `SafeAreaProvider → ErrorBoundary → QueryClientProvider → GestureHandlerRootView → KeyboardProvider → LocaleProvider → AuthProvider → SessionViewProvider → <Stack>`. New screens sit inside all of these automatically.

### 5.6 Full screen template — create `app/<group>/<name>.tsx`

Student "Achievements" tab, backed by `GET /v1/me/students/:id/achievements` → `{ items }`. Save as `/Users/sumit/Projects/Pathshala/apps/jain-pathshala-mobile/app/student/achievements.tsx`:

```tsx
import { View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { useAchievements } from "@/lib/queries";
import { formatDate } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { Body, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

export default function StudentAchievements() {
  const c = useColors();
  const { hi } = useLocale();
  const { activeStudentId, activeChild, loading, refetch } = useSessionView();

  const achievements = useAchievements(activeStudentId ?? undefined);   // pass undefined, not null
  const rows = achievements.data?.items ?? [];                          // screen unwraps items

  const tone = (s: string): "success" | "warning" | "neutral" => {     // per-screen status->tone mapper
    const v = s.toLowerCase();
    if (v === "earned") return "success";
    if (v === "in_progress") return "warning";
    return "neutral";
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader title={hi ? "उपलब्धियाँ" : "Achievements"} subtitle={hi ? "आपके अर्जित पदक" : "Badges you've earned"} />
      <Screen
        refreshing={achievements.isRefetching}
        onRefresh={() => { refetch(); achievements.refetch(); }}
      >
        {/* canonical state ladder: session-loading -> no-child -> query-loading -> error -> empty -> data */}
        {loading ? (
          <StateView status="loading" emptyText="" />
        ) : !activeStudentId || !activeChild ? (
          <StateView status="empty" emptyText={hi ? "आपकी विद्यार्थी प्रोफ़ाइल अभी तैयार नहीं है।" : "Your student profile isn't ready yet."} />
        ) : achievements.isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : achievements.isError ? (
          <StateView status="error" emptyText="" errorText={hi ? "उपलब्धियाँ लोड नहीं हुईं।" : "Could not load achievements."}
            onRetry={achievements.refetch} retryLabel={hi ? "पुनः प्रयास करें" : "Try again"} />
        ) : rows.length === 0 ? (
          <StateView status="empty" emptyText={hi ? "अभी कोई उपलब्धि नहीं।" : "No achievements yet."} />
        ) : (
          rows.map((row) => (
            <Card key={row.id}>
              <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Title style={{ fontSize: 16 }}>{hi ? row.title_hi : row.title_en}</Title>
                  <Body muted style={{ fontSize: 12, marginTop: 2 }}>{formatDate(row.earned_at)}</Body>
                </View>
                <Pill label={row.status} tone={tone(row.status)} />
              </Row>
            </Card>
          ))
        )}
      </Screen>
    </View>
  );
}
```

### 5.7 SHARED snippet — register the route

**A new tab inside an existing persona group:** the file alone is not enough — RETURN a `tabs` entry for that group's `_layout.tsx` (e.g. `/Users/sumit/Projects/Pathshala/apps/jain-pathshala-mobile/app/student/_layout.tsx`). The `name` MUST equal the file name:
```tsx
{ name: "achievements", title: hi ? "पदक" : "Badges", icon: "trophy" },  // icon: keyof typeof Ionicons.glyphMap
```
No root `_layout.tsx` edit is needed for a tab inside an existing group.

**A new detail/pushed screen** (e.g. `app/event/[id].tsx`): RETURN a `<Stack.Screen>` line for `app/_layout.tsx` so it gets the stack header:
```tsx
<Stack.Screen name="event/[id]" options={{ title: "Event" }} />
```

`lib/roles.ts`: `routeForRole(role)`, `roleAllowed(role, allowed)`, `ADMIN_ROLES = ["super_admin","state_admin","city_admin","sanchalak"]`. Persona `_layout.tsx` files render `<PersonaTabs allowed={[...]} tabs={[...]} />`; the guest group renders `<Tabs>` directly (unauthenticated).

---

## 6. Tooling

Monorepo: pnpm workspaces + shared catalog + TS project references. **`tsconfig.base.json` is NOT full `strict`** — it sets strict flags individually; `strictFunctionTypes` is deliberately OFF and `strict: true` is NOT set. `moduleResolution: "bundler"`, `target: es2022`. **`customConditions: ["workspace"]`** makes `@workspace/*` resolve to raw `./src/*.ts` — critical for any test runner. Only `apps/jain-pathshala` defines a `@/*` path alias; api-server uses relative + workspace package names.

### 6.1 Per-package scripts (verbatim)

**`apps/api-server`** (`"type":"module"`): `dev` (`node ./scripts/dev.mjs` — build-then-run once, no watch), `build` (`node ./build.mjs`), `start` (`node --enable-source-maps ./dist/index.mjs`), `typecheck` (`tsc -p tsconfig.json --noEmit`). Runtime requires BOTH `PORT` and `DATABASE_URL` (the latter throws at `@workspace/db` import time).

**`apps/jain-pathshala`** (Vite): `dev`, `build` (`vite build --config vite.config.ts`), `serve`, `typecheck` (`tsc -p tsconfig.json --noEmit`).

**`lib/db`**: `push`, `push-force`, `seed` (see §2.7). No `build`/`typecheck` script — validated via root `tsc --build` (it's `composite: true`).

**`lib/api-zod`**: **no scripts block** — pure TS source, only dep `zod`, typechecked via root `tsc --build`.

**`apps/jain-pathshala-mobile`** (Expo): `dev`, `qr`, `build` (`node scripts/build.js`), `serve`, `typecheck` (`tsc -p tsconfig.json --noEmit`).

**Root**: `typecheck:libs` (`tsc --build` — builds composite graph, emits `.d.ts`), `typecheck` (`typecheck:libs` then `pnpm -r --filter "./apps/**" --filter "./scripts" --if-present run typecheck`), `build` (`typecheck` then `pnpm -r --if-present run build`).

### 6.2 Typecheck/build a single package

```bash
pnpm --filter @workspace/api-server run typecheck     # tsc --noEmit, one package
pnpm --filter @workspace/api-server run build         # esbuild bundle -> dist/index.mjs
pnpm --filter @workspace/jain-pathshala run typecheck
pnpm --filter @workspace/jain-pathshala-mobile run typecheck
# lib/db and lib/api-zod have no per-package typecheck — validate them via:
pnpm run typecheck:libs                               # tsc --build (composite graph)
```

### 6.3 The api-server esbuild build (`build.mjs`)

Single esbuild call: entry `src/index.ts`; output `dist/` wiped first, `outExtension { ".js": ".mjs" }` → `dist/index.mjs`; `sourcemap: "linked"`; `platform: "node"`, `bundle: true`, `format: "esm"`. Plugin `esbuild-plugin-pino({ transports: ["pino-pretty"] })`. A CJS-in-ESM banner injects `globalThis.require = createRequire(import.meta.url)` + `__filename`/`__dirname` shims (for Express etc.). A hardcoded `external` denylist holds native/unbundleable packages (`sharp`, `canvas`, `bcrypt`, `argon2`, `pg-native`, `nodemailer`, ...).

**For new modules:** pure-JS server libs (`qrcode`, `pdf-lib`, `pdfkit`, `multer`, `busboy`, `razorpay`, `expo-server-sdk`, `node-cron`) bundle fine with **no `build.mjs` change**. Only add to the `external` array if a module is **native/non-bundleable** (`sharp` is already covered). If your module pulls in a new native dep, RETURN a snippet adding it to `build.mjs`'s `external` array (it's a shared file).

### 6.4 vitest + supertest test setup (api-server)

**Neither vitest nor supertest is installed** anywhere — both must be added (see §7). Because `app.ts` exports the Express app separately from `listen()`, test via supertest against the imported `app` (no port boot). Tests import `app.ts` (never `index.ts`), but importing `app` transitively imports `@workspace/db` which **throws at import time if `DATABASE_URL` is unset** — so set it before any import.

**devDeps to add to `apps/api-server/package.json`:**
```json
"vitest": "^3.2.4",
"supertest": "^7.1.4",
"@types/supertest": "^6.0.3"
```

**`apps/api-server/vitest.config.ts`** (NEW file — yours to create):
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    conditions: ["workspace"],   // match tsconfig.base customConditions so @workspace/* -> ./src/*.ts
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    fileParallelism: false,      // single global pg pool -> run serially to avoid data races
    pool: "forks",
    setupFiles: ["./test/setup.ts"],
    testTimeout: 20000,
  },
});
```

**`apps/api-server/test/setup.ts`** (NEW):
```ts
// Ensure DB env exists before @workspace/db / app are imported by tests.
process.env.DATABASE_URL ??= "postgres://sumit@localhost:5432/jainpathshala";
process.env.NODE_ENV ??= "test";
// PORT not needed (app is never listened on in tests).
```

**Add scripts to `apps/api-server/package.json`** (env inline also guarantees the var for config evaluation):
```json
"test": "DATABASE_URL=postgres://sumit@localhost:5432/jainpathshala vitest run",
"test:watch": "DATABASE_URL=postgres://sumit@localhost:5432/jainpathshala vitest"
```

**Sample integration test** — `apps/api-server/test/<module>.test.ts` (each agent creates its own, named for its module to avoid collision):
```ts
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool } from "@workspace/db";

afterAll(async () => {
  await pool.end();              // close shared pg pool so vitest exits cleanly
});

describe("health", () => {
  it("GET /api/health returns 200", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
  });
});
```

**DB hygiene:** tests hit real local Postgres (`postgres://sumit@localhost:5432/jainpathshala`, native Homebrew PG). `lib/db` exports a single module-level `pool` → keep `fileParallelism: false` and ALWAYS `await pool.end()` in a top-level `afterAll` (avoids open-handle hangs). Seed/reset via `push-force` + `seed` **before** a run, not inside tests.

> The `vitest.config.ts`, `test/setup.ts`, and a `test/<module>.test.ts` are NEW files (create freely). The devDeps and `test` scripts go in the SHARED `apps/api-server/package.json` → RETURN them as snippets (§8).

---

## 7. Missing dependencies to add

These are **absent** from `pnpm-lock.yaml` / package.json and must be added (orchestrator applies — RETURN them in your dependency snippet for the relevant `package.json`). Add only the ones your module actually needs.

**`apps/api-server/package.json` → `dependencies`** (pure-JS, bundle fine through esbuild; add `@types/*` to devDeps where the package doesn't ship its own types):

| Package | Why | Types |
|---|---|---|
| `qrcode` | QR image generation (only `qrcode-terminal` exists, a CLI helper — not for images) | `@types/qrcode` (devDep) |
| `sharp` | image processing — **native**, also add to `build.mjs` `external` (already listed there as a precaution) | ships own types |
| `pdfkit` **or** `pdf-lib` | PDF generation | `@types/pdfkit` (devDep) for pdfkit; pdf-lib ships own |
| `multer` **or** `busboy` | multipart upload parsing (no upload middleware exists) | `@types/multer` (devDep) for multer; busboy ships own |
| `razorpay` | payments | ships own types |
| `expo-server-sdk` | server-side push (distinct from mobile expo-* client pkgs) | ships own types |
| `node-cron` | scheduling (no scheduler/queue lib present; `node-schedule`/`croner`/`bullmq` also absent) | ships own types |

**`apps/api-server/package.json` → `devDependencies`** (testing — none exist in the repo today):

| Package | Version |
|---|---|
| `vitest` | `^3.2.4` |
| `supertest` | `^7.1.4` |
| `@types/supertest` | `^6.0.3` |

Notes: api-server has **no** generic HTTP client (axios/ky/got) and **no** `dotenv` — env is provided by the runner; do not add these. New native deps (beyond `sharp`) require a `build.mjs` `external` addition.

---

## 8. CONTENTION RULES (critical)

~15 builder agents run in parallel. To avoid merge conflicts and clobbering each other's work, the rules below are **absolute**.

### You MAY create these NEW files (yours alone, namespaced by module)
- `lib/db/src/schema/<module>.ts`
- `apps/api-server/src/routes/v1/<module>.ts`
- `apps/api-server/test/<module>.test.ts` (plus `vitest.config.ts` + `test/setup.ts` if not yet present — but if another agent may also create them, RETURN them as snippets instead and let the orchestrator create once)
- `apps/jain-pathshala/src/pages/admin/<Module>Page.tsx` (standalone, `export default`)
- `apps/jain-pathshala/src/pages/public/<Module>Page.tsx` (`export default`)
- `apps/jain-pathshala-mobile/app/<group>/<name>.tsx` (or `app/<x>/[id].tsx`)

### You MUST NEVER edit these SHARED files
Instead, RETURN the exact snippet to add; the orchestrator applies all snippets serially.

| Shared file | What you RETURN |
|---|---|
| `lib/db/src/schema/index.ts` | the `export * from "./<module>";` line |
| `lib/db/src/schema/enums.ts` | any new enum (const tuple + pgEnum) |
| `lib/db/src/seed.ts` | import additions + truncate-list additions + the insert section |
| `apps/api-server/src/routes/v1.ts` **or** `src/routes/v1/admin.ts` | the import line + the `router.use(...)` mount line (name which file) |
| `apps/api-server/src/app.ts` | nothing — never changes |
| `lib/api-zod/src/contracts.ts` | any shared schema/type/DTO (only if shared across clients) |
| `apps/api-server/package.json` | new `dependencies` / `devDependencies` + `test` scripts |
| `apps/api-server/build.mjs` | only a new **native** dep added to the `external` array |
| `apps/jain-pathshala/src/App.tsx` | the import line + the `<Route .../>` line (admin and/or public) |
| `apps/jain-pathshala/src/components/admin/sidebar-nav.ts` | the lucide icon import + the nav item (name the group) |
| `apps/jain-pathshala/src/components/public/TopNav.tsx` | the public nav link (if surfacing a public page) |
| `apps/jain-pathshala/src/pages/admin/AdminListPages.tsx` / `AdminExtendedPages.tsx` | do NOT touch — create a standalone page file instead |
| `apps/jain-pathshala-mobile/lib/queries.ts` | DTO import + `qk` entry + the hook(s) |
| `apps/jain-pathshala-mobile/lib/types.ts` | re-export line for a new DTO (if added to api-zod) |
| `apps/jain-pathshala-mobile/app/_layout.tsx` | `<Stack.Screen>` line (only for a new detail/pushed screen) |
| `apps/jain-pathshala-mobile/app/<group>/_layout.tsx` | the `tabs` entry (for a new tab in an existing persona) |
| root `package.json`, `tsconfig.*`, `pnpm-workspace.yaml` | nothing — never change |

### How to RETURN snippets
At the end of your work, output a clearly labeled block per shared file, e.g.:

```
=== SNIPPET: lib/db/src/schema/index.ts (append) ===
export * from "./awards";

=== SNIPPET: apps/api-server/src/routes/v1.ts (add import + mount) ===
import awardsRouter from "./v1/awards";
router.use("/awards", awardsRouter);

=== SNIPPET: apps/jain-pathshala/src/App.tsx (AdminRoutes, above NotFound) ===
import AwardsAdminPage from '@/pages/admin/AwardsPage';
<Route path="/admin/awards" component={AwardsAdminPage} />
...
```
Be exact (correct quotes, casing, file the snippet targets, and where it goes). The orchestrator applies them in dependency order: DB schema/index → enums → push-force → seed → api-zod contracts → route mounts → web App.tsx/sidebar → mobile queries/layouts → package.json deps → install → typecheck.
