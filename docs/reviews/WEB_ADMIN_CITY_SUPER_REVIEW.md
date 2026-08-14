# Web admin review — `city_admin` vs `super_admin`

App: Vite + wouter at `apps/jain-pathshala`. Nav: `src/components/admin/sidebar-nav.ts`. Shell: `AdminLayout` (any admin-panel role). **Sidebar hide is the main UI gate** — most pages have no route-level RoleGuard; deep-links can still load, with API 403 where enforced.

Legend: **Full** / **Partial** / **Blocked** for city_admin, then what super_admin adds.

---

## Overview

### Dashboard — `/admin`

**Does:** KPI snapshot + pending enrolments.  
**APIs:** `GET /v1/admin/analytics/overview`, enrolments pending.

| city_admin | super_admin |
|------------|-------------|
| Full (city-scoped) | Full (national totals) |

**Gaps:** Pending cards don’t deep-link to Enrolments. Sidebar marks Dashboard active for every `/admin/*` path.

---

## People

### Students — `/admin/students`

Create/list; soft deactivate/reactivate (Q11).

| city_admin | super_admin |
| Full in city | Full all cities |

**Gaps:** Thin edit UI; no impersonate from student row.

### Enrolments — `/admin/enrolments`

Approve / waitlist / reject; create.

| Both | Full in scope |

### MSV applications — `/admin/msv-enrolments`

Approve/reject (Q1 discretion).

| Both | Full in scope |

**Gaps:** Dead legacy `MsvEnrolmentsPage` export still in codebase, not routed.

### Shikshaks — `/admin/shikshaks`

Read-only list.

| Both | **Partial** — staffing is on **Centres → `/admin/centres/:id`** |

### ID Cards — `/admin/id-cards`

Generate one / generate-all.

| Both | Full in scope |

---

## Programme

### Batches — `/admin/batches`

Create/list; activate; assign batch shikshaks.

| Both | Full in scope |

### Courses — `/admin/courses`

Author tree, publish, archive; templates panel.

| city_admin | **Partial** — city standard courses only; can publish own; **no** MSV/national; **no** templates |
| super_admin | **Full** — MSV + national (Q2); course templates create/derive |

### Exams — `/admin/exams`

CRUD + release results + OTP visibility.

| city_admin | Full for city (UI city picker may list all cities; API should 403) |
| super_admin | Multi-city |

### Exam builder / grading

Questions authoring; grade subjective attempts.

| Both | Full in scope |

**Gaps:** Builder doesn’t always self-redirect if gate fails; grading does redirect.

### Niyams — `/admin/niyams`

Catalogue + create + toggle active.

| city_admin | **Partial** — create city scope; can’t toggle national/state |
| super_admin | National/state/city authoring |

### Niyam Review — `/admin/niyam-review`

Approve/reject queue (Q5 on API).

| Both | Full for reachable submissions |

### Homework — `/admin/homework`

Assignments + grade / grade-all.

| Both | Full in scope |

### Student Progress — `/admin/progress`

Mark progress/certify; generate/release progress reports.

| Both | Full in scope |

### Competitions — `/admin/competitions`

Create; open/close; roster; publish results (+ Punya).

| city_admin | Partial (city-scoped; picker may be wide) |
| super_admin | All cities |

### Quizzes — `/admin/quizzes`

Bank, events, push quizzes, attempts.

| city_admin | Partial — `city|centre|batch` only |
| super_admin | + national/state scopes |

### Shivirs — `/admin/shivirs`

List + create (published immediately).

| Both | **Partial** — weak edit/unpublish UX |

### Award Punya — `/admin/punya/manual-award`

Manual award to a student.

| Both | Full in scope |

### Punya configs / audit

Feature point configs; transaction ledger.

| Both | **Partial** — create/list configs, no rich edit/deactivate; audit read-only |

---

## Operations

### Centres — `/admin/centres` (+ `/:id` staff)

List/create; staff sanchalaks/shikshaks; batch tagging.

| city_admin | Full in city |
| super_admin | Any city |

**Gaps:** List page weak on edit/deactivate centre metadata.

### Holiday calendar — `/admin/holidays`

CRUD/publish centre holidays (AT30).

| Both | Full in scope |

### Attendance — `/admin/attendance`

Centre log + mark roster (no GPS check-in — mobile-first).

| Both | Full in scope |

### Notices — `/admin/notices`

CRUD; public/pin/critical; optional translate.

| city_admin | **Partial / risk** — UI may offer national/state/msv; API must block |
| super_admin | Legitimate national author |

### Gallery — `/admin/gallery`

Upload; visibility; feature; delete.

| Both | Full in scope |

### Media curation — `/admin/media-curation`

Home / Punya Wall feature queue (consent-aware).

| city_admin | Full for own city |
| super_admin | City filter across network |

### Library — `/admin/library*`

Sections/items/audio/Panchang drafts.

| city_admin | **Partial** — author only; **cannot publish** |
| super_admin | Publish/unpublish + orphan cleanup |

**Gap:** City drafts can stall without a publish handoff.

### Donations — `/admin/donations`

Campaigns + donations list.

| Both | **Partial** — view only; no campaign create / 80G UI (Q3 lives in settings API) |

### Service requests — `/admin/service-requests`

Centre/city SR inbox.

| Both | Full in scope |

### Shivir attendance — `/admin/shivir-dashboard`

Scanner sessions / counts (AT28 separate from Pathshala %).

| Both | Full for accessible shivirs |

### Enquiries — `/admin/enquiries`

Public contact/enquire/donate inbox.

| city_admin | **Full UI but API is org-wide** — not city-scoped (privacy gap) |
| super_admin | National inbox (expected) |

---

## Insights

### Analytics — `/admin/analytics`

Overview + engagement trend.

| Both | Full for scope |

### Reports — `/admin/reports`

Monthly centre PDF generate/download.

| Both | Full for centres in scope |

### Audit log — `/admin/audit`

Append-only admin audit.

| city_admin | **Blocked** (nav + API: state_admin+) |
| super_admin | Full |

---

## System

### Registration forms — `/admin/registration-forms`

Publish form configs; approve/reject responses.

| city_admin | Partial (city implied) |
| super_admin | Global or any city |

### Join registrations — `/admin/join`

student / shikshak / sanchalak queues; open/close registration.

| Both | Full for all three kinds (city_admin+) |

### Geography — `/admin/geography`

States/cities list; add state/city.

| city_admin | **Blocked** in nav |
| super_admin | Mutate geography |

### Settings — `/admin/settings`

Key/value display.

| city_admin | **Blocked** in nav |
| super_admin | **Partial** — can **see**; **no edit UI** despite PATCH API (80G/client settings gap) |

### Queues — `/admin/queues`

BullMQ stats + DLQ replay.

| city_admin | **Blocked** |
| super_admin | Full |

**Gaps:** Default queue name may be stale vs live `QUEUE_NAMES`. Impersonation: **stop** banner exists; **start** is API-only (no admin UI).

---

## Complete nav inventory

| Section | Path | Min role | city_admin | super_admin |
|---------|------|----------|------------|-------------|
| Overview | `/admin` | shikshak | yes | yes |
| People | `/admin/students` | shikshak | yes | yes |
| People | `/admin/enrolments` | sanchalak | yes | yes |
| People | `/admin/msv-enrolments` | city_admin | yes | yes |
| People | `/admin/shikshaks` | sanchalak | yes | yes |
| People | `/admin/id-cards` | city_admin | yes | yes |
| Programme | `/admin/batches` | sanchalak | yes | yes |
| Programme | `/admin/courses` | city_admin | yes | yes |
| Programme | `/admin/exams` (+ builder, grading) | city_admin + gate | yes | yes |
| Programme | `/admin/niyams`, niyam-review, homework, progress | shikshak | yes | yes |
| Programme | competitions, quizzes, shivirs | city_admin | yes | yes |
| Programme | punya award / configs / audit | shikshak or city_admin | yes | yes |
| Operations | centres, holidays, attendance, notices, gallery | shikshak/sanchalak | yes | yes |
| Operations | media-curation, library, donations, shivir-dashboard, enquiries | city_admin | yes | yes |
| Operations | service-requests | sanchalak | yes | yes |
| Insights | analytics, reports | sanchalak | yes | yes |
| Insights | audit | **state_admin** | **no** | yes |
| System | registration-forms, join | city_admin / shikshak | yes | yes |
| System | geography, settings | **state_admin** | **no** | yes |
| System | queues | **super_admin** | **no** | yes |

---

## Side-by-side summary

| Area | city_admin | super_admin |
|------|------------|-------------|
| Day-to-day city ops | Full | Full (all cities) |
| MSV applications | Full | Full |
| Courses | City standard + publish | + MSV/national + templates |
| Library | Draft only | + Publish |
| Exams / quizzes / competitions / shivirs | City-scoped | Network-wide / broader scopes |
| Media curation | Own city | Multi-city |
| Donations | View | View (same thin UI) |
| Audit / Geography / Settings / Queues | Hidden | Visible; Settings still not editable in UI |
| Impersonate | No | API only, weak UI |
| Enquiries | Sees **all** (over-broad) | Sees all |

---

## Highest-priority web gaps

1. **No route RoleGuard** on state/super pages — deep-link risk.
2. **Enquiries** not city-scoped for city_admin.
3. **City pickers** often load full geography (exams, competitions, notices, shivirs).
4. **Settings** read-only — cannot manage 80G / platform toggles in UI.
5. **Impersonation start** missing from UI.
6. **Library publish handoff** — city drafts need super to go live.
7. **Dead exports** in `AdminListPages.tsx` (old Notices/Gallery/MSV/Audit/SR).
8. **Donations / Shikshaks / Punya configs** thin.
9. **Sidebar Dashboard** always highlighted.
10. **Queues** possible stale queue id.

---

## How to use this as an admin

- **City admin:** Treat web as the real console for programme (courses, exams, quizzes, MSV, library drafts, media). Mobile is a sanchalak-shaped subset.
- **Super admin:** Use web for national content, library publish, MSV curriculum, geography, queues; don’t expect Settings/impersonate to be fully productized in UI yet.

*Last updated: August 2026*
