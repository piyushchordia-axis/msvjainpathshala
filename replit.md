# Jain Pathshala

Multi-tenant Jain religious education platform (Megh Sanskar Vatika network) — migrated from Next.js 15 to Vite + React in a pnpm monorepo.

## Run & Operate

- `pnpm --filter @workspace/jain-pathshala run dev` — run the frontend (port from `PORT` env)
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- Required env: `DATABASE_URL` — Postgres connection string
- Optional env: `VITE_API_BASE_URL` — base URL for backend API (default: empty = same-origin)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: Vite + React 19, Tailwind CSS v4, wouter (routing)
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Auth: cookie-based sessions (jp_access, jp_refresh, jp_user HTTP-only cookies)
- Build: esbuild (CJS bundle for API), Vite (frontend)

## Where things live

- `apps/jain-pathshala/` — React + Vite frontend
  - `src/lib/auth.ts` — Role types, session cookie helpers, `canAccessAdminPanel`
  - `src/lib/auth-context.tsx` — React auth context (reads jp_user cookie on mount)
  - `src/lib/locale-context.tsx` — Simple en/hi locale switcher via React context
  - `src/lib/api-client.ts` — Thin fetch wrapper using `VITE_API_BASE_URL`
  - `src/components/ui/` — shadcn/ui component library (pre-installed)
  - `src/components/public/` — TopNav, Footer, PageStub (public site)
  - `src/components/admin/` — Sidebar, TopBar, AdminPlaceholder, ImpersonationBanner
  - `src/pages/public/` — HomePage, CentresPage, PublicStubs (stub pages)
  - `src/pages/admin/` — LoginPage (OTP flow), DashboardPage, AdminStubs, AdminLayout
  - `src/index.css` — Full JP design system (HSL tokens, Mukta + Tiro Devanagari fonts)
- `apps/api-server/` — Express 5 API server
- `.migration-backup/apps/web/` — Original Next.js 15 source (reference only)

## Architecture decisions

- **No next-intl**: Locale switching uses a simple `LocaleProvider` React context with `localStorage` persistence. Default is `en`.
- **Auth via cookies**: `jp_user` JSON cookie (readable by JS) holds session user; `jp_access` / `jp_refresh` are HTTP-only. `AdminLayout` reads the cookie on mount and redirects unauthenticated users to `/admin/login`.
- **Admin role check**: `canAccessAdminPanel` gates the entire `/admin/*` tree — roles super_admin, state_admin, city_admin, sanchalak, shikshak may enter; parent/student/guest are redirected.
- **Wouter routing**: Two route groups — public (`PublicLayout`) and admin (`AdminLayout`). Login page (`/admin/login`) renders outside both layouts.
- **API stubs**: Admin sub-pages are all `AdminPlaceholder` components ready to be replaced with real data-fetching views as the backend API is wired up.

## Product

Jain Pathshala is a platform for the Megh Sanskar Vatika network:
- **Public site**: Find centres, browse shivirs, read notices, access library and gallery
- **Admin panel**: Role-gated dashboard for super_admin → shikshak; covers students, enrolments, batches, curriculum, exams, niyams, punya, MSV, centres, notices, gallery, library, donations, analytics, audit

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Admin panel routes: `/admin` (exact) and `/admin/*?` both route to `AdminRoutes`. In wouter v3, `:rest+` does NOT match multi-segment paths like `/admin/punya/configs` — use `/admin/*?` (optional wildcard) for the catch-all. Always keep both routes so bare `/admin` also matches.
- Apostrophes in JS string literals delimited by single quotes will crash esbuild. Use double-quoted strings or backtick templates when the value contains `'`.
- `ulid` is a runtime dep of `@workspace/jain-pathshala` (not devDep) — it generates device IDs in the login flow.
- `VITE_API_BASE_URL` must be set (or left empty for same-origin) before wiring up the real backend.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- Migration source: `.migration-backup/apps/web/src/` (Next.js 15 app)
