# Jain Pathshala — Load Tests

k6 scripts for the SLO targets in SPEC.md §15.6.

## Prerequisites

```bash
brew install k6                # or your platform equivalent — see https://k6.io/docs/get-started/installation/
docker compose -f ../docker/docker-compose.yml up -d
pnpm --filter @jp/api dev       # API at localhost:3000
pnpm --filter @jp/api dev:worker  # worker at localhost:3100 (needed for fan-out + sync tests)
pnpm --filter @jp/api db:seed:dev # seed the k6 test users
```

Optional environment variables:

| Variable          | Default                    | Purpose                                          |
| ----------------- | -------------------------- | ------------------------------------------------ |
| `BASE_URL`        | `http://localhost:3000`    | API root for every k6 script                     |
| `K6_PHONE_PREFIX` | `+91900000`                | Seed phone prefix — pad with the iteration index |
| `K6_OUTPUT_DIR`   | `infra/load-tests/results` | Where summary JSONs land                         |

## Scripts and SLOs

| Script                      | Target load                                   | SLO                                        |
| --------------------------- | --------------------------------------------- | ------------------------------------------ |
| `k6/auth-otp-burst.js`      | 10k VUs ramped over 60s, one OTP send each    | p95 < 500ms, success > 99.5%               |
| `k6/attendance-burst.js`    | 5k concurrent attendance marks over 60s       | p95 < 1s, success > 99.9%, zero duplicates |
| `k6/leaderboard-reads.js`   | 200 VUs × 250 iter = 50k reads over 60s       | p95 < 200ms, success > 99.95%              |
| `k6/notification-fanout.js` | 100 admin POSTs × 500 recipients = 50k pushes | 95% delivered within 30s                   |
| `k6/sync-batch.js`          | 1k VUs × 50 ops/batch                         | p95 < 5s, zero duplicates                  |

`scenarios/full-load-suite.sh` runs all five sequentially and renders a markdown report.

## Notes on local vs staging runs

The SLOs assume warmed-up cloud infrastructure (PgBouncer, Redis, multiple ECS tasks). On a single
laptop the same scripts will likely miss the SLO numbers — they're authored to be **runnable** here
for smoke verification, and **definitive** when pointed at staging via `BASE_URL`.
