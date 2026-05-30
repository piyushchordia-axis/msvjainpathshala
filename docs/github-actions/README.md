# GitHub Actions workflows (offline copies)

Workflow files live here instead of `.github/workflows/` so you can **`git push` over HTTPS with a normal `repo` PAT** — GitHub requires the extra **`workflow`** scope only when creating or updating files under `.github/workflows/`.

## Run CI locally (no GitHub Actions)

From the repo root:

```bash
pnpm ci:local
```

For integration tests you also need Postgres + Redis (e.g. `docker compose -f infra/docker/docker-compose.yml up -d`), then:

```bash
pnpm test:integration
```

## Enable Actions on GitHub (pick one)

**SSH (no `workflow` scope on PAT):**

```bash
mkdir -p .github/workflows
cp docs/github-actions/workflows/*.yml .github/workflows/
git add .github/workflows/
git commit -m "chore: enable GitHub Actions workflows"
git push origin main   # uses SSH remote
```

**HTTPS PAT with `workflow` scope:** same copy step, then push with an updated token.

**GitHub web UI:** create each file under `.github/workflows/` in the browser and paste from `docs/github-actions/workflows/`.

## Files

| File                    | Purpose                                                         |
| ----------------------- | --------------------------------------------------------------- |
| `ci.yml`                | Lint, typecheck, unit + integration tests, build, security scan |
| `dast.yml`              | OWASP ZAP (weekly)                                              |
| `deploy-staging.yml`    | Staging deploy (OIDC)                                           |
| `deploy-production.yml` | Production deploy (OIDC)                                        |
