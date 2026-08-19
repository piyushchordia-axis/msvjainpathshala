# Shivir module — fix verification

**Date:** 2026-08-19
**Companion to:** [`ShivirModule_CodeReview_2026-08-15.md`](./ShivirModule_CodeReview_2026-08-15.md)
**Scope:** all 29 findings (C1–C3, H1–H10, M1–M10, L1–L6)

---

## Two corrections to the review

Both were verified against the code, not assumed.

**H1 was already ~80% done.** `enqueueShivirScan` existed
(`lib/offline/sync-engine.ts`), sat in `DRAIN_ORDER` slot 4, had producer tests,
and the scanner screen already called it on transport failure. The file is 528
lines, not the 478 the review read. What remained was narrower and is fixed
below.

**Web admin routes were already role-guarded.** `AdminRouteGuard`
(`routes/AdminRoutes.tsx`) resolves `sidebar-nav.ts` by longest-prefix match, so
both shivir routes were gated at `city_admin`. H10's "the routes themselves have
no guard" is stale; the gate-on-the-wrong-side mismatch was real and is fixed.

---

## Decisions taken

| # | Decision |
|---|---|
| D1 | **SPEC §6.14 role sets, literally.** `SHIVIR_ADMIN_ROLES` = super/state/city_admin (author, export). `SHIVIR_OPS_ROLES` = + sanchalak (sessions, dashboard, volunteer assignment). Scanning = an ops role in city scope **or** a live volunteer assignment. **Shikshak is no longer admitted by role** — a Guruji at a venue is assigned as a volunteer, which C3 now makes possible. |
| D2 | **Walk-ins are recorded, never refused**, and flagged via `shivir_attendance_scans.was_registered`. |
| D3 | **Socket.IO `/shivirs/:shivirId` implemented**, plus `socket.io-client` on web and a 10s poll fallback. |
| D4 | **`name`/`description` → `_en` + nullable `_hi`.** Clients render `hi ? (x_hi ?? x_en) : x_en`. |
| D5 | **Export is synchronous** (CSV hand-rolled with a BOM for Excel/Devanagari; PDF via the existing bilingual `PdfBuilder`). |
| D6 | **No new error codes** — `ERR_ALREADY_REGISTERED`, `ERR_FULL`, `ERR_NOT_ELIGIBLE`, `ERR_NOT_FOUND`, `ERR_VALIDATION_FAILED` all already existed. |

---

## Findings

### Critical

| ID | Status | What changed |
|---|---|---|
| **C1** | Fixed | Authorization moved **into** `services/shivir-scan.ts` behind `lib/shivir-access.ts`, so both transports pass the same gate. `scanned_at` is now threaded through and stored; `client_op_id` is the replay anchor; `device_offline` is recorded. The sync handler's bare `.parse()` is wrapped, so a malformed op fails once as `ERR_VALIDATION_FAILED` instead of retrying forever as `ERR_INTERNAL`. Authorization failures map to `failed`, deliberately not `conflict` — a forged scan must not offer the client a retry. |
| **C2** | Fixed | `POST /v1/shivirs/:id/register`, `DELETE …/register/:studentId`, `GET …/registrations/mine`. Ownership via `ownedStudentsCondition` (Q11), capacity enforced under an advisory lock, `msv_only` eligibility checked. Schema gained `status`, `registered_by_user_id`, `registered_at`, `cancelled_at` and `UNIQUE (shivir_id, student_id)`. Cancelling flips status so re-registering reuses one row. Register CTA on the mobile detail screen. |
| **C3** | Fixed | `POST/GET/DELETE /v1/admin/shivirs/:id/volunteers`, an assignment panel on the new admin shivir page, `GET /v1/shivirs/mine` and a mobile **My shivirs** screen. Revocation is a timestamp, never a delete. Partial unique on live assignments lets a revoked volunteer be re-assigned. |

### High

| ID | Status | Note |
|---|---|---|
| H1 | Fixed | Offline fallback widened from `ERR_NETWORK`-only to `statusCode 0 / 429 / 5xx` — a captive-portal 502 used to **discard** the scan. `jp.queue.shivir_scans` now has a UI reader (`useQueueSyncOps` + `SyncOpStatus` + retry); it had none. `retryOp` resets `attempts`, so manual retry is no longer one-shot. |
| H2 | Fixed | `UNIQUE (session, student, scan_kind)` dropped; idempotency moved to `client_op_id`. Re-entry (in → out → in) works and is tested. |
| H3 | Fixed | Server derives the leg from the student's last scan inside the advisory lock. The client toggle is now a status line. A 60s re-scan window absorbs double-taps, and out-of-order drains are dropped as duplicates rather than writing a check-out dated before its check-in. |
| H4 | Fixed | Parent push on scan (`kind: "shivir"` — the enum value had never been sent by any code), debounced 60s per (student, session). Publish announces to parents in the shivir's city, MSV-filtered when `msv_only`. |
| H5 | Fixed | `/shivirs/:shivirId` namespace mirroring `admin-dashboard-feed`, sharing one `io` via the new `lib/socket-server.ts`. Web subscribes; falls back to a 10s poll and **says which mode it is in** rather than claiming to be live. |
| H6 | Fixed | `PATCH` and soft-delete `DELETE`, both audited. |
| H7 | Fixed | `GET /v1/admin/shivirs` scoped by `cityIdsForUser` — it previously had no `where` clause at all. |
| H8 | Fixed | `msv_only` filtered for guests via `optionalAuth`, badged on web and mobile, settable in the admin dialog. |
| H9 | Fixed | `name_en`/`name_hi`, `description_en`/`description_hi` through schema, contracts, API, web, mobile and seed. |
| H10 | Fixed | `SHIVIR_ADMIN_ROLES` / `SHIVIR_OPS_ROLES` in `@workspace/api-zod` with the `EXAM_ADMIN_ROLES` comment discipline; `requireShivirOps` / `requireShivirAdmin` middleware; dashboard nav lowered to `sanchalak`. |

### Medium and Low

All fixed. Notable ones: **M1** CSV + PDF export; **M2** roster endpoint with
`registered / scanned / walk_in / not_arrived`; **M4** date-window validation on
create *and* patch (validated against the merged row, so moving only
`start_date` cannot invert a range); **M5** `msv_shivir` registered in
`punya_features` — in the migration *and* the seed, because the seed truncates
that table; **M9** `todayIst()`; **M10** search, published filter and cursor
paging.

**M3** is fixed with a deliberate limit: session create, volunteer
assign/revoke and shivir edits are audited; individual scans are not, and the
route says why — every field an audit row would carry is already a column on
`shivir_attendance_scans`, and a few hundred scans per shivir would bury the
admin actions the log exists to surface.

---

## Two bugs found while writing the tests

Worth recording, because both would have shipped silently.

**The partial unique index broke every offline scan.** `client_op_id`'s unique
index was created `WHERE client_op_id IS NOT NULL`, and Postgres cannot infer a
partial index from a bare `ON CONFLICT (client_op_id)` — so every sync-path scan
failed with *"there is no unique or exclusion constraint matching the ON CONFLICT
specification"*. The predicate bought nothing anyway: Postgres already treats
NULLs as distinct in a unique index. Dropped, with a comment against re-adding it.

**Admin list pagination would have been inert.** `useAdminList` pages on
`cursor` / `next_cursor`; the new endpoint returned `next_offset`, so `hasMore`
would have been permanently false and "Load more" would never have rendered —
exactly the failure that hook's own comment documents. The endpoint now speaks
cursor.

---

## Verification

```bash
pnpm --filter @workspace/db run migrate         # 0087 applies on a from-zero chain
node lib/db/scripts/check-migration-drift.mjs   # chain reproduces schema.ts
pnpm run typecheck:libs
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/api-server run test
pnpm --filter @workspace/jain-pathshala run typecheck
pnpm --filter @workspace/jain-pathshala-mobile run typecheck
```

New API test files: `shivir-sync.test.ts` (the C1 regression — a parent posting
`op_type: "shivir_scan"` with their own child's QR, asserting both the refusal
*and* that no row was written), `shivir-registration.test.ts`,
`shivir-inout.test.ts`, `shivir-feed.test.ts`. `shivir-scanner.test.ts` was
updated for the date-window guard and the new role sets.

## Still open

- **CLAUDE.md's Socket.IO namespace list** names `/push-quizzes/:quizId`, which
  does not exist, and describes the admin feed as `/admin-dashboard/:cityId`
  when it is `/admin-dashboard` plus a `city:<id>` room. `/shivirs/:shivirId`
  now matches the doc; the other two entries remain drifted.
- **Deploying D1 needs care.** If any centre is already relying on Gurujis
  scanning, they must be assigned as volunteers in the same release — otherwise
  a live shivir loses its scanners the moment this ships.
