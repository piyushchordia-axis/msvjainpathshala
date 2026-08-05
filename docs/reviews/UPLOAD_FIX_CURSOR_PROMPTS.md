# Upload module — Cursor fix prompts

Companion to [`UPLOAD_MODULE_REVIEW.md`](./UPLOAD_MODULE_REVIEW.md). Each block is a self-contained prompt — paste one at a time into Cursor (Cmd-K / Composer, Agent mode), verify, commit, then move to the next. They are ordered by dependency: prompts 1–3 all touch `routes/v1/uploads.ts` and `media-upload-queue.ts`, and running them out of order will conflict.

Every prompt assumes Cursor has `CLAUDE.md` in context. If it doesn't, prefix with:

> Read `CLAUDE.md` (error-code enum, envelope shape, audit rules, bilingual rules, offline-sync canonical model, soft-delete conventions) before making any change.

Prompts 1–5 are release blockers. 6–10 are follow-ups.

---

## 1 — Delete the leftover debug telemetry (P0)

Do this first and commit it alone. It touches four of the files the later prompts edit, and keeping it separate makes those diffs readable.

```
Remove leftover debugging telemetry from the repo. Fourteen blocks marked
`// #region agent log` … `// #endregion` POST request internals to
http://127.0.0.1:7744/ingest/33975112-0421-4ef6-a79e-c48c452c7ec5 on every upload and
every homework sync op. They are not __DEV__-gated, not env-gated, fire an unawaited
fetch per request, and bypass the Pino PII redactor entirely.

Delete every block (the marker comments too, not just the fetch call) in:
  apps/api-server/src/routes/v1/uploads.ts            (~lines 87, 174)
  apps/api-server/src/services/homework-submit-sync.ts (~lines 118, 161, 189, 241)
  apps/api-server/src/services/sync-batch.ts           (~lines 411, 439)
  apps/jain-pathshala-mobile/components/HomeworkProofPicker.tsx (~line 88)
  apps/jain-pathshala-mobile/lib/offline/media-upload-queue.ts  (~line 166)

Then run `git grep -n "#region agent log"`, `git grep -n "127.0.0.1:7744"` and
`git grep -n "X-Debug-Session-Id"` and confirm all three return nothing. Search the whole
repo, not just the files listed — there may be more outside the upload path.

Careful: in homework-submit-sync.ts the block at ~line 161 sits INSIDE an
`if (!parsed.success)` branch and the one at ~189 sits between the resolveOwnedUpload call
and the `if (!owned.ok)` check. Remove only the log blocks; leave the surrounding control
flow byte-identical.

Run `pnpm typecheck`.
```

---

## 2 — Fix the homework proof folder + fail loudly on unknown folders (P0)

```
Read CLAUDE.md, then fix the bug that makes every parent/student homework photo submission
fail with 422.

The chain:
  HomeworkProofPicker.tsx calls enqueueHomeworkProofUpload without a `folder`
  → media-upload-queue.ts:102  folder: input.folder ?? "homework-proof"
  → api.ts:350                 form.append("folder", "homework-proof")
  → uploads.ts:38-49           folderSchema z.enum does NOT contain "homework-proof"
  → uploads.ts:85-86           safeParse fails, silently falls back to "misc"
  → storage.ts:39              key = "misc/<uuid>.jpg"
  → homework-submit-sync.ts:182 resolveOwnedUpload({ folderPrefix: "homework/" })
  → owned-upload.ts:57          !key.startsWith("homework/") → 422 ERR_VALIDATION_FAILED

The teacher path is unaffected — app/shikshak/homework.tsx passes "homework" explicitly.

Fix A — the folder string:
  apps/jain-pathshala-mobile/lib/offline/media-upload-queue.ts:102
    folder: input.folder ?? "homework-proof"   →   folder: input.folder ?? "homework"

Fix B — the test that locks the bug in:
  apps/jain-pathshala-mobile/lib/__tests__/homework-proof-upload.test.ts:68
    the assertion `toHaveBeenCalledWith(..., "homework-proof")` → "homework"
  Line ~40: the mock returns url "https://cdn.example.com/homework/navkar.jpg", a shape the
  real server would never mint for that folder. Make every mocked upload URL in this file
  look like a real server response: `${PUBLIC_API_URL}/uploads/homework/<uuid>.jpg`.

Fix C — make this class of bug impossible. In apps/api-server/src/routes/v1/uploads.ts,
replace the silent fallback at ~line 85 with a hard 422:

    const folderParse = folderSchema.safeParse(req.body?.folder ?? "misc");
    if (!folderParse.success) {
      fail(res, 422, "ERR_VALIDATION_FAILED",
        `Unknown upload folder "${String(req.body?.folder)}".`);
      return;
    }
    const folder = folderParse.data;

  A typo'd folder is always a client bug. Silently downgrading it to "misc" turned a
  one-character mistake into a three-hop, user-invisible data-loss path.

Add integration tests in apps/api-server/test/uploads.test.ts:
- POST /v1/uploads with folder=homework as a parent → 200, and data.key starts with "homework/"
- POST /v1/uploads with folder=homework-proof → 422 ERR_VALIDATION_FAILED (not a misc fallback)
- POST /v1/uploads with no folder field → 200, key starts with "misc/" (the default still works)
- end-to-end: upload with folder=homework, then submit that URL as a homework proof via
  POST /v1/sync/batch with op_type homework_submission → status "success", not "failed"

That last test is the regression guard that would have caught this. Do not skip it.

Run `pnpm typecheck`, `pnpm test -- uploads`, and the mobile vitest suite.
```

---

## 3 — Never report a rejected submission as "Submitted." (P0)

Depends on prompt 1 (removes a log block from the same function).

```
Read CLAUDE.md "Offline sync — canonical model" §8 (failure states), then fix the silent
failure in the homework proof picker.

apps/jain-pathshala-mobile/components/HomeworkProofPicker.tsx (~line 100) derives success
from the FILE UPLOAD, not from the submission:

    const offline = !result.remote_url;
    setStatusText(offline ? "Saved offline — will upload…" : "Submitted.");

`remote_url` is set the moment the file lands in /v1/uploads. The homework attach happens
afterwards, inside drainMediaUploads → deps.drainSync() → drainQueues(), which records a
failed/conflict op result in the queue and never throws. So a 422 from the server renders
to the parent as "Submitted." — the exact failure CLAUDE.md §8 forbids ("a mark that will
never sync must not look like success").

Fix:
- In apps/jain-pathshala-mobile/lib/offline/sync-engine.ts, have drainQueues (or a new
  drainQueuesWithResult) return the per-op terminal states from the /v1/sync/batch response
  rather than Promise<void>. Do not swallow `failed` / `conflict`.
- In lib/offline/media-upload-queue.ts, thread that through: the object returned by
  enqueueHomeworkProofUpload gains a `sync_state` of
  "queued" | "synced" | "conflict" | "failed", plus `error_message?: string` for the last two.
  A media op whose follow-up came back `failed` must NOT be removed from the queue — today
  the `after.filter(o => o.id !== op.id)` at the end of the try block dequeues it
  unconditionally, so a rejected submission is also unrecoverable.
- In HomeworkProofPicker.tsx, map the states to the CLAUDE.md §8 UI vocabulary:
    queued   → "Saved offline — will upload when you reconnect." / existing Hindi
    synced   → "Submitted." / "प्रस्तुत हो गया।"
    conflict → show the server message, offer no auto-retry
    failed   → show the server message and a manual Retry button; never auto-dismiss
  "Submitted." must require an observed `synced`. Follow the CLAUDE.md error-voice rule:
  state the problem AND the fix, in both EN and HI.

Add tests in apps/jain-pathshala-mobile/lib/__tests__/homework-proof-upload.test.ts:
- upload succeeds but the homework attach returns status "failed" → result.sync_state is
  "failed", the op is still in the queue, and the message surfaced is the server's
- attach returns "conflict" → sync_state "conflict", op is dequeued (terminal, per §7)
- attach returns "success" → sync_state "synced", queue is empty

Run `pnpm typecheck` and the mobile vitest suite.
```

---

## 4 — Ownership check on the student photo route (High)

```
Read CLAUDE.md, apps/api-server/src/lib/owned-upload.ts, and the two existing callers
(services/homework-submit-sync.ts:182, routes/v1/niyam-submissions.ts:122).

apps/api-server/src/routes/v1/me.ts — PUT /students/:id/photo validates the supplied URL by
key PREFIX only (~line 110):

    const key = uploadKeyFromUrl(body.photo_url);
    if (!key || !key.startsWith("student-photos/")) { /* 422 */ }

There is no upload_objects lookup and no uploaded_by check. ownedStudentId() at ~line 97
gates the STUDENT, not the UPLOAD. Two consequences:

  (a) Cross-tenant file deletion. Set your child's photo_url to another family's
      student-photos/<uuid> key (accepted), then change it to anything else — the handler at
      ~line 158 calls storage.remove(previousKey) on their file.
  (b) A fabricated key like "student-photos/nonexistent.jpg" passes validation and is written
      to students.photo_url, so ID-card render silently gets a 404 image.

Fix — replace the prefix check with the same primitive the other two modules use:

    const owned = await resolveOwnedUpload({
      userId: req.authUser!.id,
      url: body.photo_url,
      folderPrefix: "student-photos/",
      allowedKinds: ["image"],
      label: "profile photo",
    });
    if (!owned.ok) {
      fail(res, 422, "ERR_VALIDATION_FAILED", owned.message);
      return;
    }

Keep the `body.photo_url === null` clear-photo path exactly as it is — that branch must stay
reachable and must still remove the previous key (which IS owned, because it passed this
check when it was set).

Then audit the rest of the codebase for the same pattern: grep for `uploadKeyFromUrl` and
`startsWith("` against a folder prefix, and confirm every client-supplied upload URL that
gets persisted or deleted goes through resolveOwnedUpload. Report anything else you find.

Add tests in apps/api-server/test (new me-photo.test.ts if there is no home for it):
- parent A uploads to student-photos, sets it on their own child → 200
- parent A sets their child's photo to a key uploaded by parent B → 422, and parent B's file
  still exists on disk afterwards (assert via storage.getStream or fs.existsSync)
- a well-formed but non-existent student-photos key → 422
- clearing with null still works and still removes the previously-owned file

Run `pnpm typecheck` and `pnpm test -- me`.
```

---

## 5 — Remove `usesCleartextTraffic` from Android release builds (High)

```
apps/jain-pathshala-mobile/app.json:36 sets android.usesCleartextTraffic = true. That ships
in release builds, so a downgraded or misconfigured EXPO_PUBLIC_API_URL would send children's
photos, ID-card images and bearer tokens over plaintext HTTP. iOS is already correct
(NSAllowsArbitraryLoads: false, with NSAllowsLocalNetworking for the dev server only).

Fix: make cleartext dev-only, matching what iOS already does.

Preferred — a small config plugin at apps/jain-pathshala-mobile/plugins/withDevCleartext.js
that injects a res/xml/network_security_config.xml permitting cleartext for the LAN dev host
only (10.0.2.2, localhost, and the 192.168.0.0/16 + 172.16.0.0/12 ranges Metro serves from),
and sets android:networkSecurityConfig on <application>. Register it in the plugins array and
delete `"usesCleartextTraffic": true` from app.json. Follow the shape of the existing
./plugins/withGradleMemory plugin.

Acceptable minimum if that is too much for this pass: gate it on the build profile so the
production EAS profile never gets it, and leave a comment explaining why.

While you are in app.json — android.permissions lists CAMERA, RECORD_AUDIO and the two
location permissions but not READ_MEDIA_IMAGES / READ_MEDIA_VIDEO. The expo-image-picker
config plugin normally injects those, but the explicit permissions array has historically
behaved as an allowlist. Run `npx expo prebuild --platform android --clean`, open
android/app/src/main/AndroidManifest.xml, and confirm both READ_MEDIA_* permissions are
present. If they are missing, add them explicitly. Report what you found — do not guess.
```

---

## 6 — Rate-limit `POST /v1/uploads`

```
Read apps/api-server/src/lib/ratelimit.ts and the existing callers
(routes/v1/niyam-submissions.ts:485-489, routes/v1/exams.ts:872-876).

POST /v1/uploads applies requireAuth and nothing else. It is the most expensive
authenticated endpoint in the API — 50 MB multipart, a full-buffer sharp re-encode, and a
disk or S3 write — and it is the only one with no limit. Niyam SUBMISSION is capped at
5/min and 20/hr, but the proof UPLOAD that precedes it is uncapped, so the throttle protects
the cheap half of the flow.

In apps/api-server/src/routes/v1/uploads.ts, before uploadMultipart runs (so a throttled
request never streams 50 MB to disk), add:

    upload:user:${uid}        60 per 3600s
    upload:burst:user:${uid}  10 per 60s

Return 429 with the existing rate-limit error code from lib/api-zod/src/errors.ts — do not
invent a new one. Include Retry-After. Bilingual message per CLAUDE.md.

Two notes on ratelimit.ts worth acting on while you are there:
- it no-ops entirely when NODE_ENV=test (line ~108), so your test must set an env override or
  call the limiter directly; do not delete the test no-op, other suites depend on it
- it fails OPEN on a Redis error (~line 106-119). That is the right call for OTP, but for a
  resource-consumption limit consider failing closed with 503 when Redis is unreachable, or
  at minimum log at warn level so the gap is visible.

Add tests: the 11th upload inside a minute is 429; a different user is unaffected; the 429
carries Retry-After and the standard error envelope.

Run `pnpm typecheck` and `pnpm test -- uploads`.
```

---

## 7 — iOS HEIC parity on the student photo picker

```
apps/jain-pathshala-mobile/hooks/useStudentPhotoPicker.ts (~lines 57-70) is the only picker
in the app that does not pass preferredAssetRepresentationMode. The other three all do —
NiyamProofPicker.tsx:274,308 · HomeworkProofPicker.tsx:148,170 · app/shikshak/homework.tsx:136,141
— sourcing it from lib/proof-media.ts:28, which carries a __DEV__ throw explicitly warning
"iOS would upload raw HEIC".

So the student ID-card photo is the one path that can ship raw HEIC from iOS. The server
converts HEIC→JPEG at lib/image-normalise.ts:53-62, but that depends on sharp being built
with HEIF decode, which the prebuilt binaries have historically omitted for libheif/x265
licensing reasons. If this deployment's sharp lacks it, iOS students hit
"Could not process this HEIC/HEIF photo" on their profile photo while their niyam proof
uploads fine — a confusing, platform-specific inconsistency.

Fix A — the client:
  import { PREFERRED_ASSET_REPRESENTATION_MODE } from "@/lib/proof-media";
  and add `preferredAssetRepresentationMode: PREFERRED_ASSET_REPRESENTATION_MODE` to BOTH the
  launchCameraAsync and launchImageLibraryAsync calls.

Fix B — verify the server. Run, in the api-server workspace:
  node -e "const s=require('sharp'); console.log(s.versions, JSON.stringify(s.format.heif))"
Report the output.
  - If heif.input.buffer is true, add a test in apps/api-server/test/image-exif.test.ts that
    uploads a real HEIC fixture and asserts a .jpg key with content_type image/jpeg and no
    EXIF GPS in the result.
  - If it is false, that is a deployment defect, not a code one: the HEIC branch in
    image-normalise.ts is dead and every HEIC upload 422s. Say so explicitly in your report
    and propose the fix (a sharp build with libheif, or heic-decode as a fallback dependency).
    Do not silently remove the HEIC entries from UPLOAD_MIME_TABLE.

Run `pnpm typecheck`.
```

---

## 8 — Video size, timeout and upload progress

```
Read apps/jain-pathshala-mobile/lib/upload-size-guard.ts (which already documents half of
this) and lib/api.ts:391.

Three related problems on the video path, all of which strand a parent AFTER they have
recorded the proof:

(a) No bitrate cap. videoMaxDuration: 30 limits duration but not quality, and no videoQuality
    is passed — so iOS records at native camera quality. A 30s 4K/60 clip is well over the
    50 MB MAX_UPLOAD_BYTES. And launchImageLibraryAsync ignores videoMaxDuration entirely, so
    a library pick has no bound at all.
(b) 120s timeout. api.ts:391 allows 120_000ms for video/audio. 50 MB over a rural-India mobile
    link will not finish; the parent waits two minutes and gets ERR_NETWORK with the bytes
    discarded.
(c) No progress. apiUpload uses fetch, which has no upload progress events, so a large upload
    shows an indeterminate "Uploading…" for minutes with no signal that anything is happening.

Fix (a): in NiyamProofPicker.tsx, pass
  videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium
to both launchCameraAsync and launchImageLibraryAsync (iOS-only, harmless on Android). Add it
alongside PREFERRED_ASSET_REPRESENTATION_MODE in lib/proof-media.ts as a shared constant so
every picker uses the same value.

Fix (b): scale the timeout by known file size instead of a flat 120s. Assume a 100 kB/s floor,
clamp to [120s, 900s]. apiUpload does not currently receive the size — thread the sizeBytes
that resolveLocalByteSize already computes in enqueueUpload through UploadFileInput as an
optional field.

Fix (c): switch apiUpload's native branch from fetch to XMLHttpRequest (available in RN) so
xhr.upload.onprogress can drive a percentage. Add an optional
`onProgress?: (fraction: number) => void` to apiUpload and render it on the ProofMediaItem
"Uploading…" row and the HomeworkProofPicker status line. Keep the web branch on fetch.
Preserve the existing 401-refresh-and-retry behaviour and the ApiError envelope parsing
exactly — those are load-bearing.

Add tests for the timeout calculation (a pure function — extract it) and update
upload-size-guard.test.ts if the guard's contract changes.

Run `pnpm typecheck` and the mobile vitest suite.
```

---

## 9 — Implement `media.cleanup_unfinalized`

```
Read CLAUDE.md (cron table: media.cleanup_unfinalized, daily 03:30 IST) and
apps/api-server/src/jobs/derived-data-jobs.ts:156-162, where the job is registered but the
body is a single logger.info() — a stub.

Nothing ever deletes an orphaned upload. Every abandoned pick, every failed submit, and (until
prompt 2 lands) every homework proof ever taken is a permanent file plus an upload_objects row.
There is no per-user quota either.

Implement the job:
- Find upload_objects rows older than 24 hours whose key is not referenced by any of:
  students.photo_url, homework_submissions.submission_url, homework_assignments.attachment_url,
  niyam_submission_media (or wherever niyam proof URLs land), gallery_items, library_items,
  id_cards. Grep for uploadKeyFromUrl callers to build the complete reference list — do not
  guess at the set of tables.
- For each orphan: storage.remove(key), then delete the upload_objects row. Batch it (500 at a
  time) and log the count. Never delete a row younger than 24h — an upload can legitimately sit
  unreferenced while a parent is mid-flow or offline.
- Dry-run first: put it behind MEDIA_CLEANUP_DRY_RUN (default true) that logs what it WOULD
  delete without deleting, so you can watch one production run before arming it.

Two schema notes:
- upload_objects has no size column (lib/db/src/schema/punya.ts:48-62). Add
  `size_bytes integer` in a migration and populate it in routes/v1/uploads.ts from
  stored.size — without it there is no way to report how much a cleanup reclaimed, or to
  enforce a per-user quota later.
- lib/idcard-render.ts:433 writes an "id-cards/" prefix and routes/v1/progress.ts:426 writes a
  "reports/" prefix, and "reports" is not in the folderSchema enum at all. Both are
  server-generated and must be EXCLUDED from cleanup regardless of reference status. Either
  add them to the enum with a comment marking them server-only, or maintain an explicit
  never-clean prefix list in the job. Do not let the job touch them.

Add tests: an orphan older than 24h is removed; an orphan younger than 24h is not; a
referenced key is never removed; a server-generated id-cards/ or reports/ key is never removed;
dry-run mode deletes nothing.

Run `pnpm typecheck` and `pnpm test`.
```

---

## 10 — Tighten the declared-MIME fallback, and the small stuff

```
Read apps/api-server/src/lib/upload.ts and routes/v1/uploads.ts:112-127.

(1) Narrow the declared-MIME fallback. At ~line 124:

      : detected == null && file.size > 0 && ALLOWED_MIME_TYPES.has(declared)
        ? declared

    When file-type cannot identify the bytes, the client's declared MIME is trusted for the
    WHOLE allowlist. file-type cannot identify HTML, SVG, JS or plain text, so arbitrary bytes
    declared application/pdf are stored as .pdf with content_type application/pdf. Images are
    safe (stripImageMetadata throws at ~line 150), but pdf/video/audio are not. XSS is blocked
    by nosniff plus a correct Content-Type on the serve path, so this is not urgent — but the
    comment says the fallback exists for "some wav/caf", and that is what it should cover.

    Replace the blanket allowlist test with an explicit narrow set:
      const MAGIC_UNKNOWN_FALLBACK_MIMES = new Set(["audio/wav", "audio/ogg"]);
    Anything else with unidentifiable magic → 422. Add a test that bytes declared
    application/pdf with no recognisable magic are now rejected, and that a real WAV whose
    magic file-type does not report still uploads.

(2) Add the missing multer limits. upload.ts:124 sets fileSize and files but not fields,
    parts or fieldSize, so a client can send thousands of text fields:
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 4, parts: 6, fieldSize: 1024 }
    Confirm handleMulterError maps LIMIT_FIELD_COUNT / LIMIT_PART_COUNT to a 422 envelope
    rather than falling through to the generic branch with unhelpful copy.

(3) middlewares/multer-error.ts:73 — the Hindi fallback string ends with "。" (a CJK
    ideographic full stop). Should be "।" or ".".

(4) lib/storage.ts:40 — makeKey's doc comment promises
    "<folder>/<yyyy>/<mm>/<uuid><ext>" but the implementation emits "<folder>/<uuid><ext>".
    Add the date segments (they make retention and per-month reporting far easier later, and
    prompt 9 will want them) and keep the comment, OR fix the comment. Do not leave them
    disagreeing. If you add them: uploadKeyFromUrl, the /uploads serve route and
    resolveOwnedUpload's startsWith(folderPrefix) all still work, since the prefix is
    unchanged — but verify, and check the seed data and any hardcoded test keys.

(5) lib/upload.ts:137 — `uploadMemory` is a deprecated alias with no importers
    (`git grep uploadMemory` to confirm). Delete it.

(6) lib/image-normalise.ts:44-48 — the GIF passthrough comment claims "GIF has no EXIF GPS in
    practice". True for GPS, but GIF can carry XMP. Narrow the comment so it does not read as
    a broader guarantee than it is.

Run `pnpm typecheck` and `pnpm test -- uploads`.
```

---

## Also worth doing, not prompted here

- **PDF submission from mobile.** `resolveOwnedUpload` accepts `["image","pdf"]` for homework and the web admin accepts PDFs, but the app has no `expo-document-picker` — so a parent photographing a multi-page worksheet has no PDF path on either platform. Either add the picker or document the restriction. Product decision, not a bug fix.
- **Niyam proofs have no offline queue.** `NiyamProofPicker.enqueueUpload` calls `apiUpload` directly; offline, the item goes `failed` and the local URI lives only in component state, so navigating away loses the proof. Homework proofs get `jp.queue.media_uploads`; niyam proofs get nothing, despite `jp.queue.niyam_submissions` being canonical in CLAUDE.md. Routing niyam through the same media queue is the right fix and is a larger change than fits in one prompt — do it after 1–5 land.
- **Video EXIF (`TODO(ffmpeg-video-exif)`).** Correctly mitigated today by never publishing video to the gallery. Add a regression test asserting a video niyam proof produces no `gallery_items` row, so the mitigation cannot be lost silently.
- **`LocalDiskProvider` is the production default** whenever `S3_BUCKET` is unset (`storage.ts:229-231`). On an ephemeral container filesystem that is silent data loss on every redeploy. Worth a startup assertion that refuses to boot with `NODE_ENV=production` and no S3 configured.
