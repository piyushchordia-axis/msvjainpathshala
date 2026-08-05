# Cursor prompt pack — full-stack performance fixes

Companion to `docs/PERFORMANCE_REVIEW.md`. Twenty-four prompts covering every finding, grouped
into five phases, each phase with an orchestration prompt.

**How to use**

1. Paste **§0 Shared context** into Cursor once per session (or save it as a `.cursor/rules`
   entry so it rides along automatically).
2. Run either the phase orchestration prompt (bigger diff, fewer round trips) or the individual
   fix prompts in order (small, reviewable commits).
3. Phase 1 is non-negotiable ordering: the container cannot boot until PERF #1 lands, so nothing
   downstream is verifiable before it.

**Real commands in this repo**

| Purpose | Command |
|---|---|
| Typecheck everything | `pnpm typecheck` |
| API tests | `pnpm --filter @workspace/api-server test` |
| One API test file | `pnpm --filter @workspace/api-server test attendance` |
| Web build (measure the bundle) | `pnpm --filter @workspace/jain-pathshala build` |
| Generate migration | `pnpm db:generate` |
| Apply migration | `pnpm db:migrate` |
| Load test | `node infra/load-tests/attendance-burst-node.mjs` |

---

## Contents

- [§0 Shared context](#0--shared-context-paste-once)
- [Phase 1 — Blockers (#1–#5)](#phase-1--blockers)
- [Phase 2 — Database (#6–#9)](#phase-2--database)
- [Phase 3 — API throughput (#10–#14)](#phase-3--api-throughput)
- [Phase 4 — Runtime and infrastructure (#15–#19)](#phase-4--runtime-and-infrastructure)
- [Phase 5 — Frontend (#20–#24)](#phase-5--frontend)

---

## §0 — Shared context (paste once)

```
You are working in the Jain Pathshala monorepo (pnpm workspaces + TypeScript).

IMPORTANT — the running stack differs from CLAUDE.md. CLAUDE.md describes NestJS in apps/api.
The ACTUAL backend is Express 5 in apps/api-server, with Drizzle exported from @workspace/db and
Zod contracts in @workspace/api-zod. Do NOT refactor toward NestJS. Match the surrounding code.

Surfaces:
  apps/api-server              Express API (the backend)
  apps/jain-pathshala          Web: public marketing site AND admin panel, React 19 + Vite 7
  apps/jain-pathshala-mobile   Expo app (code in app/, components/, hooks/, lib/ — NOT src/)
  lib/db                       Drizzle schema + migrations (@workspace/db)
  apps/jp-shared               queue names + cron expressions (@jp/shared)

Read before writing any code:
  1. CLAUDE.md at the repo root. Authoritative over SPEC.md. For this work, pay particular
     attention to AT5, AT17, AT18, AT20, AT21, AT22, AT31, and "Offline sync — canonical model".
  2. docs/PERFORMANCE_REVIEW.md — the review these fixes come from.
  3. The files named in the prompt AND their immediate neighbours.

THE PRIME DIRECTIVE FOR THIS PHASE OF WORK:
You are making things faster. You are NOT allowed to make them less correct. Specifically:
  - AT20: a guarded insert's balance moves ONLY by the amount actually RETURNINGed. If you batch
    Punya awards, the batched version must preserve this exactly. An unguarded bulk increment
    double-awards on every resync and is the worst bug you could introduce here.
  - AT5: there is ONE canonical attendance-percentage implementation, in SQL. Never re-implement
    the arithmetic in TypeScript, not even "temporarily for performance".
  - AT17/AT18: idempotency keys and reverse-then-award pairs are exact. Do not "simplify" them.
  - AT22: streak arithmetic is exact — 20 points every 4 consecutive attended, repeating;
    'excused' skips; 'absent' resets; holidays and cancelled sessions skipped.
  - Q11: students are deactivated, never deleted.
If a performance change requires touching any of the above, STOP and say so before proceeding.

Conventions:
  - Responses go through ok(res, data, meta) / fail(res, status, CODE, message) from src/lib/envelope.
  - Error codes are ERR_SCREAMING_SNAKE. Error copy states the problem AND the fix.
  - Drizzle query builder by default; sql`` only where the surrounding code already does.
  - British spelling in schema names: centres, not centers.
  - Every user-facing string ships _en and _hi, proper Devanagari.
  - Never inline a Punya point value — resolve from punya_features.

Definition of done — every prompt, no exceptions:
  1. Establish the BEFORE number. A perf fix without a before/after measurement is a guess.
     Query counts via a db spy, bundle bytes via the build output, wall time via the load test.
     Paste the BEFORE.
  2. Write or identify the test that proves behaviour is UNCHANGED. Run it. Paste it passing.
  3. Make the change.
  4. Re-run that test. Paste it passing again. Paste the AFTER number.
  5. Run `pnpm typecheck` from the repo root. Paste the output.
  6. Commit with the exact message given in the prompt.
"It feels faster" is not a result. Do not report a task complete without pasted, real output.
```

---

# Phase 1 — Blockers

Five items. Until #1 lands the container does not start, so nothing else in this pack is verifiable.

### Phase 1 orchestration prompt

```
Work through docs/PERFORMANCE_FIX_PROMPTS.md prompts PERF #1 through #5 in order. The order is
strict: #1 makes the image bootable, #2 removes an active hot-path defect, #3 removes the pool
ceiling, #4 and #5 remove two unbounded-work vectors. Nothing after Phase 1 can be measured until
#1 and #3 are in.

One commit per fix. After each, stop and print a short diff summary.

After #5, run the load test (node infra/load-tests/attendance-burst-node.mjs) and paste the full
output. That is the Phase 1 exit criterion and the baseline for Phase 3.
```

---

### PERF #1 — The Docker image cannot boot

```
PERF #1 — Runtime image is missing argon2 and @aws-sdk/* (blocker)

Files:
  apps/api-server/Dockerfile      (~lines 45-47)
  apps/api-server/build.mjs       (~lines 30-103, the `external` array)
  apps/api-server/src/lib/tokens.ts  (~line 2)

PROBLEM
build.mjs externalizes argon2 (line ~37) and @aws-sdk/* (line ~63) from the esbuild bundle.
tokens.ts:2 imports argon2 STATICALLY, and tokens.ts is in the import graph of middlewares/auth.ts
-> every router -> index.ts. Verify for yourself:

  grep -o 'from "argon2"' apps/api-server/dist/index.mjs
  grep -o 'import("@aws-sdk/[a-z0-9-]*")' apps/api-server/dist/index.mjs

Dockerfile:45-47 installs exactly one package:
  RUN npm init -y && npm install --omit=dev --no-audit --no-fund sharp@0.34.5

So dist/index.mjs emits `import argon2 from "argon2"` and resolves it against a node_modules
containing only sharp. The container exits with ERR_MODULE_NOT_FOUND before app.listen, and the
HEALTHCHECK at Dockerfile:61 flaps forever with no useful log.

@aws-sdk is worse in a subtler way: it is dynamically imported, so it fails at RUNTIME on the first
upload/download rather than at boot. That presents as a storage outage, not a packaging bug.

TEST FIRST
  Build the image and prove the failure before fixing it:
    docker build -t jp-api-test -f apps/api-server/Dockerfile .
    docker run --rm jp-api-test node -e "import('argon2').then(()=>console.log('OK'))"
  Paste the FAILING output. If it unexpectedly succeeds, stop and tell me — the packaging may
  differ from what I read and the rest of this prompt would be wrong.

CHANGE
  Add the three missing externals to the runtime install in Dockerfile:46. Pin them to the exact
  versions in the workspace lockfile — read pnpm-lock.yaml, do not guess:
    argon2, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner

  Do NOT solve this by removing argon2 from build.mjs's `external` array. argon2 is a native
  module and cannot be bundled. @aws-sdk CAN be bundled if you prefer that route — if you take it,
  say so and show the resulting dist size delta, because it will be large.

  Then re-run the smoke command above and paste it succeeding.

CI GATE — add in the same commit
  A step that runs the container and imports every externalized module. Read the `external` array
  in build.mjs and generate the check from it, so the next added external cannot silently repeat
  this. A hand-written list of three will drift.

COMMIT: fix: install externalized native deps in the runtime image
```

---

### PERF #2 — Debug telemetry in the offline sync transport

```
PERF #2 — Eight leftover agent-debug fetch() calls in production hot paths (blocker)

Files:
  apps/api-server/src/services/sync-batch.ts           (~lines 411-412, 439-440)
  apps/api-server/src/services/homework-submit-sync.ts (~lines 118-119, 161-162, 189-190, 241-242)
  apps/api-server/src/routes/v1/uploads.ts             (~lines 87-88, 174-175)

PROBLEM
  // #region agent log
  fetch("http://127.0.0.1:7744/ingest/33975112-0421-4ef6-a79e-c48c452c7ec5", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "00ebc8" },
    body: JSON.stringify({ sessionId: "00ebc8", runId: "pre-fix", ... }),
  }).catch(() => {});
  // #endregion

sync-batch.ts is the SINGLE offline transport for the entire mobile fleet (CLAUDE.md §4). Each call
costs a JSON.stringify, an undici socket allocation, a loopback connect, an ECONNREFUSED, a rejected
promise and a .catch() microtask — per op, per request. On a Saturday-morning reconnect burst that is
thousands of doomed sockets competing with real outbound work (Expo push, S3).

uploads.ts:88 also serialises req.body.folder, and homework-submit-sync.ts serialises submission
internals, to an unauthenticated local endpoint. That is a data-egress path nobody signed off on.

CHANGE
  Delete all eight #region agent log blocks, including the #endregion markers and any now-unused
  local variables they referenced.

  Confirm with:
    rg "agent log|7744" apps/api-server/src
  Paste the output — it must be empty.

CI GATE — add in the same commit
  A grep step that fails the build on "#region agent log" or "127.0.0.1:7744" anywhere under apps/.
  This is the second time debug instrumentation has been found in a hot path; a gate is cheaper
  than a third review.

THEN — audit only, do not fix here
  rg "127\.0\.0\.1|localhost:[0-9]" apps/api-server/src apps/jain-pathshala/src apps/jain-pathshala-mobile
  Report anything that looks like leftover instrumentation rather than legitimate dev config.

COMMIT: fix: remove leftover debug telemetry from sync and upload paths
```

---

### PERF #3 — The pg pool has no configuration

```
PERF #3 — Connection pool defaults are the ceiling on the whole system (critical)

File: lib/db/src/index.ts  (~line 13)

PROBLEM
  export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

That is the complete pool setup. node-postgres defaults: max 10, connectionTimeoutMillis 0
(WAIT FOREVER), no statement_timeout, no query_timeout.

Those ten connections serve HTTP handling, all ten BullMQ workers, all thirteen node-cron jobs, and
the materialised-view refresh — all in one process today (see PERF #15).

One POST /v1/sessions/:id/attendance with a single mark costs ~18 round trips. At the SLO of 83 RPS
that is ~1,500 statements/sec. At 3ms RTT to managed Postgres the pool ceiling is ~3,300 stmt/s, so
attendance alone eats 45%. Requests then queue on pool.connect() — and with connectionTimeoutMillis
at 0 they queue forever, so the failure mode is rising latency and client timeouts rather than a
clean 503. That is much harder to diagnose than it needs to be.

BEFORE
  Run: node infra/load-tests/attendance-burst-node.mjs
  Paste the full output including p95 and success rate. This is the baseline for all of Phase 3.

CHANGE
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

  Add PG_POOL_MAX to .env.example with a comment explaining the sizing rationale (it should be set
  relative to the Postgres max_connections, divided across API + worker instances — say so).

  Keep the existing pool.on("error") handler. The comment above it explains a real failover hazard;
  do not remove it.

CAUTION — statement_timeout will now cancel long queries
  Some jobs legitimately run for minutes: analytics.refresh_views does six sequential concurrent MV
  refreshes; attendance.consecutive_check loops the whole student population. A 15s statement_timeout
  will kill them. Find every such job, and give the worker path a SEPARATE pool with a much higher
  (or absent) statement_timeout. Do not solve this by raising the API timeout to match the slowest
  batch job — that defeats the purpose.

AFTER
  Re-run the load test. Paste the output. Report the delta in p95 and success rate.

ALSO — report only, do not implement
  CLAUDE.md mandates DrizzleService.db vs .dbRead with DATABASE_URL_READ. A repo grep for
  DATABASE_URL_READ|dbRead|replica returns only the CLAUDE.md lines themselves — it is entirely
  unimplemented. Tell me whether you think it is worth implementing now or whether the claim should
  be deleted from CLAUDE.md. Do not do either in this commit.

COMMIT: perf: configure pg pool sizing and statement timeouts
```

---

### PERF #4 — Unbounded marks[] arrays

```
PERF #4 — marks[] has no maximum; a 2MB body is ~13,000 marks in one transaction (high)

Files:
  apps/api-server/src/routes/v1/sessions.ts    (~lines 31-42, markBodySchema)
  apps/api-server/src/services/sync-batch.ts   (~lines 149-158)

PROBLEM
Both declare z.array(...).min(1) with NO .max(). Verify:
  rg -A2 "marks: z$" apps/api-server/src/routes/v1/sessions.ts apps/api-server/src/services/sync-batch.ts

The only cap is express.json({ limit: "2mb" }) at app.ts:90 — roughly 13,000 marks in one body.
markAttendance processes them SERIALLY inside one transaction (attendance-mark.ts:597-610), each
taking a pg_advisory_xact_lock held until COMMIT. One such request holds one of ten pool connections
and thousands of advisory locks for minutes, and blocks every concurrent device on those sessions.

syncBatchBodySchema correctly caps ops at 200 (sync-batch.ts:64) — so the pattern is established;
the per-op marks array just missed it.

TEST FIRST — apps/api-server/test
  a) "a roster submission above the mark limit is rejected with 422"
     Post 201 marks. Assert 422 ERR_VALIDATION_FAILED, and assert NO attendance rows were written —
     a partial write here would be worse than the rejection.
  b) "a 200-mark submission still succeeds"
     The limit must not break a legitimately large centre-wide session.
  c) The same two against POST /v1/sync/batch with a single op carrying the oversized marks array.

CHANGE
  .max(200) on the marks array in BOTH schemas. A Pathshala batch is 20-40 students; 200 is generous
  and leaves headroom for a merged multi-batch session.

  Error copy per the house rule — state the problem AND the fix:
    "That submission has more than 200 marks. Submit one batch at a time."

  Consider lowering express.json to 512kb for /v1 while leaving 2mb where genuinely needed (check
  the upload and webhook routes before changing it). If you are unsure, leave app.ts alone and say so.

COMMIT: fix: cap attendance mark arrays at 200 per submission
```

---

### PERF #5 — Redis must be required in production

```
PERF #5 — Without Redis, all queue work runs inline in the request path (high)

Files:
  apps/api-server/src/lib/queues.ts   (~lines 23-31, 51-67, 87-94)
  apps/api-server/src/index.ts        (~lines 65-72, the existing fail-fast block)
  .replit                             (~line 1)

PROBLEM
  export async function enqueueJob(name, data = {}, opts?): Promise<void> {
    const q = getQueue(name);
    if (q) { await q.add(...); return; }
    const handler = handlers.get(name);
    if (!handler) { logger.warn(...); return; }
    await handler(data);          // <- runs synchronously in the caller's stack
  }

.replit provisions nodejs-24, python-3.11, postgresql-16 — NO Redis. So on that deploy target the
AT31 5-minute parent-push debounce and the 5-second post-process debounce BOTH collapse to immediate
inline execution inside the HTTP request.

runAttendancePostProcess then loops every already-marked student in the session. On the 5,000th mark
of a session that is a 5,000-iteration x ~5-query loop in ONE request. The cost is quadratic in marks
per session, and it lands on the request the Guruji is waiting on.

The inline fallback is genuinely useful for dev and tests. It is catastrophic in production.

TEST FIRST — apps/api-server/test
  a) "the server refuses to start in production without REDIS_URL"
     Set NODE_ENV=production, unset REDIS_URL, assert the boot check throws with an actionable message.
  b) "the inline fallback still works in test"
     The existing suite depends on it. If any test breaks, that is the signal that the fallback is
     load-bearing for tests — keep it, gate it on NODE_ENV !== 'production'.

CHANGE
  1. Add REDIS_URL to the existing production fail-fast block in index.ts:65-72, alongside the
     JP_AUTH_SECRET and SMS provider checks. Match their message style — those messages explain WHY,
     and yours should too ("...refusing to start without Redis: queue work would run inline in the
     request path, which is quadratic in marks per session").
  2. queues.ts:143 currently logs the fallback at info. Raise it to warn, and include the queue name.
  3. Add REDIS_URL to .env.example with a note that it is required in production.

THEN — report only, do not fix
  .replit provisions no Redis. Tell me what the Replit deploy story is: is that target still live,
  and if so what Redis does it point at? If Replit is the production target, this fix will stop the
  deploy from booting, and I need to know that before it happens rather than after.

COMMIT: fix: require REDIS_URL in production
```

---

# Phase 2 — Database

### Phase 2 orchestration prompt

```
Work through docs/PERFORMANCE_FIX_PROMPTS.md prompts PERF #6 through #9. Order matters: #6 adds
indexes (no downtime, immediately beneficial), #7 rewrites the queries that even good indexes cannot
save, #8 adds retention, #9 removes write-path overhead.

Every index in this phase MUST be CREATE INDEX CONCURRENTLY, which cannot run inside a transaction
block. Drizzle wraps migrations in a transaction. Read the generated SQL before applying and tell me
if it needs splitting — do not just run it and hope.

One commit per fix. Stop after each and print a diff summary.
```

---

### PERF #6 — Six missing indexes

```
PERF #6 — Missing indexes on hot predicates (high)

Files:
  lib/db/src/schema/punya.ts, attendance.ts, notifications.ts, students.ts
  lib/db/migrations/  (generated)

PROBLEM — each of these is a query predicate with no index behind it.

1. punya_transactions.created_at
   Query: routes/v1/admin.ts:260-263, GET /v1/admin/analytics/overview, `created_at >= since`.
   Schema: punya.ts:86-99 — created_at is only ever a TRAILING column, so a global range predicate
   uses none of the existing indexes. Full seq scan of the Punya ledger on every dashboard load.
   Fix: CREATE INDEX CONCURRENTLY idx_punya_transactions_created
          ON punya_transactions (created_at DESC) INCLUDE (student_id, points);

2. sessions.submission_op_id
   Query: services/session-lifecycle.ts:110-119 — the AT16 idempotency check, which runs FIRST on
   every check-in and every offline replay. Schema attendance.ts:76-86 gives it a CHECK but no index,
   so the planner filter-scans every session that Guruji has ever taught.
   Fix: CREATE INDEX CONCURRENTLY idx_sessions_submission_op
          ON sessions (submission_op_id, shikshak_user_id) WHERE submission_op_id IS NOT NULL;

3. sessions WHERE status = 'in_progress'
   Query: services/session-lifecycle.ts:551-575, auto-checkout, every 30 minutes.
   idx_sessions_date_status leads with scheduled_date, so equality on status alone gets nothing.
   Fix: CREATE INDEX CONCURRENTLY idx_sessions_in_progress
          ON sessions (scheduled_date) WHERE status = 'in_progress';
   (Typically <50 live rows — near-zero-cost index scan.)

4. attendance (student_id, session_date DESC)
   Query: routes/v1/students.ts:82-96 orders by sessions.scheduled_date, forcing a fetch of the
   student's ENTIRE history + join + sort for a 40-row page. session_date is ALREADY denormalised
   onto attendance (attendance.ts:104, with a comment saying why) and the route does not use it.
   Fix: add the index AND change orderBy(desc(sessions.scheduled_date)) to
        orderBy(desc(attendance.session_date)). Both halves, or neither helps.

5. notifications (user_id, created_at DESC)
   Query: routes/v1/notifications.ts:81-84. Table grows ~1.6M/yr with zero pruning.
   Fix: add it; then DROP idx_notifications_user, which it subsumes.

6. students birthday predicate
   Query: routes/v1/notifications.ts:165 uses to_char(dob, 'MM-DD') = $1.
   to_char(date,text) is STABLE, not IMMUTABLE, so it CANNOT be wrapped in an expression index as
   written. Rewrite the predicate to EXTRACT, then:
     CREATE INDEX CONCURRENTLY idx_students_birthday
       ON students ((EXTRACT(MONTH FROM dob)), (EXTRACT(DAY FROM dob)))
       WHERE status = 'active' AND deleted_at IS NULL;
   Verify the rewritten predicate returns the same rows — write a test asserting a known birthday
   student is found before and after.

BEFORE / AFTER — required for each
  Run EXPLAIN (ANALYZE, BUFFERS) on the driving query before and after. Paste both. If the plan does
  not change, the index is wrong and you should say so rather than keeping it — an unused index is
  pure write-path cost.

MIGRATION
  CREATE INDEX CONCURRENTLY cannot run inside a transaction and Drizzle wraps migrations. Generate,
  READ the SQL, and if it needs splitting into a non-transactional migration, say so and show me the
  file before applying.

COMMIT: perf: add indexes for admin analytics, check-in idempotency and attendance history
```

---

### PERF #7 — Admin list routes aggregate before LIMIT

```
PERF #7 — GROUP BY the whole table, then LIMIT 50 (high)

Files:
  apps/api-server/src/routes/v1/admin-resources.ts  (~lines 648-668, 670-695)
  apps/api-server/src/routes/v1/sessions.ts         (~lines 120-159)
  apps/api-server/src/routes/v1/homework.ts         (~lines 740-802 — the CORRECT pattern, read first)

PROBLEM
  .leftJoin(attendance, eq(attendance.session_id, sessions.id))
  .where(and(isNull(batches.deleted_at), isNull(centres.deleted_at), centreFilter))
  .groupBy(sessions.id, batches.name, centres.name)
  .orderBy(desc(sessions.scheduled_date))
  .limit(limit);

GROUP BY ... ORDER BY ... LIMIT 50 means Postgres joins and aggregates EVERY session x its attendance
rows in scope, sorts the whole result, then discards all but 50. There is no date bound. For a
super_admin on /admin/sessions that is the full sessions x attendance product — 1.5M rows aggregated
to return 50.

GET /v1/sessions/today is the same shape PLUS a separate N+1: sessions.ts:155-159 calls
loadSessionRoster once per row, with no .limit() on rows. A city_admin with 50 centres gets 201
queries and 6,000 nested objects in the response.

THE FIX ALREADY EXISTS IN THIS CODEBASE. homework.ts:778-802 does it right, with a comment:
  "Counts only for the limited page (LATERAL), not a national GROUP BY then LIMIT."
Read that block before writing anything. Copy its shape.

TEST FIRST — apps/api-server/test
  a) "the centre attendance log returns correct counts for the page"
     Seed 3 sessions with known present/absent/late/excused mixes. Assert the returned counts match.
     This test must pass identically before and after — it is the safety net for the rewrite.
  b) "query count does not scale with total session count"
     Use a db spy. Seed 10 sessions, record the count; seed 100, record again. Assert the counts are
     equal. Pick the threshold from the LATERAL design, not from what the code currently does.
  c) "GET /v1/sessions/today issues a bounded number of queries"
     Same spy approach with 5 vs 50 sessions.

CHANGE
  1. admin-resources.ts both routes: page the driving table (sessions) first with the keyset cursor,
     then LEFT JOIN LATERAL for the per-page counts. Add a default date bound —
     scheduled_date >= current_date - interval '180 days' unless the caller passes an explicit range.
     Say so in the response meta so the client can tell the list is windowed.
  2. sessions.ts /today: collapse loadSessionRoster into ONE query over all returned sessions
     (students LEFT JOIN attendance LEFT JOIN absence_notifications WHERE batch_id = ANY($1)),
     grouped in JS by (batch_id, session_id). Add a .limit(). For non-shikshak callers, either
     require centre_id/batch_id or drop `roster` from the list response entirely and let the client
     fetch per session — decide, and explain which you chose and why.

  Preserve the AT5-style COUNT(*) FILTER arithmetic exactly. Do not switch to COUNT(expr IN (...)) —
  in Postgres COUNT(boolean) counts every non-null row and returns 1.0 for everyone. CLAUDE.md AT5
  calls this out specifically.

COMMIT: perf: page-then-aggregate admin session lists via LATERAL
```

---

### PERF #8 — Retention and partitioning

```
PERF #8 — No table is ever pruned or partitioned (high)

Files:
  lib/db/src/schema/  (sync_operations, notifications, punya_transactions, audit_logs)
  apps/api-server/src/jobs/derived-data-jobs.ts  (~lines 148-154 — the only existing prune job)

PROBLEM
  rg "delete from" apps/api-server/src
returns three hits: the device_sessions cleanup and two session re-materialisation deletes. No
PARTITION BY appears in any migration. Growth at 30k students:

  notifications        1.6M/yr   (one per parent per mark, plus fanout)
  punya_transactions   1.6M/yr   (award + reversal + streak)
  sync_operations      ~400MB/yr (request AND response JSONB per offline submission)
  audit_logs           100k/yr

TEST FIRST — apps/api-server/test
  a) "the retention job prunes sync_operations older than the window and nothing newer"
     Seed rows at 29 and 31 days old. Assert exactly one is deleted.
  b) "the retention job never deletes an unapplied or failed operation"
     A row still needed for replay must survive regardless of age. Decide the rule and encode it.
  c) "notification retention keeps unread rows regardless of age"
     An unread notification from 6 months ago is still the user's. Pruning it is data loss.

CHANGE — part 1, retention (do this commit)
  1. sync_operations: prune applied_at < now() - interval '30 days'. CLAUDE.md §7 caps retry at 10
     attempts with a 5-minute backoff, so replay value expires in hours, not months. This needs
     CREATE INDEX CONCURRENTLY idx_sync_operations_applied ON sync_operations (applied_at) first —
     there is currently no index on any timestamp column of that table.
  2. notifications: prune read_at IS NOT NULL AND created_at < now() - interval '90 days'.
  3. Add both to the existing auth.session.cleanup cron rather than creating new ones. Delete in
     bounded batches (LIMIT 5000 in a loop) so a first run on a large table does not hold a long lock.

CHANGE — part 2, partitioning (SEPARATE commit, and STOP and show me the plan first)
  punya_transactions and audit_logs should be PARTITION BY RANGE (created_at), monthly.
  Do NOT execute this without showing me the migration first. Converting a 1.6M-row table to
  partitioned requires a full rewrite under lock, and punya_transactions is a financial-style ledger
  where a botched migration is unrecoverable. Write the plan, show me, wait.

  Note punya_transactions must NOT be pruned — it is the ledger of record. Partition only.

COMMIT (part 1): perf: add retention to sync_operations and read notifications
```

---

### PERF #9 — Drop redundant indexes on the hot write tables

```
PERF #9 — Redundant indexes cost write throughput on the SLO path (medium)

File: lib/db/src/schema/*.ts

PROBLEM
Each of these is fully subsumed by a wider index on the same table, so it is pure B-tree maintenance
on every insert. The first two are on the two hottest write tables in the system — 5,000 inserts in
60 seconds during the load test.

  idx_attendance_session          subsumed by attendance_session_student_unique (session_id, student_id)
  idx_punya_transactions_student  subsumed by idx_punya_transactions_student_created
  idx_sessions_batch              subsumed by sessions_batch_id_scheduled_date_unique
  idx_notifications_user          subsumed by idx_notifications_user_read (and by PERF #6's new index)
  idx_absence_notifications_student  subsumed by absence_notifications_student_range_unique
  idx_homework_submissions_assignment  subsumed by homework_submissions_assignment_student_unique
  idx_exam_answers_attempt        subsumed by exam_answers_attempt_question_unique

Also likely dead:
  idx_gallery_items_public — a boolean index, 2 distinct values, never selective.
  idx_batches_shikshak (migrations/0001_indexes.sql:8) — indexes batches.shikshak_id, a column the
    Drizzle schema no longer declares. Orphan column AND orphan index, still being maintained.
  idx_attendance_student_absent_by_date — added by 0009 explicitly to order by session_date without
    joining sessions, but the AT27 job it was built for (services/consecutive-absence.ts:65-79)
    queries student_id + session_id IN (...) and never touches session_date.

VERIFY BEFORE DROPPING — do not take my word for it
  For each candidate, run against a populated database:
    SELECT indexrelname, idx_scan, idx_tup_read
      FROM pg_stat_user_indexes WHERE relname = '<table>';
  Paste the output. An index with idx_scan > 0 is in use by SOMETHING and needs investigating before
  it goes. If you have no populated environment to check against, say so — then drop only the ones
  provably subsumed by column-prefix analysis and leave the "likely dead" three alone.

CHANGE
  Remove the confirmed-redundant index definitions from the schema files. Generate the migration.
  Use DROP INDEX CONCURRENTLY.

  Separately investigate idx_batches_shikshak: if batches.shikshak_id is genuinely an orphan column,
  that is a schema-drift finding of its own. Report it; do not drop the COLUMN in this commit.

COMMIT: perf: drop redundant indexes on attendance and punya_transactions
```

---

# Phase 3 — API throughput

### Phase 3 orchestration prompt

```
Work through docs/PERFORMANCE_FIX_PROMPTS.md prompts PERF #10 through #14.

#10 is the big one and the riskiest in this entire pack — it touches the AT20 guarded-insert path.
Do it FIRST while you are freshest, alone, in its own commit, and do not batch it with anything.
If the AT20 invariant tests do not exist, WRITE THEM BEFORE TOUCHING THE CODE. Optimising an
unguarded ledger write is how you get silent double-awards that nobody notices for months.

#11-#14 are mechanical by comparison.

Re-run the load test after #10 and again after #14. Paste both.
```

---

### PERF #10 — The attendance mark loop

```
PERF #10 — 223 round trips per 30-student roster (critical)

File: apps/api-server/src/services/attendance-mark.ts  (~lines 377-512, 597-610)

READ CLAUDE.md AT17, AT18, AT20, AT21 AND AT26 BEFORE YOU WRITE ANYTHING. This prompt touches the
Punya ledger. AT20 in particular: "Punya balances are NEVER incremented unconditionally alongside a
guarded insert. The insert uses ON CONFLICT DO NOTHING ... RETURNING, and the balance moves only by
the amount actually returned." The current code gets this exactly right at :226-231. Your batched
version must too.

PROBLEM
  const results: MarkItemResult[] = [];
  for (const mark of input.marks) {
    results.push(await applyOneMark(tx, { sessionId: session.id, ... mark }));
  }

applyOneMark issues SEVEN statements per student for a fresh 'present':
  advisory lock (:402) / SELECT FOR UPDATE (:407) / attendance upsert (:436) /
  punya award insert (:246) / balance upsert (punya.ts:85) / tier UPDATE (punya.ts:95) /
  absence_notifications UPDATE (:494)

One 30-student roster = ~223 round trips, 210 inside an open transaction holding an advisory lock.
A correction pass costs 11/student = 330. At the SLO: 167 rosters x 223 = ~37,000 statements, each
transaction holding a connection ~420ms, giving a ~24 txn/s ceiling against a pool of 20.

BEFORE — required
  a) Instrument with a db spy and record the exact statement count for a 30-student roster, fresh
     and correction. Paste both numbers.
  b) Run the load test. Paste p95 and success rate.

TESTS FIRST — these are the safety net, not a formality
  a) "a resubmitted roster awards Punya exactly once"
     Submit the same roster twice with the same submission_op_id. Assert punya_transactions row count
     and the balance are identical after both. THIS IS THE TEST THAT CATCHES A BROKEN AT20 BATCH.
  b) "a resubmitted roster with a DIFFERENT submission_op_id still awards exactly once"
     The UNIQUE (session_id, student_id) domain constraint must hold independently of the transport
     idempotency key. CLAUDE.md §3 is explicit about this being the true anchor.
  c) "present -> absent -> present produces a reverse/award/reverse/award chain, not bare awards"
     Assert the reversal_of chain per AT18, and that the balance nets correctly.
  d) "a partially-failing roster does not half-apply"
     One invalid student_id among 30. Assert the transaction semantics you intend, and that the
     result array still reports per-item outcomes.
  e) "absence_notifications are consumed exactly once per covered session"
     AT4 — marking a covered session sets resolved_at. After batching, assert no notification is
     double-consumed and none is missed.
  Run all five against the CURRENT code first. Paste them passing. If any fails today, STOP — you
  have found a live bug and I want to know before you optimise around it.

CHANGE — five steps, in this order, measuring after each
  1. Hoist the absence_notifications UPDATE (:494) out of the loop. It is student-independent within
     a session date: one UPDATE ... WHERE student_id = ANY($1) AND start_date <= d AND end_date >= d
     after the loop.                                                              [-30 statements]
  2. Take ONE advisory lock on session_id instead of one per (session, student). The FOR UPDATE plus
     UNIQUE (session_id, student_id) already give row-level safety; the per-student lock is belt on
     top of braces and it serialises the batch against itself.                    [-30]
  3. Collapse the prior-state read into the upsert's RETURNING via a CTE
     (WITH prior AS (...), up AS (INSERT ... ON CONFLICT DO UPDATE ... RETURNING ...) SELECT ...).
     The prior status is needed for the AT18 reverse-then-award decision — do not lose it.  [-30]
  4. Merge creditBalance's upsert + tier UPDATE (punya.ts:85,95) into one statement. The tier can be
     computed in the same RETURNING. Tier thresholds come from configuration per AT23 — do not
     inline them as constants while you are in there.                             [-30]
  5. Batch the award inserts: ONE
       INSERT INTO punya_transactions (...) SELECT * FROM unnest($1::uuid[], $2::int[], ...)
       ON CONFLICT DO NOTHING RETURNING student_id, points
     then ONE grouped balance upsert driven by the RETURNED rows only.            [-60]
     STEP 5 IS THE DANGEROUS ONE. The balance must move by SUM of returned points per student, not
     by the sum of attempted points. Re-run test (a) after this step specifically and paste it.

  Target: 223 -> ~25 statements per roster.

AFTER
  Re-run the spy count and the load test. Paste both. Report the delta.

If at any point a step forces you to weaken an AT rule, STOP and tell me which rule and why. A 9x
speedup is not worth a corrupt ledger.

COMMIT: perf: batch attendance mark statements per roster
```

---

### PERF #11 — GET /v1/sessions/today and the homework bulk grade

```
PERF #11 — Two request-scoped N+1s with external calls in the loop (high)

Files:
  apps/api-server/src/routes/v1/sessions.ts   (~lines 155-159)   [also covered by PERF #7 — skip if done]
  apps/api-server/src/routes/v1/homework.ts   (~lines 948-1085)
  apps/api-server/src/lib/homework-notify.ts  (~lines 51-95)

PROBLEM — homework bulk grade
  for (const sub of candidates) {
    const outcome = await db.transaction(async (tx) => claimAndAwardFirstHomeworkGrade({...}));  // :1032
    await auditFromReq(req, { ... });                                                            // :1063
    await notifyParentHomeworkGraded({ studentId: sub.student_id, ... });                        // :1070
  }

`candidates` (:948-956) is UNBOUNDED — every submission on the assignment.
notifyParentHomeworkGraded = 2 queries + notifyUsers (3 queries) + sendPush, which is a LIVE HTTPS
CALL TO EXPO.

For a 40-student batch: 40 transactions (~320 statements) + 40 audit inserts + 200 notify queries
+ FORTY SERIALIZED EXPO HTTP CALLS. At 250ms each that is 10 seconds of the request blocked on an
external API, holding a pool connection and a worker.

Note homework-notify.ts's own header says "one notification per parent per assignment" — the loop
contradicts the file's stated design.

TEST FIRST
  a) "bulk grading 40 submissions sends one notification per parent, not one per submission"
  b) "bulk grading issues a bounded number of queries" (db spy, 10 vs 40 submissions)
  c) "bulk grading does not await the push transport" — stub Expo with a 500ms delay, assert the
     request returns in well under 40x that.
  d) "a failed push does not roll back a grade" — the grade is durable, the push is best-effort.

CHANGE
  1. One transaction for the whole bulk, not one per submission.
  2. One batched audit write, not N.
  3. Hoist notification out of the loop: collect studentIds, issue ONE notifyUsers per assignment.
  4. Enqueue the push via BullMQ instead of awaiting Expo inline. If PERF #5 has landed, Redis is
     guaranteed in production, so the queue is safe to depend on.
  5. Add a cap to `candidates` or page it — an unbounded set is still unbounded after batching.

  If PERF #7 has not landed yet, also do the sessions.ts:155-159 roster collapse described there.

COMMIT: perf: batch homework bulk-grade transactions, audits and notifications
```

---

### PERF #12 — id-cards/generate-all must be a queued job

```
PERF #12 — An HTTP request that cannot complete (high)

File: apps/api-server/src/routes/v1/id-cards.ts  (~lines 31-100)

PROBLEM
  const studentRows = await db.select({...}).from(students)
    .where(and(isNull(students.deleted_at), eq(students.status, "active"), centreFilter));
  // no .limit()
  for (const student of studentRows) {
    const [existing] = await db.select({...})... .limit(1);
    await upsertIdCardArt({ ... });
  }

For super_admin, centreFilter is undefined (:36-40) — this is EVERY ACTIVE STUDENT ON THE PLATFORM.
Per iteration: ~4 queries + a bwip-js barcode raster (pure JS, MAIN THREAD, blocks the event loop
for every concurrent request) + two sharp operations + an S3 GET + an S3 PUT + an S3 DELETE.

At 20,000 students this is ~80,000 queries and 20,000 image renders in one HTTP request. Node's
default 300s requestTimeout kills the socket long before the loop ends — and the work continues
headless with no way to observe or cancel it.

TEST FIRST
  a) "generate-all returns 202 immediately and enqueues one job per chunk"
     Assert the response is fast (well under a second) and the queue received the expected job count.
  b) "generate-all does not render any image in the request path"
     Spy on the render function; assert zero calls during the request.
  c) "a job failure does not lose the remaining students"
     Chunked jobs must be independently retryable.

CHANGE
  1. Return 202 { job_count, batch_id } and enqueue chunks of ~50 students to a new
     idcard.generation queue. That queue name is already in CLAUDE.md's list but has no handler —
     add one in src/jobs/, following the shape of the existing registrations.
  2. Batch the `existing` check into one inArray lookup regardless of chunking.
  3. Add a way for the caller to poll progress. Look at how other long-running admin operations in
     this codebase report status before inventing something new — if there is no precedent, the
     simplest honest answer is a row count query, and say so.

RELATED — do NOT fix here, report only
  lib/barcode.ts:23 (bwip-js), lib/pdf.ts:116 (pdf-lib .save), lib/qr.ts:11 (qrcode) are all pure-JS
  main-thread work. Once the worker process exists (PERF #15) they should all move there. List every
  route that currently triggers one of them synchronously.

COMMIT: perf: move bulk ID-card generation to a queued job
```

---

### PERF #13 — Per-request caching and parallelism

```
PERF #13 — Uncached hot config and 4 Promise.all calls in 29,000 LOC (high)

Files:
  apps/api-server/src/lib/attendance-points.ts  (~lines 74, 135)
  apps/api-server/src/lib/scope.ts              (~lines 31-100)
  apps/api-server/src/middlewares/auth.ts       (~line 36)
  apps/api-server/src/routes/v1/admin.ts        (~lines 218-283)
  apps/api-server/src/routes/v1/me.ts           (~lines 345-397)

PROBLEM 1 — AT21 caching is half-implemented
attendance-points.ts caches resolved points in Redis keyed on city_id (:83) — but getting there costs
TWO uncached DB queries on EVERY mark, even on a 100% cache hit:
  :135  batch  -> centre_id
  :74   centre -> city_id
The cache is behind the lookups it was supposed to eliminate. lib/homework-points.ts is identical.
Fix: cache the batch_id -> city_id mapping (immutable in practice) and key the points cache on
batch_id directly. Raise the TTL from 60s to ~5 minutes with explicit invalidation on punya_configs
write. Keep the existing "do not cache a zero miss" rule at :126-127 — that is deliberate and correct.

PROBLEM 2 — resolveAdminScope is never cached and is called 2-3x per request
scope.ts:31-100 costs 1-2 queries and runs on every admin/shikshak request. students.ts:32-53 calls
it via studentAccess AND again in the route. services/sync-batch.ts re-resolves it for EVERY OP in
the batch — a 5-op sync costs 10 redundant queries.
Fix: memoize on the request object (req.adminScope ??= await resolveAdminScope(user)) and pass the
resolved scope down rather than re-deriving it. For sync-batch, resolve once per batch.

PROBLEM 3 — auth middleware does SELECT * on every request
  const [user] = await db.select().from(users).where(eq(users.id, verified.uid)).limit(1);
Full row including the notification_preferences JSONB, on 100% of traffic. The JWT already carries
uid; the DB read only adds an is_active/deleted_at freshness check.
Fix: project only the columns actually used, and cache in Redis for 30-60s keyed on uid. Invalidate
on the deactivate and role-change paths — both already write audit rows, so the hook has an obvious
home. SELECT * on users is also a PII-surface concern given the logger redact gaps.

PROBLEM 4 — almost nothing runs in parallel
There are exactly four Promise.all calls in the entire server. admin.ts:218-283 runs SEVEN fully
independent queries in series (~280ms where ~60ms would do). me.ts:345-397 runs three independent
inArray lookups in series. attendance-mark.ts:545-571 runs three independent resolutions in series
on the hottest path.
Fix: Promise.all each group. Be careful in attendance-mark that none of the three actually depends
on another — read them before assuming.

TEST FIRST for each
  Use a db spy and assert query COUNT for a representative request, before and after. That is the
  measurement and the regression test in one.

CHANGE
  Do the four problems as four separate commits — they have different risk profiles and problem 3
  touches auth.

COMMIT (each): perf: cache batch->city punya lookup
                perf: memoize admin scope resolution per request
                perf: project and cache the auth user lookup
                perf: parallelize independent dashboard queries
```

---

### PERF #14 — Set-based rewrite of the two worst cron jobs

```
PERF #14 — 60,000 queries per nightly run (high)

Files:
  apps/api-server/src/services/consecutive-absence.ts       (~lines 25-126)
  apps/api-server/src/services/attendance-post-process.ts   (~lines 103-193, 213-220)

PROBLEM 1 — runConsecutiveAbsenceCheck
  const active = await db.select({...}).from(students)
    .where(and(eq(students.status, "active"), isNull(students.deleted_at)));  // no limit — national
  for (const stu of active) {
    const holidayRows = await db...centre_holidays...;   // :41
    const sessionRows = await db...sessions...limit(30); // :48
    const marks = await db...attendance...;              // :65
Three queries times EVERY ACTIVE STUDENT NATIONALLY. At 20,000 students that is 60,000 queries at
02:00 IST, through the same pool as live traffic.

PROBLEM 2 — runAttendancePostProcess
  for (const row of marked) {
    await recomputeAndAwardStreak(row.student_id);
    await enqueueParentAttendanceNotify(row.student_id, sessionId);
  }
recomputeAndAwardStreak re-reads the student's ENTIRE attendance history on that batch, unbounded
(:124-135). Per 30-student session: ~120 statements, ~30 full-history scans, and 120 Redis round
trips (enqueueDebouncedJob does getJob -> getState -> remove -> add).

READ CLAUDE.md AT22 AND AT27 BEFORE CHANGING EITHER. The arithmetic is exact.

TEST FIRST
  a) Streak correctness must be preserved exactly. If streak tests do not already exist, WRITE THEM
     FIRST — present/late count, excused skips without breaking, absent resets, holidays and
     cancelled sessions skipped, bonus every 4 repeating, idempotency key includes the triggering
     session_id. Run them against the current code. Paste them passing.
  b) AT27 correctness: alerts fire only on three 'absent' rows; 'excused' never counts.
  c) Query-count spy for both jobs at 10 vs 100 students. Assert sub-linear.

CHANGE — consecutive-absence
  One set-based query. centre_holidays is a few hundred rows total — load once into a Map. The
  "last 3 eligible sessions all absent" test is a single CTE:
    ROW_NUMBER() OVER (PARTITION BY student_id ORDER BY scheduled_date DESC) ... WHERE rn <= 3
    ... HAVING bool_and(status = 'absent')
  Then fan out notifications in chunks.

CHANGE — attendance-post-process
  1. Bound the history read. A streak of 4 never needs 200 rows — the last ~60 eligible sessions is
     ample. State the bound you pick and why it is safe given AT22.
  2. Recompute all students in the session in ONE grouped window-function query.
  3. Batch the students UPDATE — one statement over unnest, not N.
  4. Keep the enqueue PER STUDENT: the debounce jobId is deliberately (student, session) and
     collapsing it breaks AT31's 5-minute settle window. Use addBulk if it preserves distinct
     jobIds; otherwise leave the loop and say so.
  5. Punya awards stay one guarded call per milestone. AT20 again — do not batch them into an
     unguarded write.

COMMIT: perf: set-based rewrite of consecutive-absence and attendance post-process
```

---

# Phase 4 — Runtime and infrastructure

### Phase 4 orchestration prompt

```
Work through docs/PERFORMANCE_FIX_PROMPTS.md prompts PERF #15 through #19.

#15 (worker process split) is architectural and everything else in this phase reads better after it,
so do it first. #16-#19 are independent of each other and can be done in any order.

One commit per fix. Stop after each and print a diff summary.
```

---

### PERF #15 — Split the worker process

```
PERF #15 — HTTP, workers and crons all run in one process (high)

Files:
  apps/api-server/src/index.ts       (~lines 14-17, 58)
  apps/api-server/src/lib/queues.ts  (~lines 140-165)
  apps/api-server/src/lib/scheduler.ts (~lines 28-45)
  docker-compose.yml
  apps/api-server/package.json

PROBLEM
index.ts:14-17 registers all job handlers and calls startQueueWorkers() before the listener; :58
calls startScheduler() inside the listen callback. docker-compose.yml defines one service. There is
no dev:worker script, no port 3100, no WORKER_MODE branch.

CLAUDE.md documents an API-3000 / worker-3100 split. It does not exist.

Consequence: CPU-bound pure-JS work runs in the request-serving process and blocks the event loop
for every concurrent request:
  lib/barcode.ts:23   bwip-js raster       (async in signature only — it is synchronous CPU)
  lib/pdf.ts:116      pdf-lib .save()      (deflate)
  lib/qr.ts:11        qrcode PNG encode    (Reed-Solomon)
  lib/idcard-render.ts:62  base64 of a resized photo
Plus three sharp paths and argon2 all contending for the SAME 4-slot libuv threadpool —
UV_THREADPOOL_SIZE is never set anywhere. During an OTP burst, argon2 starves image processing.

TEST FIRST
  a) "the worker entry starts no HTTP listener"
  b) "the API entry registers no cron when PROCESS_ROLE is not worker"
  c) The existing suite must pass unchanged — it currently relies on in-process handlers via the
     inline fallback. Make sure your gating does not break it.

CHANGE
  1. Add apps/api-server/src/worker.ts: registerFooJobs(); startQueueWorkers(); startScheduler();
     and NOTHING else — no app.listen, no route imports.
  2. Gate index.ts:14-17 and :58 behind a role check, defaulting to API-only. Keep a
     RUN_WORKERS_INLINE=1 escape hatch for single-container dev, and document it in .env.example.
  3. Add a `worker` service to docker-compose.yml on the same image with a worker command.
  4. Add a dev:worker script to package.json.
  5. In the worker entry set UV_THREADPOOL_SIZE=8 and sharp.concurrency(1).
  6. Give the worker its own pg pool (smaller max, higher statement_timeout) per PERF #3's caution.

  shutdownQueues() exists at queues.ts:180-189 and is NEVER CALLED from shutdown(). Wire it in
  before pool.end() so in-flight jobs drain on SIGTERM instead of being killed.

THEN — same commit
  With a worker process existing, the scheduler no longer runs on every HTTP instance. That closes
  the cron-overlap problem in PERF #17. Note in your report which of PERF #17's findings this
  subsumes so we do not do the work twice.

COMMIT: perf: split BullMQ workers and crons into a separate process
```

---

### PERF #16 — Queue configuration

```
PERF #16 — Cron jobs never retry; failed jobs never expire (high)

File: apps/api-server/src/lib/queues.ts  (~lines 44-48, 108-119, 149-155)

PROBLEM 1 — no retries
  const DEFAULT_JOB_OPTS: JobsOptions = {
    removeOnComplete: 100,
    removeOnFail: 50,
  };
No `attempts`, so BullMQ defaults to 1. Every cron-enqueued job — session.materialise,
attendance.no_show_check, attendance.auto_checkout, attendance.consecutive_check,
punya.leaderboard.refresh, punya.reconcile, analytics.refresh_views, exam.top_score — gets one shot.

A five-second DB blip at 01:00 IST means NO SESSIONS MATERIALISED FOR THE NIGHT. Next attempt is 24h
later, by which point the rolling 60-day window has a hole and Gurujis hit the AT8 soft-create path
en masse the next morning.

enqueueDebouncedJob already sets attempts: 3 with exponential backoff (:111-112) — so the correct
value is established and the defaults just did not follow it.

PROBLEM 2 — removeOnFail: false on the highest-volume queues
  removeOnComplete: true,
  removeOnFail: false,   // "Keep failed jobs for inspection (do not auto-prune)"
This applies to attendance.post_process and notifications.parent. enqueueParentAttendanceNotify
fires once per marked student. Any sustained downstream problem parks every job in the failed set
permanently, each with a full jsonb payload, with no reaper. Redis grows monotonically. If
maxmemory-policy is allkeys-lru, eviction silently drops LIVE BullMQ keys and corrupts queue state.

PROBLEM 3 — 30-second lockDuration on jobs that run for minutes
Workers set no lockDuration (:154). analytics.refresh_views does six sequential concurrent MV
refreshes; consecutive_check loops the student population. BullMQ renews the lock on a timer living
on the SAME EVENT LOOP as the HTTP server — any main-thread block longer than the renew interval
lets the lock lapse, the job is marked stalled, and it RE-EXECUTES. For consecutive_check that means
duplicate absence pushes to parent, Sanchalak and city_admin.

TEST FIRST
  a) "a transient handler failure is retried"
  b) "failed jobs are pruned by age"
  c) "consecutive_check is idempotent within a day" — this one matters most; a re-executed job must
     not double-notify. If it is not idempotent today, that is the real finding.

CHANGE
  1. DEFAULT_JOB_OPTS: attempts: 3, backoff exponential 30s.
  2. removeOnFail: { age: 7 * 24 * 3600, count: 5_000 } on the debounced path.
  3. lockDuration: 300_000, stalledInterval: 60_000, maxStalledCount: 2 for the long-running queues.
     Do not apply the long lock globally — a genuinely stuck short job should still be reclaimed.
  4. Make consecutive_check idempotent: upsert a per-(student, window) alert row and skip if present.
  5. Give cron-enqueued jobs a deterministic jobId (e.g. `consecutive:${todayIst()}`) so BullMQ
     dedupes across instances even if the scheduler is somehow running in two places.

  Also: notifications.birthday is in CLAUDE.md's frozen cron table but is registered inside
  routes/v1/notifications.ts:272 rather than src/jobs/. It works, but the cron table and the job
  directory disagree. Move it to src/jobs/ with the others, or tell me why it should stay.

COMMIT: fix: retry cron-enqueued jobs and bound failed-job retention
```

---

### PERF #17 — Socket.IO

```
PERF #17 — No Redis adapter, no auth, CORS reflects any origin (high)

File: apps/api-server/src/lib/admin-dashboard-feed.ts  (~lines 12, 19-26, 34-60)

PROBLEM
  io = new Server(httpServer, { path: "/socket.io", cors: { origin: true, credentials: true } });
  io.of("/admin-dashboard").on("connection", (socket) => {
    const cityId = String(socket.handshake.query["cityId"] ?? "");
    if (cityId) socket.join(`city:${cityId}`);
  });

Verify: @socket.io/redis-adapter is not in package.json and createAdapter appears nowhere.

Three defects:
1. No Redis adapter. With two instances, a mark on instance A never reaches an admin on instance B.
   The AT31 aggregate feed is silently WRONG the moment you scale past one container — not broken,
   wrong, which is worse.
2. No JWT verification. Any anonymous client can pass ?cityId=<uuid> and stream live attendance for
   any city. CLAUDE.md mandates auth: { token } verified before namespace join.
3. cors: { origin: true, credentials: true } reflects ANY origin with credentials, bypassing the
   CORS_ORIGINS allow-list that the Express layer correctly enforces at app.ts:66-68.

Also: the aggregate buckets (:12, :34-60) are per-process in memory, so even with the adapter the
counts would be per-instance fractions of the city total.

TEST FIRST
  a) "a connection without a valid token is rejected"
  b) "a city_admin cannot join a city they do not administer"
  c) "an origin outside CORS_ORIGINS is rejected"
  d) "the aggregate count is correct across two server instances" — if you cannot test two instances
     in the suite, at least assert the counter reads through Redis rather than a local variable.

CHANGE
  1. Add @socket.io/redis-adapter; io.adapter(createAdapter(pub, sub)) using duplicated connections
     from the shared Redis client.
  2. io.of("/admin-dashboard").use(...) verifying the JWT and asserting city scope — reuse the same
     verification the HTTP auth middleware uses, do not write a second implementation.
  3. Mirror the Express allowedOrigins into the Socket.IO CORS config. One source of truth.
  4. Move the aggregate counter to a Redis INCR on a 10-second-bucketed key so the AT31 window is
     cluster-wide.

  Keep the unref'd timer and the 10-second windowing — that design is correct per AT31, only the
  wiring is missing.

COMMIT: fix: authenticate Socket.IO and make the admin feed cluster-safe
```

---

### PERF #18 — HTTP layer and media

```
PERF #18 — No compression, no caching, no keepAlive timeout, every media byte proxied (medium)

Files:
  apps/api-server/src/app.ts          (~lines 42-142)
  apps/api-server/src/index.ts        (~line 54)
  apps/api-server/src/lib/storage.ts  (~lines 179-214)
  apps/api-server/src/routes/v1/uploads.ts (~lines 148-163)

PROBLEM 1 — no compression
`compression` is not in package.json and not in app.ts. GET /v1/public/centres returns every active
centre nationwide, ungzipped. On 3G that is ~400KB instead of ~40KB on the marketing site's first paint.

PROBLEM 2 — no caching headers
No Cache-Control or ETag on any /v1/public/* route. express.static for the admin SPA (app.ts:142)
uses the default maxAge: 0, so Vite's CONTENT-HASHED assets are revalidated on every load — the one
case where a long immutable cache is unambiguously safe.

PROBLEM 3 — keepAliveTimeout
No server.keepAliveTimeout is set anywhere, so Node's 5s default applies. docker-compose.yml:6
documents an nginx proxy in front, and nginx's upstream keepalive default is 60s. This is the classic
race that produces intermittent 502 Bad Gateway under load. It will be blamed on the application.

PROBLEM 4 — every media byte is proxied through Node
storage.ts:184-191 has presignedUrl() and NOTHING CALLS IT. url() (:179-181) always routes bytes
through the Node process. Worse, getStream (:196-214) builds a Readable with a no-op _read and
discards push()'s return value, so S3 bodies drain as fast as S3 delivers regardless of whether the
client is consuming. A parent on 3G downloading a 20MB video buffers the whole object in heap.

PROBLEM 5 — the streaming upload path collapses for images
uploads.ts:148-163 streams non-images to storage but calls stripImageMetadata for images, which
returns .toBuffer() — the whole image in heap. At a 50MB limit and 20 concurrent uploads that is up
to 1GB resident, before sharp's own libvips buffers.

CHANGE — one commit each, they are independent
  1. app.use(compression()) right after the logger.
  2. Cache-Control: public, max-age=60, stale-while-revalidate=300 on /v1/public/*.
     express.static(ADMIN_WEB_DIR, { maxAge: "1y", immutable: true, index: false }) with index.html
     served no-cache. Get this pair right or the SPA will serve a stale shell forever.
  3. server.keepAliveTimeout = 65_000; headersTimeout = 70_000; requestTimeout = 30_000 in index.ts.
     Check requestTimeout against the slowest legitimate request before setting it — uploads may
     need a carve-out.
  4. Use presignedUrl() for private media instead of proxying. This is the single largest bandwidth
     and event-loop saving in the deployment. Verify the signature TTL and that access control still
     holds — a presigned URL is a bearer token, so the TTL must be short and the check must happen
     before minting.
  5. sharp(tempPath).rotate().jpeg({...}).toFile(...) then hand the PATH to storage.put. Also drop
     mozjpeg: true (image-normalise.ts:65) from the request path — it is 3-5x slower than baseline —
     or make it worker-only.

  Also add cors maxAge: 86400 (app.ts:63-70) so browsers stop re-preflighting every POST.

COMMIT (each): perf: enable response compression
                perf: cache-control on public routes and hashed assets
                fix: align keepAliveTimeout with the reverse proxy
                perf: serve private media via presigned URLs
                perf: stream image normalisation to disk instead of heap
```

---

### PERF #19 — Observability

```
PERF #19 — There is none (high)

Files:
  apps/api-server/src/app.ts        (~lines 47-60, the pino-http serializers)
  apps/api-server/src/lib/logger.ts (~lines 5-25)
  apps/api-server/src/routes/health.ts

PROBLEM
  rg "metrics|prom-client|/metrics|performance.now|duration_ms" apps/api-server/src
returns nothing. No metrics endpoint, no request-duration histogram, no slow-query logging, no queue
depth, no pool gauges. The pino-http serializers at app.ts:47-60 strip everything except id, method,
url and statusCode — responseTime is DISCARDED.

When the load test misses p95 there will be no data to say whether it was the pool, Redis, the event
loop or Postgres. This is the finding that makes every other finding harder to close, which is why
it belongs in this phase rather than a nice-to-have list.

Separately, logger.ts:5-25 redacts authorization, cookie, set-cookie and phone — but NOT email, pan,
aadhaar, password, otp or token, all of which CLAUDE.md's security rules require. lib/notify.ts:89
logs { err }, and a pg error object carries the failing statement's parameters.

CHANGE
  1. Add prom-client. Expose /metrics on an INTERNAL-ONLY path (not through the public router —
     check how health.ts is mounted and match, or bind it to a separate port).
     Metrics: default process metrics, http_request_duration_seconds histogram by route+status,
     pg pool gauges (totalCount / idleCount / waitingCount — currently never read), BullMQ queue
     depth and failed-count gauges.
  2. Restore responseTime to the pino-http res serializer.
  3. Complete the redact list per CLAUDE.md: email, pan, aadhaar, password, otp, token, and the
     nested variants (*.email, req.body.otp, etc). Add a test that a log line containing a phone
     number and an OTP emits neither.
  4. Set pino.destination({ dest: 1, sync: false, minLength: 4096 }) in production. pino's default
     destination is SYNCHRONOUS — every log line is a blocking write(2), and under 83 RPS with a line
     per request that is measurable. Confirm the esbuild-plugin-pino transport wiring (build.mjs:107,
     Dockerfile:35-41) still resolves after the change.
  5. Add Redis reachability and pool saturation to /readyz so a saturated instance drops out of the
     load balancer rotation instead of accepting requests it cannot serve.

  Do NOT add per-query logging of statement text — that will leak PII into logs, which is the exact
  problem point 3 is fixing. Log durations and a query fingerprint, not parameters.

COMMIT: feat: add metrics, restore request timing, complete PII redaction
```

---

# Phase 5 — Frontend

### Phase 5 orchestration prompt

```
Work through docs/PERFORMANCE_FIX_PROMPTS.md prompts PERF #20 through #24.

#20 and #22 are the two biggest user-visible wins — web code splitting and the mobile attendance
roster. Do those first even if you do nothing else in this phase.

Web and mobile are independent; they can be done in parallel by two people. Do not mix them in one
commit.

Every prompt in this phase requires a BEFORE and AFTER measurement. For web that is bundle bytes
from the build output. For mobile it is a render count or a frame timing — if you cannot measure it,
say so rather than claiming an improvement.
```

---

### PERF #20 — Web: code-split the admin panel from the public site

```
PERF #20 — The public homepage downloads all 40 admin screens (critical)

Files:
  apps/jain-pathshala/vite.config.ts   (~lines 70-73)
  apps/jain-pathshala/src/App.tsx      (~lines 11-75)
  apps/jain-pathshala/src/components/ui/chart.tsx  (~line 2)

PROBLEM
vite.config.ts:70-73 has no manualChunks, no chunkSizeWarningLimit, no analyzer. App.tsx:11-75
statically imports all 57 route components. Zero React.lazy, zero Suspense, zero import() anywhere
in src/ — verify with: rg "React.lazy|import\(" apps/jain-pathshala/src

Measured on the committed build:
  index-yn5ajvgj.js   raw 1,393,047  gzip 287,500
  index-D2YOUf_r.css  raw   109,721  gzip  18,003
That build predates AnalyticsPage's recharts import, so it is a LOWER BOUND.

A parent on 3G waits ~6 seconds for JS transfer alone, then 1.5-3s of parse/compile on a low-end
Android, before any content. They are downloading AuditLogPage, QueuesPage, ExamGradingPage and 37
other admin screens they can never access — ~290KB of pure waste per cold visit, on metered data.

chart.tsx:2 also does `import * as RechartsPrimitive from "recharts"`, which defeats tree-shaking
and pulls ~110KB gzip into the bundle every public visitor downloads for one admin screen.

BEFORE — required
  pnpm --filter @workspace/jain-pathshala build
  Then list dist/public/assets with sizes and gzip sizes. Paste them.

CHANGE
  1. Split at the two shells first — that alone recovers most of it:
       const AdminRoutes  = lazy(() => import('@/routes/AdminRoutes'));
       const PublicRoutes = lazy(() => import('@/routes/PublicRoutes'));
     with a Suspense fallback that is NOT a blank screen — use the app's existing loading treatment.
  2. Then lazy each admin page individually.
  3. vite.config.ts: add manualChunks for react/react-dom and the @radix-ui cluster, and
     chunkSizeWarningLimit: 300.
  4. chart.tsx: replace the namespace import with named imports of the ~8 components actually used.
  5. Add rollup-plugin-visualizer.

  Keep dedupe: ["react", "react-dom"] at vite.config.ts:60 — that prevents duplicate React copies in
  a workspace monorepo and is a real, commonly-missed footgun. Do not remove it while restructuring.

AFTER
  Rebuild. Paste the new asset list. Report the gzip size of the entry chunk a public visitor loads.

CI GATE — same commit
  Fail the build if the public entry chunk exceeds 150KB gzip. Without a gate this regresses within
  a month.

COMMIT: perf: code-split the admin panel from the public site
```

---

### PERF #21 — Web: kill the 50-request loop and adopt the query cache

```
PERF #21 — useAdminList fires up to 50 sequential requests; TanStack Query has zero consumers (critical)

Files:
  apps/jain-pathshala/src/hooks/useAdminList.ts  (~lines 31-37)
  apps/jain-pathshala/src/App.tsx                (~lines 77-84)
  ~30 call sites — find them with: rg "useAdminList" apps/jain-pathshala/src

PROBLEM 1
  do {
    const envelope = await get<ListEnvelope<T>>(withCursor(path, cursor));
    collected.push(...(envelope.data?.items ?? []));
    cursor = ...;
    guard += 1;
  } while (cursor && guard < 50);

Each iteration awaits the previous. AdminListPages.tsx:1017 requests ?limit=200 against Punya
transactions, so a fully-populated table is up to 10,000 rows over 50 SERIAL requests. On a 300ms-RTT
rural connection that is 20-30 seconds of spinner, then 10,000 unvirtualised <tr>s in the DOM.

There is no AbortController — navigating away lets the loop run to completion and setItems fires on
an unmounted component.

PROBLEM 2
App.tsx:77-84 constructs a QueryClient with staleTime: 30_000. Verify:
  rg "useQuery|useMutation" apps/jain-pathshala/src | wc -l
It returns 0. All 34 pages hand-roll useEffect + fetch. Every navigation refetches from zero. A
Sanchalak toggling Students -> Attendance -> Students re-downloads the roster three times. The
staleTime config is dead code.

TEST FIRST
  a) "the admin list loads one page and does not auto-paginate"
  b) "navigating away cancels in-flight requests"
  c) "revisiting a list within staleTime serves from cache" (after the migration)

CHANGE
  1. Stop client-side full-collection. Load one page, render, add a "Load more" control — or migrate
     to useInfiniteQuery, which gives you cancellation and caching for free.
  2. At minimum, add an AbortController tied to the effect cleanup even if you keep the loop
     somewhere temporarily.
  3. Migrate the admin pages to useQuery against the existing queryClient. Set
     refetchOnWindowFocus: false in defaultOptions — it currently defaults to TRUE, which becomes a
     refetch storm the moment pages start using the client.
  4. If a full dataset is genuinely needed (ID cards, exports), add a server-side export endpoint
     rather than paginating 50 times on the client.

  DECISION POINT: if you conclude the migration is too large for one commit, migrate the five worst
  call sites (the ?limit=200 and ?limit=500 ones) and leave the rest, but say clearly which are done
  and which are not. Do NOT delete the QueryClient — a half-migrated app still benefits.

COMMIT: perf: page admin lists instead of collecting 50 pages client-side
```

---

### PERF #22 — Mobile: the attendance roster

```
PERF #22 — Every tap re-renders the whole roster (critical) — THE most important mobile fix

Files:
  apps/jain-pathshala-mobile/app/attendance/[id].tsx  (~lines 49, 57-66, 74-78, 297-348)
  apps/jain-pathshala-mobile/components/ui.tsx        (~lines 63-84, 197-224)
  apps/jain-pathshala-mobile/components/GalleryCarousel.tsx  (~lines 140-153 — the CORRECT pattern)

PROBLEM
  function setStudentMark(studentId: string, value: SimpleMark) {
    setFeedback(null);
    if (Platform.OS !== "web") void Haptics.selectionAsync();
    setMarks((prev) => ({ ...prev, [studentId]: value }));
  }

All marks live in one Record on the screen component (:49). Rows are inline JSX in roster.map
(:297-348), not memoised, each with two inline arrow props (:332, :342). React.memo appears NOWHERE
in app/ or components/ — verify: rg "React.memo|memo\(" apps/jain-pathshala-mobile

Each row renders two <Body> plus two <MarkToggle>, every one calling useColors() + useLocale()
(ui.tsx:197-224). A 50-student roster is ~250 component renders and ~250 fresh style-array
allocations PER TAP — roughly 120-300ms of JS-thread block on a low-end Android.

The Guruji taps 50 times in sequence and every single tap feels sticky. This is the app's core flow
and the reason the whole offline design exists.

Also: components/ui.tsx:63-84 — the shared Screen primitive is a plain ScrollView with no
removeClippedSubviews, and the roster maps directly into it. No virtualisation.

The correct pattern is already in this repo: GalleryCarousel.tsx:140-153 uses FlatList with BOTH
keyExtractor and getItemLayout. Read it first.

BEFORE — required
  Measure. Either React DevTools Profiler render counts for one tap, or a console.count in the row
  component, or Systrace frame timings. Paste the number of row renders per tap at 50 students.
  If you cannot measure it, say so — do not proceed on vibes.

CHANGE
  1. Extract a RosterRow component taking (studentId, name, code, status, onMark) and wrap it in
     React.memo. Keep the prop surface primitive — passing an object recreates the identity and
     defeats the memo.
  2. Pass a useCallback'd onMark instead of a closure per row.
  3. Render via FlatList with getItemLayout — rows are a fixed minHeight: 48, so the layout is
     computable and getItemLayout is cheap and correct here.
  4. hooks/useColors.ts:23 returns { ...palette, radius } — a NEW OBJECT PER CALL, called 4-6x per
     row. Memoise at module scope.
  5. app/attendance/[id].tsx:57-66 calls setMarks + setSeeded DURING RENDER. React discards and
     re-runs, so the full roster seed is built and thrown away once. Move it to an effect or a lazy
     useState initialiser.

  Note the app has React Compiler enabled (app.json experiments.reactCompiler), which auto-memoises
  a lot. It does NOT substitute for virtualisation, and it cannot help when the state object itself
  changes identity on every tap — which is exactly what is happening here.

AFTER
  Re-measure. Paste the new render count per tap. Target: 1-2 rows re-rendered, not 250.

COMMIT: perf: memoise and virtualise the attendance roster
```

---

### PERF #23 — Mobile: offline query cache

```
PERF #23 — The offline-first app has no offline cache (critical)

Files:
  apps/jain-pathshala-mobile/app/_layout.tsx  (~line 55)
  apps/jain-pathshala-mobile/lib/api.ts       (~line 9)
  apps/jain-pathshala-mobile/lib/offline/storage.ts     (~lines 1-4)
  apps/jain-pathshala-mobile/lib/offline/sync-engine.ts (~lines 196-198, 235-309, 317-333)

PROBLEM 1 — no cache, no persistence
  const queryClient = new QueryClient();
No defaultOptions -> staleTime 0, retry 3. No persistQueryClient, no onlineManager/focusManager, and
@react-native-community/netinfo is not a dependency. Combined with REQUEST_TIMEOUT_MS = 30_000.

So: the Guruji opens /attendance/:id with no signal. No cached roster. Three retries against a 30s
timeout = ~2 MINUTES OF BARE SPINNER, then an error, and no roster to mark. That is total failure of
the module's primary use case — the exact scenario CLAUDE.md's entire offline-sync section exists to
prevent.

Separately staleTime: 0 refetches everything on every navigation over metered 3G, and
app/parent/home.tsx:41-42 downloads two years of attendance JSON to render rows.slice(0, 2).

PROBLEM 2 — the offline queue is AsyncStorage with O(n^2) writes
storage.ts:1-4 notes the spec mandates MMKV but uses AsyncStorage. Every mutation is a full-queue
JSON.parse -> mutate -> stringify -> write. sync-engine.ts:196-198 calls updateOp once per op inside
a loop, then again per result (up to 2 writes per op in the failed branch). enqueueOp re-sorts the
whole array on every insert.

Draining 20 ops = 40+ full serialisations of every queue, each a bridge round-trip — seconds of
blocked JS exactly when the Guruji regains signal.

PROBLEM 3 — the sync loop polls forever
sync-engine.ts:317-333 setInterval(tick, 5_000) reads all seven queues (7 getItem + 7 JSON.parse)
plus a media queue. Runs for parents, students and guests who never enqueue anything. Runs
backgrounded. Runs offline. ~5,760 storage round trips per hour on a device that charges once a day.

TEST FIRST
  a) "an attendance roster opened offline renders from cache"
     This is the acceptance test for the whole fix. Seed the cache, go offline, assert the roster
     renders and is markable.
  b) "queued marks survive an app restart"
  c) "draining 20 ops writes each queue at most twice"

CHANGE
  1. QueryClient defaults: staleTime 5min, gcTime 24h, retry 2, networkMode 'offlineFirst'.
  2. PersistQueryClientProvider with an AsyncStorage persister. Persist the attendance and roster
     queries specifically — decide the allow-list rather than persisting everything.
  3. Add netinfo; wire onlineManager and focusManager (AppState).
  4. sync-engine drainQueues: read once, mutate in memory, write once per queue per pass.
  5. Gate the 5s loop: start only for shikshak/sanchalak, gate on a non-empty in-memory flag, back
     off to 60s when idle, pause on AppState !== 'active', and drain on NetInfo reconnect rather
     than polling.
  6. Add ?limit=5 to the parent-home attendance query; keep the full paginated query for the
     dedicated screen. lib/api.ts:289-298 already exposes apiGetEnvelope for cursors and it is unused.

  MMKV migration (storage.ts) is a SEPARATE commit — it is the spec-correct answer but it is a
  native dependency change and should not ride along with a behavioural fix. Note it and move on.

COMMIT: perf: persist and cache mobile queries for offline use
```

---

### PERF #24 — Both surfaces: fonts, images, lists

```
PERF #24 — 13 font faces block first paint on both surfaces (high)

Files:
  apps/jain-pathshala/src/index.css                   (~line 1, ~lines 75-76)
  apps/jain-pathshala/index.html                      (~lines 16-17)
  apps/jain-pathshala-mobile/app/_layout.tsx          (~lines 40, 106-120, 191)
  apps/jain-pathshala/src/pages/admin/GalleryAdminPage.tsx    (~line 290)
  apps/jain-pathshala/src/pages/admin/MediaCurationPage.tsx   (~lines 440-444)
  apps/jain-pathshala-mobile/app/gallery.tsx          (~lines 1, 29-30, 86, 164)

PROBLEM 1 — fonts, web
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Mukta:wght@400;500;600;700&family=Outfit:wght@400;500;600;700;800;900&family=Tiro+Devanagari+Sanskrit&display=swap');

This is the first line of index.css and survives into the built CSS as the FIRST BYTES of a 109KB
render-blocking stylesheet. That creates a three-hop critical chain: HTML -> app CSS (109KB) ->
parse -> Google Fonts CSS -> font files. The preconnect hints at index.html:16-17 help the DNS/TLS
leg but cannot start the request early, because the URL is not discoverable until the 109KB
stylesheet has downloaded and parsed.

13 faces: Outfit x6, Mukta x4, DM Mono x2, Tiro x1. Mukta and Tiro carry Devanagari and are largest.

A spec deviation with a real cost — index.css:75-76:
  --font-ui: 'Outfit', 'Mukta', sans-serif;
  --font-display: 'Outfit', 'Tiro Devanagari Sanskrit', sans-serif;
CLAUDE.md mandates Tiro Devanagari Sanskrit for display and Mukta for body. Outfit is first in BOTH
and has NO Devanagari coverage, so Hindi text falls through to Mukta/Tiro anyway — meaning all six
Outfit weights are downloaded and, for Hindi users, largely unused.

PROBLEM 2 — fonts, mobile
_layout.tsx:106-120 loads the same 13 faces; :191 returns null until they resolve, behind
preventAutoHideAsync(). ~1.5-2MB parsed before the first pixel, every launch.

PROBLEM 3 — images
Web admin grids are not lazy: GalleryAdminPage.tsx:290 and MediaCurationPage.tsx:440-444 render 200
<img> with no loading="lazy". Opening media curation triggers 200 simultaneous FULL-SIZE image
requests — 200-400MB on a metered connection, and it saturates the connection so the page's own API
calls stall.

Public gallery falls back to image_url when thumbnail_url is missing, putting a full-resolution phone
photo into a ~300px cell. No width/height, so every image lands with a layout shift.

Mobile app/gallery.tsx:1 imports React Native Image, not expo-image (unlike every other screen), no
caching policy, 60 items in a flexWrap grid inside a ScrollView. At 800x600 that is ~110MB of decoded
RGBA on a 1GB device — a likely OOM. And :29-30 fires BOTH useWallGallery(60) and
useAdminWallGallery(isStaff, 60) for staff, discarding one, because useWallGallery has no enabled guard.

CHANGE — fonts (one commit, both surfaces)
  Web:
   1. Move the font request into index.html as a real <link rel="stylesheet">, discoverable in the
      initial HTML scan. Delete the @import from index.css.
   2. Cut Outfit to 400/600/700. Drop DM Mono if the mono token is only used for student codes —
      check before removing; system ui-monospace is free.
   3. Add &subset=latin,devanagari and split Devanagari faces behind unicode-range so Latin-only
      readers never fetch them.
   4. Fix the font stacks per CLAUDE.md: Tiro for display, Mukta for body.
   5. Keep display=swap — that is already correct.
  Mobile:
   6. Block on three faces (Outfit_400, Outfit_700, Mukta_400); load the other ten in a
      non-blocking second useFonts after mount. constants/typography.ts:6-26 already indexes by name.

CHANGE — images (separate commit)
   7. loading="lazy" + decoding="async" + explicit width/height on all three web grids.
   8. Never fall back to image_url in a thumbnail slot — render the initial-letter placeholder
      instead, and make server-side thumbnail generation mandatory. (That is a backend follow-up;
      note it, do not build it here.)
   9. Mobile gallery.tsx: expo-image with cachePolicy="memory-disk" and recyclingKey, FlatList with
      numColumns={2}, and add enabled: !isStaff to useWallGallery.

CHANGE — lists (separate commit)
  10. Add @tanstack/react-virtual to AdminTable (components/admin/AdminPageShell.tsx:35-65) and the
      two image grids.
  11. AttendancePage.tsx:265-269 mounts one Radix Dialog PER ROW — 100 Dialog roots on a 100-row
      page. Hoist a single page-level dialog driven by markingSessionId state.
  12. Memoise both context values — auth-context.tsx:38 and locale-context.tsx:27 both pass a new
      object literal every render, and they wrap the entire app. useCallback the functions, useMemo
      the value.
  13. Debounce the IdCardsPage search input (150ms) — it re-filters 500 students per keystroke.
  14. Mobile: FlatList the six unbounded ScrollView lists — my-attendance, student/punya, gallery,
      notifications, shikshak/students, admin/students. GalleryCarousel.tsx:140-153 is the reference.

COMMIT (each): perf: load fonts without blocking first paint
                perf: lazy-load admin image grids
                perf: virtualise admin tables and mobile lists
```

---

## Appendix — measurement harness

Several prompts ask for a query-count spy. If one does not exist yet, build it once and reuse it:

```
Add a test helper that counts Drizzle-issued statements for a block of work.

Wrap the pg pool's query method (or use pg's 'query' event) to increment a counter, expose
withQueryCount(fn) returning { result, count }, and reset between tests.

Put it wherever the existing test helpers live — read apps/api-server/test/ first and match the
conventions there rather than inventing a new location.

This is the measurement instrument for PERF #7, #10, #11, #13 and #14. Getting it right once is
worth more than five approximate measurements.
```

And a note on the load test: `infra/load-tests/attendance-burst-node.mjs:113-141` already asserts
invariants — duplicate idempotency keys and balance drift — not just latency, and exits non-zero.
Keep that. A performance change that passes on timing and fails on invariants is a regression, and
that script is the only thing in the repo that will catch it.
