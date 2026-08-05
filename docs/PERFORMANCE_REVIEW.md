# Performance review — full stack

Reviewed August 2026. Four layers swept: database, API, backend runtime, frontend (web + mobile).
Anchor: **go-live scale**, specifically the AT31 SLO in `infra/load-tests/attendance-burst-node.mjs:147`
— 5,000 attendance marks in 60 seconds, p95 < 1s, success > 99.9%.

Companion prompt pack: `docs/PERFORMANCE_FIX_PROMPTS.md`.

---

## The short version

Three things will stop you before any performance number matters:

1. **The Docker image cannot boot.** `argon2` is externalised from the esbuild bundle but never
   installed in the runtime image.
2. **Eight leftover debug `fetch()` calls** to `http://127.0.0.1:7744/` sit in the offline sync
   transport and the upload route.
3. **The pg pool is `new Pool({ connectionString })`** — default max 10, no timeouts. Every layer's
   findings funnel into this one line.

Below that, the pattern is consistent and encouraging: the *correctness*-critical code is careful and
well-reasoned (AT20 guarded inserts, AT19 ULID discipline, the AT5 canonical function, idempotency
keys, advisory locks). The *scale*-critical code is not — sequential loops where a set-based query
belongs, no pagination cursors, no code splitting, no caching layer that is actually used.

That is a good position to be in. Correctness bugs are expensive to find; throughput bugs are
mechanical to fix once located.

---

## Severity summary

| # | Layer | Finding | Sev |
|---|---|---|---|
| P1 | Runtime | Docker image missing `argon2` + `@aws-sdk/*` — process exits before `listen` | 🔴 Blocker |
| P2 | Runtime | 8 debug `fetch()` calls to `127.0.0.1:7744` in sync/upload hot paths | 🔴 Blocker |
| P3 | DB | pg pool: default max 10, no `connectionTimeoutMillis`, no `statement_timeout` | 🔴 Critical |
| P4 | API | Attendance mark loop: 7 statements per student, ~223 round trips per roster | 🔴 Critical |
| P5 | Web | Single 1.39 MB / 287 KB gzip bundle — public homepage ships the whole admin panel | 🔴 Critical |
| P6 | Web | `useAdminList` fires up to 50 **sequential** HTTP requests per table | 🔴 Critical |
| P7 | Mobile | Zero list virtualisation app-wide; attendance roster re-renders every row per tap | 🔴 Critical |
| P8 | Mobile | No offline query cache — the offline-first app is network-only | 🔴 Critical |
| P9 | Runtime | No worker process; CPU-bound renders + all crons run in the HTTP process | 🟠 High |
| P10 | Runtime | Redis absent → all queue work runs **inline** in the request path | 🟠 High |
| P11 | API | `marks[]` has no `.max()` — a 2 MB body is ~13,000 marks in one transaction | 🟠 High |
| P12 | DB | Six missing indexes on hot predicates; admin lists aggregate before `LIMIT` | 🟠 High |
| P13 | Runtime | Socket.IO: no Redis adapter, no handshake auth, CORS reflects any origin | 🟠 High |
| P14 | API | `consecutive_check` cron: 3 queries × every active student nationally | 🟠 High |
| P15 | Web | TanStack Query mounted but **zero** consumers — no cache anywhere | 🟠 High |
| P16 | All | No metrics, no timing, no queue depth, no pool gauges | 🟠 High |
| P17 | DB | No retention or partitioning on any unbounded table | 🟠 High |
| P18 | Web/Mobile | 13 font faces block first paint on both surfaces | 🟠 High |

---

# Layer 1 — Blockers

## P1 — The Docker runtime image cannot start

`apps/api-server/build.mjs:37` externalises `argon2` from the bundle. `apps/api-server/src/lib/tokens.ts:2`
imports it statically:

```ts
import argon2 from "argon2";
```

`tokens.ts` is in the import graph of `middlewares/auth.ts` → every router → `index.ts`. Verified in the
committed build:

```
$ grep -o 'from "argon2"' apps/api-server/dist/index.mjs
from "argon2"
```

`apps/api-server/Dockerfile:45-47` installs exactly one package:

```dockerfile
RUN npm init -y >/dev/null 2>&1 \
 && npm install --omit=dev --no-audit --no-fund sharp@0.34.5 \
 && npm cache clean --force
```

The container exits with `ERR_MODULE_NOT_FOUND` before `app.listen`. The `HEALTHCHECK` at `Dockerfile:61`
then flaps forever with no useful log line.

Same class of problem, deferred rather than immediate — `@aws-sdk/*` is externalised (`build.mjs:63`) and
dynamically imported, verified present in the bundle:

```
$ grep -o 'import("@aws-sdk/[a-z0-9-]*")' apps/api-server/dist/index.mjs
import("@aws-sdk/client-s3")
import("@aws-sdk/s3-request-presigner")
```

With `S3_BUCKET` set, every upload, every `/uploads/*` download, and every ID-card write fails at runtime
instead of at boot — which is worse, because it looks like a storage outage.

**Fix:** add `argon2`, `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` to the runtime install.
Add a CI smoke stage: `docker run --rm <image> node -e "import('argon2')"`.

## P2 — Debug telemetry left in the offline sync transport

Eight live call sites across three files — `services/sync-batch.ts:412,440`,
`services/homework-submit-sync.ts:119,162,190,242`, `routes/v1/uploads.ts:88,175`:

```ts
// #region agent log
fetch("http://127.0.0.1:7744/ingest/33975112-0421-4ef6-a79e-c48c452c7ec5", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "00ebc8" },
  body: JSON.stringify({ sessionId: "00ebc8", runId: "pre-fix", ... }),
}).catch(() => {});
// #endregion
```

`sync-batch.ts` is the **single offline transport** for the entire mobile fleet (CLAUDE.md §4). Per call:
a `JSON.stringify`, an undici socket allocation, a loopback connect, an `ECONNREFUSED`, a rejected promise,
a `.catch()` microtask — per op, per request. On a Saturday-morning reconnect burst that is thousands of
doomed sockets competing with real outbound work.

`uploads.ts:88` also serialises `req.body.folder`, and `homework-submit-sync.ts` serialises submission
internals, to an unauthenticated local endpoint.

**Fix:** delete all eight blocks. Add a CI grep gate on `#region agent log` and on `7744`.

---

# Layer 2 — Database

## P3 — The connection pool is the ceiling on everything

`lib/db/src/index.ts:13`, verbatim and complete:

```ts
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
```

node-postgres defaults: `max: 10`, `connectionTimeoutMillis: 0` (**wait forever**), no `statement_timeout`,
no `query_timeout`.

Those ten connections serve HTTP request handling, all ten BullMQ workers, all thirteen `node-cron` jobs,
and the materialised-view refresh — all in one process (P9).

Measured cost of one `POST /v1/sessions/:id/attendance` with a single mark: **~18 round trips**
(auth `SELECT *`, session load, scope resolution ×2, points resolution ×2, eligibility, sync claim,
advisory lock, `FOR UPDATE`, upsert, award insert, balance upsert, tier update, absence update, audit,
sync complete, BEGIN/COMMIT).

At 83 RPS that is ~1,500 statements/sec. At 1 ms RTT to a co-located Postgres the ceiling is ~10,000
stmt/s and you are at 15% — fine. At 3 ms RTT (managed Postgres, cross-AZ, the Replit→Neon topology)
the ceiling drops to ~3,300 and attendance alone consumes **45%**. Add the in-process post-process worker
and normal admin traffic and requests queue on `pool.connect()` — which, with `connectionTimeoutMillis: 0`,
queues *forever*. The load test will see rising latency and client-side timeouts rather than a clean 503,
which makes the failure much harder to diagnose than it needs to be.

**`DATABASE_URL_READ` is not implemented at all.** A repo-wide grep for `DATABASE_URL_READ|dbRead|replica`
returns only the three CLAUDE.md lines that mandate it — zero code, zero env plumbing, zero call sites.
The heavy analytics reads have no escape valve.

**Fix:**

```ts
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX ?? 20),
  min: 2,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  statement_timeout: 15_000,
  query_timeout: 15_000,
  application_name: process.env.PROCESS_ROLE ?? "api",
});
```

Give the worker process a separate, smaller pool so batch jobs cannot starve HTTP. Then either implement
`dbRead` or delete the claim from CLAUDE.md.

## P12 — Missing indexes on hot predicates

Six that matter, in cost order:

**`punya_transactions.created_at`** — `routes/v1/admin.ts:260-263` filters `created_at >= since` for the
admin dashboard. `lib/db/src/schema/punya.ts:86-99` only ever has `created_at` as a *trailing* column, so
a global range predicate uses none of them. Full seq scan of the Punya ledger on every dashboard load:
~300 ms at 1.6M rows (year 1), ~1.5 s at year 5, per admin, against a 10-connection pool.

**`sessions.submission_op_id`** — `services/session-lifecycle.ts:110-119`, the AT16 idempotency check
that runs *first* on every check-in and every offline replay. `lib/db/src/schema/attendance.ts:76-86` gives
it a CHECK constraint but no index, so the planner filter-scans every session that Guruji has ever taught.

**`sessions` where `status='in_progress'`** — `services/session-lifecycle.ts:551-575` (auto-checkout, every
30 minutes). `idx_sessions_date_status` leads with `scheduled_date`, so an equality on `status` alone
gets nothing. Full seq scan of `sessions` 48× a day, forever.

**`attendance (student_id, session_date DESC)`** — `routes/v1/students.ts:82-96` orders by
`sessions.scheduled_date`, forcing a fetch of the student's entire history plus a join plus a sort for a
40-row page. `session_date` is already denormalised onto `attendance` (`attendance.ts:104`) precisely to
avoid this, and the route doesn't use it.

**`notifications (user_id, created_at DESC)`** — `routes/v1/notifications.ts:81-84`. Table grows ~1.6M/yr
with zero pruning.

**`students` birthday predicate** — `routes/v1/notifications.ts:165` uses
``sql`to_char(${students.dob}, 'MM-DD') = ${mmdd}` ``. `to_char(date,text)` is `STABLE`, not `IMMUTABLE`,
so it cannot be indexed as written. Rewrite to `EXTRACT` and add a partial index.

**Also: three admin list routes aggregate the whole table before `LIMIT`.**
`routes/v1/admin-resources.ts:648-668` and `:670-695` do
`leftJoin(attendance) … groupBy(sessions.id) … orderBy … limit(50)`, with no date bound. Postgres must join
and aggregate every session × its attendance rows in scope, sort, then discard all but 50. For a
`super_admin` that is the full `sessions ⋈ attendance` product — 1.5M rows aggregated to return 50.

The correct pattern already exists in this codebase, at `routes/v1/homework.ts:778-802`, with a comment
explaining it: *"Counts only for the limited page (LATERAL), not a national GROUP BY then LIMIT."* Copy it.

**Also: redundant indexes on the two hottest write tables.** `idx_attendance_session` is fully subsumed by
`attendance_session_student_unique`; `idx_punya_transactions_student` by `idx_punya_transactions_student_created`.
Every redundant B-tree is maintenance work on every insert, 5,000 times in 60 seconds.

## P17 — No retention or partitioning anywhere

`grep -rn "delete from" apps/api-server/src` returns three hits: the device-session cleanup and two session
re-materialisation deletes. No `PARTITION BY` appears in any migration.

| Table | Growth | Year 1 / Year 5 |
|---|---|---|
| `notifications` | per parent per mark | 1.6M / 8M |
| `punya_transactions` | award + reversal + streak per mark | 1.6M / 8M |
| `sync_operations` | per offline submission, request **and** response JSONB | ~400 MB / ~2 GB |
| `audit_logs` | per submission + admin action | 100k / 500k |

`sync_operations` is the easy win — replay value expires in days (CLAUDE.md §7 caps retry at 10 attempts /
5-minute backoff), nothing reads a six-month-old row, and it is the largest by bytes. Prune at 30 days.

`punya_transactions` and `audit_logs` should be **partitioned by month before go-live**. Converting a
1.6M-row table to partitioned later requires a full rewrite under lock.

---

# Layer 3 — API

## P4 — The attendance mark loop

`services/attendance-mark.ts:597-610`:

```ts
const results: MarkItemResult[] = [];
for (const mark of input.marks) {
  results.push(await applyOneMark(tx, { sessionId: session.id, ... mark }));
}
```

`applyOneMark` issues **7 statements per student** for a fresh `present`: advisory lock, `SELECT … FOR UPDATE`,
attendance upsert, punya award insert, balance upsert, tier update, `absence_notifications` update.

One 30-student roster: **~223 round trips**, 210 of them holding an open transaction and an advisory lock.
A correction pass (present→absent) costs 11/student → **330**.

At the SLO: 167 roster submissions × 223 = **~37,000 statements**, each transaction holding a connection
for ~420 ms. Against a pool of 10 that is a **~24 txn/s ceiling** — and every dashboard read competes for
the same ten connections.

Five changes take it from 223 to ~25:

1. The `absence_notifications` update (`:494`) is student-independent within a session date — hoist it out
   of the loop into one `UPDATE … WHERE student_id = ANY($1)`. **−30**
2. Take **one** advisory lock on `session_id`, not one per `(session, student)`. `FOR UPDATE` plus
   `UNIQUE (session_id, student_id)` already give row-level safety. **−30**
3. Collapse the prior-state read into the upsert's `RETURNING` via a CTE. **−30**
4. Merge `creditBalance`'s upsert + tier `UPDATE` into one statement (`lib/punya.ts:85,95`). **−30**
5. Batch the award inserts: one `INSERT … SELECT FROM unnest(...) ON CONFLICT DO NOTHING RETURNING`,
   then one grouped balance upsert. **−60**

Point 5 must preserve AT20 — the balance moves only by the amount actually `RETURNING`ed. The current code
gets this exactly right (`attendance-mark.ts:226-231`); the batched version must too.

## P11 — `marks[]` is unbounded

`routes/v1/sessions.ts:32-41` and `services/sync-batch.ts:149-158` both declare `z.array(...).min(1)` with
no `.max()`. Verified — neither has one. The only cap is `express.json({ limit: "2mb" })` (`app.ts:90`),
which allows **~13,000 marks in one request** → ~91,000 statements in a single transaction, holding one of
ten connections and thousands of advisory locks for minutes.

`syncBatchBodySchema` correctly caps `ops` at 200 (`sync-batch.ts:64`) — but each of those 200 ops carries
an uncapped `marks[]`, and they process serially.

A Pathshala batch is 20–40 students. `.max(200)` is generous.

## Other N+1s, ranked

| Route | File | Cost |
|---|---|---|
| `GET /v1/sessions/today` | `sessions.ts:155-159` | 1 roster query **per session row**, no `.limit()`. A city_admin with 50 centres gets **201 queries** and 6,000 nested objects. |
| Homework bulk-grade | `homework.ts:964-1085` | Per submission: a transaction + an audit insert + **a synchronous Expo HTTPS call**. 40 students ≈ 560 statements + **10 seconds blocked on an external API**. |
| `POST /v1/id-cards/generate-all` | `id-cards.ts:42-90` | Unbounded student set × (barcode raster + 2× sharp + S3 round trip), inline in one HTTP request. For super_admin that is every student on the platform. This request cannot complete. |
| `attendance.post_process` | `attendance-post-process.ts:213-220` | Per student: full attendance history re-read, unbounded. ~120 statements + 120 Redis round trips per session. |
| `consecutive_check` cron | `consecutive-absence.ts:25-126` | 3 queries × **every active student nationally**. At 20,000 students = 60,000 queries at 02:00 IST. |
| Session force-cancel | `session-lifecycle.ts:471-491` | 8 statements per marked student, one transaction. |

## P15 and caching

**AT21 is half-implemented.** `lib/attendance-points.ts` caches the resolved points in Redis keyed on
`city_id` — but resolving `batch → centre → city` costs **two uncached DB queries on every mark**, even on
a 100% cache hit (`:135`, `:74`). Cache the `batch_id → city_id` mapping (immutable in practice) and key on
`batch_id` directly.

**`resolveAdminScope` is never cached and is called 2–3× per request** in several handlers.
`services/sync-batch.ts` re-resolves it for *every op in the batch* — a 5-op sync costs 10 redundant queries.
Memoise on `req`.

**Auth middleware does `SELECT *` from `users` on every request** (`middlewares/auth.ts:36`), including the
full `notification_preferences` JSONB. The JWT already carries `uid`; the DB read only adds a freshness check.
Project the columns actually used and cache for 30–60 s.

**Only four `Promise.all` calls exist in ~29,000 LOC.** `routes/v1/admin.ts:218-283` runs seven fully
independent queries in series — 280 ms where 60 ms would do.

---

# Layer 4 — Backend runtime

## P9 — Everything runs in one process

`apps/api-server/src/index.ts:14-17` starts all job registrars and `startQueueWorkers()` before the HTTP
listener; `:58` starts the cron scheduler inside the `listen` callback. `docker-compose.yml` defines one
service. There is no `dev:worker` script, no port 3100, no `WORKER_MODE` branch. **CLAUDE.md's documented
API-3000 / worker-3100 split does not exist.**

CPU-bound work that therefore lands in the request-serving process:

| Work | File | Blocks the loop? |
|---|---|---|
| `bwip-js` Code-39 raster | `lib/barcode.ts:23` | **Yes** — pure JS, `async` in signature only |
| `pdf-lib` build + `.save()` | `lib/pdf.ts:116` | **Yes** — pure JS deflate |
| `qrcode` PNG encode | `lib/qr.ts:11` | **Yes** — Reed–Solomon + PNG, pure JS |
| base64 of resized photo | `lib/idcard-render.ts:62` | **Yes** |
| sharp ×3 paths + argon2 | various | No — but all four share the **same 4-slot libuv threadpool** |

`UV_THREADPOOL_SIZE` is never set. During an OTP burst, argon2 hashing starves image processing and vice
versa. `lib/image-normalise.ts:65` uses `mozjpeg: true` (3–5× slower than baseline) on **every** image upload.

## P10 — No Redis means inline execution

`lib/queues.ts:51-67`:

```ts
export async function enqueueJob(name, data = {}, opts?): Promise<void> {
  const q = getQueue(name);
  if (q) { await q.add(...); return; }
  const handler = handlers.get(name);
  if (!handler) { logger.warn(...); return; }
  await handler(data);          // ← runs synchronously in the caller's stack
}
```

`.replit:1` provisions `nodejs-24`, `python-3.11`, `postgresql-16` — **no Redis**. So on that target, the
AT31 5-minute parent-push debounce and the 5-second post-process debounce both collapse to immediate inline
execution inside the HTTP request. `runAttendancePostProcess` then loops every already-marked student in the
session; on the 5,000th mark that is a 5,000-iteration × ~5-query loop **in one request**. Quadratic in marks
per session.

Make `REDIS_URL` required in production, alongside the existing `JP_AUTH_SECRET` and SMS fail-fast checks.

## Queue configuration

`lib/queues.ts:44-48` — verified:

```ts
const DEFAULT_JOB_OPTS: JobsOptions = {
  removeOnComplete: 100,
  removeOnFail: 50,
};
```

No `attempts`, so BullMQ defaults to **1**. Every cron-enqueued job gets one shot. A five-second DB blip at
01:00 IST means no sessions materialised for the night; the next attempt is 24 hours later, by which point
the rolling 60-day window has a hole and Gurujis hit the AT8 soft-create path en masse.

`enqueueDebouncedJob` already sets `attempts: 3` with exponential backoff (`:111-112`) — so the fix is just
making the defaults match. That same function sets `removeOnFail: false` on the two highest-volume queues,
which grows Redis monotonically with no reaper.

Workers set no `lockDuration`, so the 30-second default applies to jobs that run for minutes
(`analytics.refresh_views` does six sequential concurrent MV refreshes; `consecutive_check` loops the whole
student population). BullMQ renews the lock on a timer that lives on **the same event loop as the HTTP
server** — any main-thread block longer than the renew interval lets the lock lapse and the job re-executes.
For `consecutive_check` that means duplicate absence alerts to parent, Sanchalak and city_admin.

## P13 — Socket.IO

`lib/admin-dashboard-feed.ts:19-26`:

```ts
io = new Server(httpServer, { path: "/socket.io", cors: { origin: true, credentials: true } });
io.of("/admin-dashboard").on("connection", (socket) => {
  const cityId = String(socket.handshake.query["cityId"] ?? "");
  if (cityId) socket.join(`city:${cityId}`);
});
```

Verified: `@socket.io/redis-adapter` is not in `package.json` and `createAdapter` appears nowhere.

Three problems. No Redis adapter, so with two instances a mark on instance A never reaches an admin on
instance B — the AT31 aggregate feed is silently wrong the moment you scale past one container. No JWT
verification, so any anonymous client can pass `?cityId=<uuid>` and stream live attendance for any city
(CLAUDE.md mandates `auth: { token }` verified before namespace join). And `cors: { origin: true, credentials: true }`
reflects **any** origin with credentials, bypassing the `CORS_ORIGINS` allow-list the Express layer correctly
enforces at `app.ts:66-68`.

The aggregate buckets are also per-process in memory, so even with the adapter the counts would be
per-instance fractions.

## Cron overlap

`lib/scheduler.ts:28-45` registers every `node-cron` job **in every process that calls `startScheduler()`**,
and `index.ts:58` calls it from the HTTP listen callback. There is no advisory lock, no leader election, no
role guard. `grep pg_advisory` returns 13 hits — all per-entity request-transaction locks, none guarding a
scheduled job.

At N=1 this is latent. At N>1, `attendance.consecutive_check` sends **N× duplicate absence pushes** and
N concurrent `REFRESH MATERIALIZED VIEW CONCURRENTLY` calls serialise behind an ExclusiveLock.

Two smaller notes: `shutdownQueues()` exists (`queues.ts:180-189`) but is never called from `shutdown()`, so
in-flight jobs are killed on SIGTERM rather than draining. And `notifications.birthday` from the frozen cron
table has no registration in `src/jobs/` — it is registered inside `routes/v1/notifications.ts:272` instead,
which works but means the cron table and the job directory disagree.

## HTTP layer

No `compression` middleware — verified absent from `package.json` and `app.ts`. `GET /v1/public/centres`
returns every active centre nationwide, ungzipped. On a 3G connection that is 400 KB instead of 40 KB on the
marketing site's first paint.

No `Cache-Control` or `ETag` on any `/v1/public/*` route. `express.static` for the admin SPA uses the default
`maxAge: 0`, so Vite's content-hashed assets are revalidated on every load.

No `server.keepAliveTimeout` is set anywhere, so Node's 5-second default applies while
`docker-compose.yml:6` documents an nginx proxy in front — nginx's upstream keepalive default is 60 s. This
is the classic race that produces intermittent `502 Bad Gateway` under load, and it will be blamed on the
application.

## Media

The upload path is **well designed**: `multer.diskStorage` into `os.tmpdir()` with size limits and a MIME
allow-list, magic-byte detection on a 4 KB sample, temp unlink in `finally` on every path, streamed
`createReadStream` to storage with explicit `ContentLength`.

Two regressions against that design. For images the streaming collapses to a full in-heap `Buffer`
(`routes/v1/uploads.ts:148-163` → `image-normalise.ts:65` returns `.toBuffer()`); at a 50 MB limit and 20
concurrent uploads that is up to 1 GB resident. And `lib/storage.ts:196-214` builds a `Readable` with a
no-op `_read` and discards `push()`'s return value, so S3 bodies drain as fast as S3 delivers regardless of
client consumption — a parent on 3G downloading a 20 MB video buffers the whole object in heap.

`presignedUrl()` exists at `storage.ts:184-191` and **nothing calls it**. `url()` always routes bytes through
the Node process, so every media byte in the system is proxied by the API. That is the single largest
avoidable bandwidth and event-loop cost in the deployment.

## P16 — No observability

`grep -rn "metrics|prom-client|/metrics|performance.now"` across `apps/api-server/src` returns nothing.
No metrics endpoint, no request-duration histogram (the pino-http serializers at `app.ts:47-60` discard
`responseTime`), no slow-query logging, no queue depth, no pool gauges.

When the burst misses p95, there will be no data to say whether it was the pool, Redis, the event loop or
Postgres. This is the finding that makes every other finding harder to close.

The logger redact list (`lib/logger.ts:5-25`) covers `authorization`, `cookie`, `phone` — but not `email`,
`pan`, `aadhaar`, `password`, `otp` or `token`, all of which CLAUDE.md requires. `lib/notify.ts:89` logs
`{ err }`, and a pg error object carries the failing statement's parameters.

---

# Layer 5 — Frontend

## P5 — Web ships one bundle

`apps/jain-pathshala/vite.config.ts:70-73` has no `manualChunks`, no `chunkSizeWarningLimit`, no analyzer.
`src/App.tsx:11-75` statically imports all 57 route components. Zero `React.lazy`, zero `Suspense`, zero
`import()` anywhere in `src/`.

Measured on the committed build:

```
index-yn5ajvgj.js    raw=1,393,047   gzip=287,500
index-D2YOUf_r.css   raw=  109,721   gzip= 18,003
```

That build predates `AnalyticsPage`'s recharts import, so it is a **lower bound**.

A parent in a small town opening the public homepage on 3G waits ~6 seconds for JS transfer alone, then
1.5–3 s of parse/compile on a low-end Android, before any content. They are downloading `AuditLogPage`,
`QueuesPage`, `ExamGradingPage` and 37 other admin screens they can never access — ~290 KB of pure waste
per cold visit, on metered data.

Splitting at the two shells (public vs admin) recovers most of it. `components/ui/chart.tsx:2` also does
`import * as RechartsPrimitive from "recharts"`, which defeats tree-shaking and pulls ~110 KB gzip of chart
library into the bundle every public visitor downloads.

## P6 — `useAdminList` fires 50 sequential requests

`apps/jain-pathshala/src/hooks/useAdminList.ts:31-37`:

```ts
do {
  const envelope = await get<ListEnvelope<T>>(withCursor(path, cursor));
  collected.push(...(envelope.data?.items ?? []));
  cursor = ...;
  guard += 1;
} while (cursor && guard < 50);
```

Each iteration awaits the previous. 30 call sites, several with large page sizes —
`AdminListPages.tsx:1017` requests `?limit=200` against Punya transactions, so a fully-populated table is
**up to 10,000 rows over 50 serial requests**.

On a 300 ms-RTT rural connection that is 20–30 seconds of spinner, then 10,000 unvirtualised `<tr>`s in the
DOM. No `AbortController` — navigating away lets the loop run to completion and `setItems` fires on an
unmounted component.

## P15 — TanStack Query is mounted and unused

`App.tsx:77-84` constructs a `QueryClient` with `staleTime: 30_000`. Verified:

```
$ grep -rn "useQuery|useMutation" apps/jain-pathshala/src | wc -l
0
```

All 34 pages hand-roll `useEffect` + `fetch`. Every navigation refetches from zero. A Sanchalak toggling
Students → Attendance → Students re-downloads the roster three times. The `staleTime` config is dead code,
and `refetchOnWindowFocus` defaults to `true` — which will become a refetch storm the moment pages *do*
start using it.

## Other web findings

- **No virtualisation and no `React.memo` anywhere.** `IdCardsPage` mounts 500 buttons and re-filters all
  500 on every keystroke. `MediaCurationPage` mounts 200 Radix `Switch`+`Checkbox` pairs.
- **`AttendancePage.tsx:265-269` mounts one Radix `Dialog` per session row** — 100 Dialog roots, each with
  portal/focus-trap/dismissable-layer machinery, on a page showing 100 rows.
- **Both context providers pass a new object literal every render** (`auth-context.tsx:38`,
  `locale-context.tsx:27`). They wrap the whole app, and with nothing memoised the cascade reaches every row.
- **Admin image grids are not lazy** (`GalleryAdminPage.tsx:290`, `MediaCurationPage.tsx:440-444`) — opening
  media curation triggers 200 simultaneous full-size image requests, 200–400 MB on a metered connection.
- **Gallery falls back to `image_url` when `thumbnail_url` is missing**, putting a full-resolution phone
  photo into a 300 px cell.

## P7 — Mobile has no list virtualisation

`components/ui.tsx:63-84` — the shared `Screen` primitive is a plain `ScrollView` with no
`removeClippedSubviews`; screens `.map()` directly into it. The **only** `FlatList` in the app is
`components/GalleryCarousel.tsx:140` — which is also the reference implementation, with both `keyExtractor`
and `getItemLayout` done correctly.

Unvirtualised, unbounded: `app/my-attendance.tsx:86` (full attendance history), `app/student/punya.tsx:87`
(entire Punya ledger), `app/shikshak/students.tsx:61`, `app/admin/students.tsx:59`, `app/notifications.tsx:58`,
`app/shikshak/niyam-review.tsx:39` (100 rows with thumbnails), `app/gallery.tsx` (60-image grid).

**The attendance roster is the worst case, and it is the app's core flow.** `app/attendance/[id].tsx:74-78`
holds all marks in one `Record` on the screen component; rows are inline JSX in `roster.map` (`:297-348`),
not memoised, each with two inline arrows. `React.memo` appears nowhere in `app/` or `components/`. A
50-student roster costs ~250 component renders per tap — 120–300 ms of JS-thread block on a low-end Android.
The Guruji taps 50 times and every tap feels sticky.

`app/gallery.tsx` is a likely OOM: 60 remote images via React Native `Image` (not `expo-image`, unlike every
other screen), no caching policy, in a `flexWrap` grid inside a ScrollView. At 800×600 that is ~110 MB of
decoded RGBA on a 1 GB device. It also fires **both** `useWallGallery(60)` and `useAdminWallGallery(isStaff, 60)`
for staff and discards one, because `useWallGallery` has no `enabled` guard.

## P8 — Mobile has no offline cache

`app/_layout.tsx:55`:

```tsx
const queryClient = new QueryClient();
```

No `defaultOptions`, no `persistQueryClient`, no `onlineManager`/`focusManager`, and
`@react-native-community/netinfo` is not a dependency. Combined with `REQUEST_TIMEOUT_MS = 30_000`
(`lib/api.ts:9`) and React Query's default `retry: 3`.

So: the Guruji opens `/attendance/:id` with no signal. There is no cached roster.
Three retries against a 30-second timeout = **~2 minutes of bare spinner**, then an error, and no roster to
mark. That is total failure of the module's primary use case — the exact scenario the entire offline-sync
design in CLAUDE.md exists to prevent.

Separately, `staleTime: 0` refetches everything on every navigation over metered 3G, and
`app/parent/home.tsx:41-42` downloads two years of attendance JSON to render `rows.slice(0, 2)`.

## Other mobile findings

- **The offline queue is AsyncStorage, not MMKV** (`lib/offline/storage.ts:1-4` says so in a comment), with
  a full-queue `JSON.parse` → mutate → `stringify` → write per mutation. Draining 20 ops = 40+ full
  serialisations, exactly when the Guruji regains signal.
- **The sync loop polls all seven queues every 5 seconds** for every role, backgrounded, offline, forever
  (`sync-engine.ts:317-333`) — ~5,760 storage round trips per hour on a device that charges once a day.
- **`app/exams.tsx:493-497`** keeps questions, selections and text in one state object, so every keystroke
  re-renders ~150 components during a *timed* exam.
- **13 font faces block first paint** (`_layout.tsx:106-120` + `:191` returning `null`) — ~1.5–2 MB parsed
  before the first pixel, every launch. Same 13-face over-fetch on web (`index.css:1`), where it is also
  behind a render-blocking `@import` inside a 109 KB stylesheet, creating a three-hop critical chain.
- **A spec deviation with a cost:** `index.css:75-76` puts `Outfit` first in both font stacks. CLAUDE.md
  mandates Tiro Devanagari Sanskrit for display and Mukta for body. Outfit has no Devanagari coverage, so
  Hindi text falls through anyway — meaning all six Outfit weights are downloaded and, for Hindi users,
  largely unused.

---

# What is genuinely good

This is not padding — several of these are patterns the broken code should be fixed *toward*.

**Correctness under concurrency is careful.** AT20's guarded insert is right everywhere: `ON CONFLICT DO
NOTHING … RETURNING`, with the balance moving only by the returned amount (`attendance-mark.ts:224-231`,
`punya.ts:118-131`). The reverse-then-award pair resolves the most-recent-unreversed award rather than
blindly `revision − 1`. This is the silent-corruption class CLAUDE.md warns about, and it is actually prevented.

**The AT5 canonical function is correct.** `COUNT(*) FILTER` not `COUNT(expr IN …)` — the exact trap the rule
calls out. `NULLIF` denominator, `'excused'` excluded by appearing in neither filter, Kolkata-date
`deactivated_at` handling, `LANGUAGE sql STABLE` so it inlines. And `migrations/0017:9-18` documents *why*
the AT10 holiday predicate was tautological rather than cargo-culting it forward.

**AT19 ULID discipline is airtight.** `char(26)` plus a Crockford-Base32 regex CHECK on all three op-id
columns, never `uuid`, with a documented migration hazard note.

**`homework.ts:740-802` is the reference pagination.** Keyset cursor on the driving table, then
`LEFT JOIN LATERAL` for per-row counts, with a comment explaining exactly why. Three admin routes should be
rewritten to match it.

**`niyam-submissions.ts:329-359`** pages a bulk update by `id` in batches of 200 and never loads the table —
the model for every other bulk operation.

**All timestamps are `timestamptz`, no exceptions across 28 schema files.** Rare to get 100% right.

**Redundant indexes are actively being cleaned**, not merely accumulated — migrations 0025, 0030 and 0009
each dropped a subsumed index when a composite landed. The remaining redundancies are the tail of a job
already in progress.

**`maxRetriesPerRequest: null` on the BullMQ connection** (`queues.ts:27`) — the single most commonly missed
BullMQ requirement, correctly set, with the other clients deliberately using `1`.

**Two-tier cache that refuses to cache a zero miss** (`attendance-points.ts:126-127`) — a subtle correctness
detail most implementations get wrong.

**`pino-pretty` correctly gated to non-production** (`logger.ts:17-24`) — a very common production footgun,
avoided.

**Upload handling is disk-backed, not memory-backed**, with magic-byte detection on a 4 KB sample and temp
unlink in `finally` on every path.

**Health checks are correctly split** — liveness DB-free, readiness with a real probe. Graceful shutdown with
in-flight drain and an `unref`'d force-exit timer.

**Mobile has React Compiler enabled** (`app.json` `experiments.reactCompiler`), which auto-memoises inline
props and context values. It is why the mobile render findings are "the dependency genuinely changed"
problems rather than "everything always re-renders". It does not substitute for virtualisation.

**Mobile carries no dead weight** — no `moment`, no `lodash`, no chart library, no `date-fns`.
`lib/format.ts` is a hand-rolled 30-line date formatter, exactly right for this device class.

**Reduce-motion is respected throughout** the mobile app, short-circuiting animation work entirely on
low-end devices.

**The load test asserts invariants, not just latency** — `attendance-burst-node.mjs:113-141` checks for
duplicate idempotency keys and balance drift and exits non-zero. That is the right instinct and it is why
this review could anchor on a real number.

---

# Recommended order

**Phase 1 — before any load test is meaningful**

1. Dockerfile runtime deps (P1). Nothing else matters if the container cannot boot.
2. Delete the eight debug `fetch` blocks (P2).
3. pg pool `max` + `connectionTimeoutMillis` + `statement_timeout` (P3).
4. `REDIS_URL` required in production (P10).
5. `.max(200)` on both `marks[]` schemas (P11).

**Phase 2 — database**

6. Six indexes, all `CREATE INDEX CONCURRENTLY`, no downtime (P12).
7. Rewrite the three admin list routes to the LATERAL pattern (P12).
8. Retention on `sync_operations` + `notifications`; partition `punya_transactions` + `audit_logs` (P17).
9. Drop the redundant indexes on `attendance` and `punya_transactions`.

**Phase 3 — API and runtime**

10. Attendance loop batching: 223 → ~25 statements per roster (P4).
11. Split the worker process; move the scheduler into it (P9).
12. `attempts: 3` + bounded `removeOnFail` + `lockDuration` (queue config).
13. Cache `batch → city`; memoise `resolveAdminScope` on `req`; project the auth `SELECT`.
14. Set-based rewrite of `consecutive_check` and `post_process` (P14).
15. `keepAliveTimeout = 65_000`; `compression()`; public `Cache-Control`.
16. Socket.IO Redis adapter + handshake auth + CORS allow-list (P13).
17. `prom-client` + pool/queue gauges + restore `responseTime` (P16).

**Phase 4 — frontend**

18. Web: code-split admin from public (P5). Biggest single user-facing win.
19. Web: kill the 50-request loop in `useAdminList` (P6).
20. Mobile: `React.memo` the roster row + `FlatList` it (P7). Biggest single mobile win.
21. Mobile: `QueryClient` defaults + persister + NetInfo (P8).
22. Both: trim fonts from 13 faces to 3 (P18).
23. Web: adopt the mounted TanStack Query, or drop the dependency (P15).
24. Mobile: `expo-image` + `FlatList` in `gallery.tsx`; batch the AsyncStorage writes.

---

*Findings verified against the working tree at commit time. Every file:line cited was read, and the five
highest-stakes claims — the argon2 import in `dist/index.mjs`, the eight `7744` call sites, the pool
config, the zero `useQuery` consumers, and the absent Socket.IO adapter — were re-verified independently
before publication.*
