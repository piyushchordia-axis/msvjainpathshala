---
name: workspace typecheck quirks
description: Pre-existing typecheck failures unrelated to feature work, and an Express param typing gotcha in the api-server.
---

# Workspace typecheck quirks

## Pre-existing @types/react duplication
`pnpm run typecheck` fails in shadcn ui components (`button-group.tsx`, `calendar.tsx` in web; `spinner.tsx` in mockup-sandbox) with "Two different types with this name exist" / `VoidOrUndefinedOnly` errors.
- **Cause:** two `@types/react` versions coexist — `jain-pathshala-mobile` pins `~19.1.10` (→19.1.17) while web/sandbox use the catalog `^19.2.0` (→19.2.14).
- **Why it matters:** these errors are structural/pre-existing, NOT introduced by feature work. Don't chase them as if your change broke them. Verify with `git diff HEAD -- pnpm-lock.yaml | rg "@types/react"` (empty = you didn't move the version).
- **How to apply:** for per-package verification, typecheck the package you changed (`pnpm --filter <pkg> run typecheck`). Artifact builds still succeed because `vite build` and the api `build.mjs` don't run `tsc`.

## Express req.params typed as string | string[]
In this api-server's TS setup, `req.params.<x>` is typed `string | string[]`, so passing it straight into `RegExp.test()` or Drizzle `eq()` fails typecheck.
- **How to apply:** coerce at the call site: `const id = String(req.params.id)`.

## Drizzle scoped-filter helpers must be generic
A helper that builds an `inArray(column, ...)` condition for multiple tables must type its column param as `PgColumn` (from `drizzle-orm/pg-core`), not `typeof someTable.id` — the latter only accepts that one table's column.
