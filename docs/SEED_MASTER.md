# Seed master — complete inventory

Authoritative map of what `pnpm --filter @workspace/db run seed` creates.  
Sources: [`lib/db/src/seed.ts`](../lib/db/src/seed.ts), [`lib/db/src/seed-indore.ts`](../lib/db/src/seed-indore.ts).

> **Destructive.** The seed **TRUNCATE**s domain tables (`CASCADE`) then re-inserts.  
> Never run against production.

---

## How to run

```bash
# From repo root. Requires DATABASE_URL (and ALLOW_SEED=1).
# NODE_ENV must NOT be production.
set ALLOW_SEED=1          # PowerShell: $env:ALLOW_SEED="1"
pnpm --filter @workspace/db run seed
```

Guards in `seed.ts`:

| Condition | Result |
|-----------|--------|
| `NODE_ENV=production` | Exit 1 — refused |
| `ALLOW_SEED` ≠ `1` | Exit 1 — refused |

Optional after seed (same script): digital ID card PNG generation via  
`apps/api-server/scripts/generate-id-cards-for-seed.ts` (needs `JP_AUTH_SECRET`).

### Related one-off seeds (not in main seed)

| Script | Purpose |
|--------|---------|
| `node scripts/seed-jain-sutras-course.mjs` | Active **Jain Sutras** course (16 sections / 41 subsections) for Indore |

---

## Layer A — Master / reference data

Must exist for awards, OTP (dev), and codes to work.

### A1. Punya feature catalogue (`punya_features`)

| key | label | max_points |
|-----|-------|------------|
| `attendance` | Attendance | 10 |
| `niyam_completion` | Niyam completion | 1000 |
| `homework` | Homework approved | 10 |
| `homework_starred` | Homework starred | 12 |
| `exam_completion` | Exam completion (pass) | 500 |
| `exam_top_score` | Exam top score | 500 |
| `quiz_participation` | Quiz participation | 5 |
| `quiz_win` | Quiz win | 25 |
| `push_quiz_completion` | Push quiz completion | 5 |
| `manual_award` | Manual admin award | 500 |
| `course_section_certified` | Course section certified | 1000 |
| `course_completed` | Course completed | 2000 |

### A2. Global punya point configs (`punya_configs`, `city_id` null)

| feature_key | points | notes |
|-------------|--------|-------|
| `exam_completion` | 20 | |
| `exam_top_score` | 50 | |
| `quiz_participation` | 5 | |
| `quiz_win` | 25 | |
| `push_quiz_completion` | 5 | |
| `course_section_certified` | 100 | CU22 multiplier (100 = 1×) |
| `course_completed` | 100 | CU22 multiplier |

**Gap (known):** seed does **not** insert global configs for `attendance`, `niyam_completion`, `homework`, `homework_starred`. Runtime may fall back to feature defaults / code paths — verify before relying on awards in a fresh env.

### A3. Manual award limits (`punya_award_limits`)

| role | max_points_per_award | max_points_per_day |
|------|----------------------|--------------------|
| `shikshak` | 10 | 50 |
| `sanchalak` | 25 | 150 |
| `city_admin` | 100 | 500 |
| `state_admin` | 250 | 1000 |
| `super_admin` | 500 | unlimited (`null`) |

### A4. Geography

| State | Code | Cities |
|-------|------|--------|
| Maharashtra | MH | Mumbai (`MUM`), Pune (`PUN`) |
| Gujarat | GJ | Ahmedabad (`AMD`) |
| Madhya Pradesh | MP | Indore (`IDR`) |

### A5. Platform settings (`settings`)

| key | value | notes |
|-----|-------|-------|
| `gallery_carousel_interval_ms` | `2000` | |

OTP for local login is controlled by env (`OTP_ENABLED` / `DEFAULT_OTP` in `apps/api-server/.env`), not a settings row.

### A6. Entity code counters (`entity_code_counters`)

Seeded so next minted codes continue the series (STU/PAR/CAD/SAD/SHK/SAN/MSV scopes for MUM, PUN, IDR, MH, MP, centre scopes).

---

## Layer B — Personas (login users)

Dev OTP: set `OTP_ENABLED=false` and `DEFAULT_OTP=123456` in `apps/api-server/.env` (or enable live SMS with `OTP_ENABLED=true`).

### B1. Mumbai / national

| Role | Phone | Name | Scope |
|------|-------|------|-------|
| `super_admin` | `+919800000001` | Super Admin | national |
| `state_admin` | `+919800000002` | Maharashtra State Admin | MH |
| `city_admin` | `+919800000003` | Mumbai City Admin | Mumbai |
| `sanchalak` | `+919800000004` | Centre Sanchalak | Mumbai / Ghatkopar centre |
| `shikshak` | `+919800000005` | Pathshala Shikshak | Mumbai batches |
| `parent` | `+919800000006` | Student Parent | gallery opt-in |
| `student` | `+919800000007` | Aarav Shah | student user row |

### B2. Indore (Madhya Pradesh)

| Role | Phone | Notes |
|------|-------|-------|
| `state_admin` | `+919800000011` | MP |
| `city_admin` | `+919800000012` | Indore |
| `sanchalak` | `+919800000013` | + multi-centre sanchalaks `+919800002020…` |
| `shikshak` | `+919800000014` | + more shikshaks `+919800002030…` |
| `parent` | `+919800000015` | 3 children; more parents `+919800002040…` |
| `student` | `+919800000016` | Reyansh Jain / `IDR-STU-00001` |

---

## Layer C — Org network (centres / batches / students)

### C1. Mumbai / Pune centres (main seed)

- Multiple centres (incl. Ghatkopar-style demo Pathshala + Pune)
- Batches by age group (`bal` / `kishor` / `tarun` / …)
- Sanchalak / shikshak centre + batch assignments
- Students + enrolments + sample MSV enrolments

### C2. Indore network (`seed-indore.ts`)

| Item | Count / detail |
|------|----------------|
| Centres | **5** — Sapna Sangeeta, Race Course, Vijay Nagar, Palasia, Bhawarkua |
| Batches / centre | **3** — Bal / Kishor / Tarun (Sunday timings) |
| Students / centre | **~15–20** (mixed single- and multi-child parents) |
| Staffing | Many↔many sanchalak/shikshak assignments |

Centre codes: `IDR-SAP`, `IDR-RCR`, `IDR-VIJ`, `IDR-PAL`, `IDR-BHA`.

---

## Layer D — Domain demo content

| Domain | What seed inserts |
|--------|-------------------|
| **Sessions + attendance** | Rolling history for Mumbai batches; marks present/late/etc. |
| **Niyams** | 4 master niyams (daily Navkar, Chauvihar, weekly Samayik, monthly Pratikraman) |
| **Niyam submissions** | Auto-approved history + media + gallery features |
| **Punya** | Transactions + balances for seeded students |
| **Notices** | Sample centre/city notices |
| **Shivirs** | Sample shivir events |
| **Library** | Sample library items (incl. embed-style) |
| **Courses** | Sample draft/active courses + sections/subsections + progress |
| **Exams** | Online exam + questions/options + attempts |
| **Donations** | Campaign + sample donations |
| **Homework** | Assignment + starred/pending submissions |
| **Registration** | Form config + sample responses |
| **Service requests** | Ticket + messages |
| **Progress reports** | Sample rows |
| **Audit logs** | Sample admin actions |
| **Competitions** | Event + registrations |
| **Quizzes** | Question bank + quiz event + push quiz |
| **Enquiries** | Public enquire rows |
| **Queues** | Sample `queue_stats` + DLQ rows |
| **ID cards** | Generated post-seed (PNG + QR) when script succeeds |

---

## Layer E — Truncate list (everything wiped)

Seed clears (among others):  
`users`, `states`, `cities`, `centres`, `batches`, students/enrolments, attendance/sessions, punya_*, niyams/*, notices, shivirs, library, gallery, courses/*, exams/*, donations/*, homework/*, registration_*, service_requests/*, quizzes/*, competitions/*, enquiries, settings, audit_logs, entity_code_counters, queue_*, sync_operations, digital_id_cards, …

Full SQL list: top of [`seed.ts`](../lib/db/src/seed.ts) `truncate table …`.

---

## Recommended seeding strategy by environment

| Environment | What to run |
|-------------|-------------|
| **Local / QA demo** | Full `ALLOW_SEED=1` seed + optional Jain Sutras script |
| **Staging (shared)** | Full seed once, then stop re-running (wipes data) |
| **Production (E2E VM)** | **Do not run this seed.** Bootstrap masters manually or via a future non-destructive `seed-master` (geography + punya_features/configs/limits + settings without OTP). Create real admins via OTP. |

---

## Post-seed smoke checklist

1. API health: `GET /api/healthz`  
2. Login as `+919800000001` with OTP `123456` (dev only)  
3. Parent `+919800000006` / Indore parent `+919800000015` — children visible  
4. Shikshak — today’s sessions / attendance  
5. Courses catalogue — after Jain Sutras script if used  
6. Punya balance non-zero for seeded students with submissions  

---

## File map

```
lib/db/src/seed.ts              ← full destructive seed (orchestrator)
lib/db/src/seed-indore.ts       ← Indore 5-centre network
scripts/seed-jain-sutras-course.mjs  ← optional curriculum content
apps/api-server/scripts/generate-id-cards-for-seed.ts
docs/SEED_MASTER.md             ← this file
```

---

*Last aligned with `lib/db/src/seed.ts` / `seed-indore.ts` — Aug 2026.*
