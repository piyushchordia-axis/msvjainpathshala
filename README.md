# Jain Pathshala

Multi-tenant Jain religious-education platform for the **Megh Sanskar Vatika (MSV)** network, built under the **Enaa Creations** banner.

The product is a mobile-first system serving eight roles — `super_admin → state_admin → city_admin → sanchalak → shikshak → parent → student → guest` — across a NestJS API, an Expo mobile app, a Next.js admin + public site, and a FastAPI AI service. See [`SPEC.md`](./SPEC.md) for the full engineering specification (architecture, schema, endpoints, queues, security model, deployment) and [`CLAUDE.md`](./CLAUDE.md) for the day-to-day operating rules (stack constraints, business rules, design tokens, conventions).

---

## Surfaces

| Surface                  | Stack                                                 | Port (dev)     |
| ------------------------ | ----------------------------------------------------- | -------------- |
| `apps/api`               | NestJS 10 (HTTP) + BullMQ worker                      | 3000 / 3100    |
| `apps/mobile`            | Expo SDK 54+ with Expo Router v6                      | Metro on 19000 |
| `apps/web`               | Next.js 15 (App Router) — public site + admin panel   | 3001           |
| `apps/ai`                | Python 3.12 + FastAPI                                 | 8000           |
| `packages/shared`        | Zod schemas, enums, error codes, types (`@jp/shared`) | —              |
| `packages/design-tokens` | W3C tokens + typed exports (`@jp/design-tokens`)      | —              |
| `packages/i18n`          | EN/HI translation files + `t()` helper (`@jp/i18n`)   | —              |
| `packages/eslint-config` | Shared ESLint flat config (`@jp/eslint-config`)       | —              |

Local infrastructure (Postgres 16, Redis 7, MinIO, MailHog) runs from `infra/docker/docker-compose.yml`.

---

## Prerequisites

- **Node.js 20.11.0** — see [`.nvmrc`](./.nvmrc). With nvm installed, `nvm use` picks the right version.
- **pnpm 9** — managed via Corepack. `corepack enable && corepack prepare pnpm@9 --activate`. Do not use npm or yarn.
- **Docker** with the `docker compose` plugin — used for Postgres, Redis, MinIO, MailHog. Docker Desktop, OrbStack, Colima, or Rancher Desktop all work.
- **Git** with the included Husky hooks (auto-installed on `pnpm install` via the `prepare` script).
- **Python 3.12** — only required to develop `apps/ai`. The rest of the stack does not need Python.

---

## Local dev quickstart

```bash
# 1. Use the project Node version and install all workspaces.
nvm use
corepack enable
pnpm install

# 2. Bring up local infrastructure (Postgres, Redis, MinIO, MailHog).
docker compose -f infra/docker/docker-compose.yml up -d

# 3. Verify everything is healthy.
docker compose -f infra/docker/docker-compose.yml ps

# 4. Run the dev servers (lands in later build steps):
#    pnpm --filter @jp/api dev
#    pnpm --filter @jp/api dev:worker
#    pnpm --filter @jp/web dev
#    pnpm --filter @jp/mobile dev
```

When you're done:

```bash
docker compose -f infra/docker/docker-compose.yml down
```

### Useful URLs (local)

| What           | URL                                                               |
| -------------- | ----------------------------------------------------------------- |
| Postgres       | `postgres://jp:jp_dev_pwd@localhost:5432/jainpathshala`           |
| Redis          | `redis://localhost:6379`                                          |
| MinIO API      | `http://localhost:9000` (key/secret: `minioadmin` / `minioadmin`) |
| MinIO console  | `http://localhost:9001`                                           |
| MailHog SMTP   | `localhost:1025`                                                  |
| MailHog web UI | `http://localhost:8025`                                           |

---

## Repository scripts

All scripts are orchestrated by Turborepo across the workspace.

```bash
pnpm install                 # install everything
pnpm lint                    # ESLint across all packages
pnpm typecheck               # tsc --noEmit across all packages
pnpm test                    # unit tests (Vitest, where wired)
pnpm test:integration        # integration tests (Testcontainers, where wired)
pnpm build                   # production build per package (dependency-ordered)
pnpm format                  # Prettier write
pnpm format:check            # Prettier check

# Database (lands in Step 4):
pnpm db:generate             # generate Drizzle migration from schema changes
pnpm db:migrate              # apply migrations (advisory-lock protected)
pnpm db:studio               # open Drizzle Studio
pnpm db:seed:dev             # seed local dev data
```

Husky runs `lint-staged` on `pre-commit` and `commitlint` on `commit-msg`. Conventional Commits are required (`feat:`, `fix:`, `chore:`, etc).

---

## Build order

This repo is built in 23 numbered steps (see [`SPEC.md §19`](./SPEC.md)). Each step has explicit dependencies, exit criteria, and a single commit:

> `feat: step N — <short description>`

You are currently at **Step 1 — repository and tooling foundation**. Subsequent steps add shared packages (Step 2), the NestJS API foundation (Step 3), the database schema (Step 4), authentication (Step 5), and so on through deployment (Step 23).

---

## Design system

The product's design language lives in [`jp-design-system/`](./jp-design-system/) — tokens, type, motion, components, and the full [`DESIGN_GUIDE.md`](./jp-design-system/DESIGN_GUIDE.md). All UI work in `apps/web` and `apps/mobile` references these tokens (saffron `#D4621A`, maroon `#7A1818`, cream `#FDF8F2`, age-group colours, Punya tiers) via `@jp/design-tokens` — values are **never** hardcoded.

---

## Licence

Proprietary — © Enaa Creations / Megh Sanskar Vatika. Internal use only.
