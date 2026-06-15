# Jain Pathshala — Deployment

_How the monorepo is built, configured, and run in production. Wired into `.replit`
(`[deployment.build]` / `[deployment.run]`) and the root `package.json` scripts._

## Topology

Two independently-deployable processes plus a Postgres database:

- **API server** (`@workspace/api-server`) — Express 5 + Drizzle. esbuild bundles
  `src/index.ts` to a single ESM file at `apps/api-server/dist/index.mjs`; prod
  runs it with `node --enable-source-maps`. Serves `/api`, `/v1`, and signed
  `/uploads/*` downloads. **It does not serve the web app.**
- **Web app** (`@workspace/jain-pathshala`) — Vite + React. `vite build` emits a
  static bundle to `apps/jain-pathshala/dist/public`. The `[deployment]` here
  runs the API; the web SPA is served separately (see _Serving the web app_).
- **Mobile** (`@workspace/jain-pathshala-mobile`) — Expo; shipped via EAS/Expo, not
  part of this autoscale deployment.

## Build & run commands

Root `package.json` scripts (these are what `.replit` invokes):

| Script | What it does |
|--------|--------------|
| `pnpm run build` | `typecheck` then `pnpm -r --if-present run build` — recursively builds **both** the api-server (esbuild → `dist/index.mjs`) and the web app (`vite build` → `dist/public`). |
| `pnpm run build:api` | Build only the api-server bundle. |
| `pnpm run build:web` | Build only the web SPA. |
| `pnpm run start` | `NODE_ENV=production` + `start:api` — the production entrypoint. |
| `pnpm run start:api` | `node --enable-source-maps dist/index.mjs` (via the api-server's own `start`). |
| `pnpm run start:web` | `vite preview` of the built SPA (`dist/public`). |

`.replit` build provides `BASE_PATH=/` and `PORT` at build time because the web
Vite config (`vite.config.ts`) requires both env vars even for `vite build`. The run
step sets `NODE_ENV=production` and `PORT`.

## Production database migrations — migrate, never push

Local/dev resets the schema with `drizzle-kit push` (destructive, no history).
**In production, run versioned migrations instead:**

```sh
# 1. Generate migration SQL from schema changes (commit the output under lib/db/migrations)
pnpm --filter @workspace/db run generate
# 2. Apply pending migrations against the production DATABASE_URL
pnpm --filter @workspace/db run migrate
```

Run `migrate` as a release/deploy step before the new server starts. **Do not run
`push`/`push-force` against production** — they can drop columns/data without a
migration record.

## Required environment variables

Set these as deployment Secrets (never commit them). `JP_AUTH_SECRET` must be injected
via the Replit Secrets manager and rotated periodically (see the `[userenv.production]`
comment in `.replit`).

### Core (required)

| Var | Purpose |
|-----|---------|
| `DATABASE_URL` | Postgres connection string (`postgres://user:pass@host:5432/db`). |
| `JP_AUTH_SECRET` | HMAC secret for auth tokens, signed QR, and signed upload URLs. Strong random value (`openssl rand -base64 48`). |
| `PORT` | Port the API listens on (set by `[deployment.run]`, e.g. `8080`). Required — the server throws on startup if unset. |
| `NODE_ENV` | Must be `production` in prod. Toggles strict CORS, fail-fast providers, and drops dev-only OTP echo. |
| `PUBLIC_API_URL` | Public base URL of the API; used to mint absolute `/uploads/*` URLs. |
| `CORS_ORIGINS` | Comma-separated allow-list of web origins (e.g. `https://app.example.org`). In prod, CORS is restricted to this list; in dev any origin is reflected. |

### SMS / OTP (required in production)

The mock SMS provider is refused at first send in production, so configure one real
adapter. MSG91 (India) is implicit when its credentials are present, or pick `generic`.

| Var | Purpose |
|-----|---------|
| `SMS_PROVIDER` | `msg91` or `generic` (optional — inferred from the keys below). |
| `MSG91_AUTH_KEY` | MSG91 auth key (required for `msg91`). |
| `MSG91_TEMPLATE_ID` | MSG91 OTP template id (required for `msg91`). |
| `MSG91_SENDER_ID` | Optional MSG91 sender id. |
| `SMS_API_URL` | Generic provider endpoint that accepts `POST { phone, code }` (required for `generic`). |
| `SMS_API_KEY` | Optional bearer token for the generic endpoint. |

### Payments — Razorpay (required for live donations)

Falls back to a deterministic mock when unset (donations work end-to-end but charge
nothing). Configure for real payments.

| Var | Purpose |
|-----|---------|
| `RAZORPAY_KEY_ID` | Razorpay key id (presence + secret activates the real adapter). |
| `RAZORPAY_KEY_SECRET` | Razorpay key secret; also used to verify checkout signatures. |
| `RAZORPAY_WEBHOOK_SECRET` | Secret for verifying Razorpay webhook HMAC signatures. |

### File storage

Default is local disk; switch to S3 for multi-instance/autoscale (local disk is
per-instance and ephemeral — see the autoscale caveat).

| Var | Purpose |
|-----|---------|
| `UPLOADS_DIR` | Local-disk uploads directory (default `<cwd>/uploads`). |
| `UPLOAD_URL_TTL_SECONDS` | TTL for signed `/uploads/*` links. |
| `S3_BUCKET` | S3 bucket for the S3 storage provider (plus the usual `AWS_*` credentials in the runtime). |

### Optional / tuning

| Var | Purpose |
|-----|---------|
| `REDIS_URL` | Shared Redis. Needed for the auth rate limiter and any shared state across instances (see caveat). |
| `CRON_TZ` | Scheduler timezone (default `Asia/Kolkata`). |
| `LOG_LEVEL` | pino log level. |
| `ACCESS_TOKEN_TTL_SECONDS` | Access-token lifetime override. |

### Web build / mobile

| Var | Purpose |
|-----|---------|
| `BASE_PATH` | Web base path passed to `vite build`/`preview` (use `/` for root). Required by the web Vite config at build time. |
| `VITE_API_BASE_URL` | API origin the web app proxies `/api` and `/v1` to (dev/preview). |
| `PUBLIC_API_URL` | Also consumed by the mobile/Expo client as the API base. |

## Serving the web app

The web SPA is a static bundle at `apps/jain-pathshala/dist/public`. Serve it via
a CDN/static host (or a separate deployment running `pnpm run start:web`, which is
`vite preview`), and point `VITE_API_BASE_URL` / `PUBLIC_API_URL` at the API origin.
The API process here intentionally serves API routes only.

## Autoscale caveats

`deploymentTarget = "autoscale"` can run **multiple instances** and scale to zero. Two
pieces of in-process state are not safe across instances:

- **In-process cron scheduler** (`lib/scheduler.ts`, started in `index.ts`). With N
  instances, each runs the cron jobs (birthday wishes, etc.) → duplicate sends; when
  scaled to zero, jobs do not fire at all. For reliable scheduling, move these to an
  external scheduler/single worker, or gate on a Redis lock so only one instance runs
  a job per tick.
- **In-memory rate limiter** (`routes/auth.ts`, the OTP send/verify fixed-window
  buckets). Per-instance counters mean the effective limit multiplies by the instance
  count and resets on restart/scale events. Back it with the shared **`REDIS_URL`** for
  a correct cluster-wide limit (the code comments already flag this).

Local-disk file storage has the same multi-instance problem — use `S3_BUCKET` so
uploads are shared and durable across instances.
