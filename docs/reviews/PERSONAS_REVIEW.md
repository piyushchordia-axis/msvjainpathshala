# Persona review — all eight roles

Hierarchy (high → low):

`super_admin` → `state_admin` → `city_admin` → `sanchalak` → `shikshak` → `parent` → `student` → `guest`

Login is always **phone + OTP**. Role comes from `users.role` after verify — no role picker. Mobile routing: `apps/jain-pathshala-mobile/lib/roles.ts` (`routeForRole`). Scope: `apps/api-server/src/lib/scope.ts`.

---

## How entry works

| Persona | Lands on (mobile) | Web admin |
|---------|-------------------|-----------|
| guest | `/guest/home` | Public site only |
| parent | `/parent/home` | Rejected (“use the mobile app”) |
| student | `/student/home` | Rejected |
| shikshak | `/shikshak/today` | Yes (scoped panel) |
| sanchalak / city / state / super | `/admin/dashboard` | Yes (nav filtered by `min` role) |

`PersonaTabs` keeps each shell role-locked. Shared stack screens live under `app/_layout.tsx`.

---

## Scope model

| Role | Centres | Batches (writes) |
|------|---------|------------------|
| super_admin | All | All |
| state_admin | Centres in `state_id` | All in those centres |
| city_admin | Centres in `city_id` | All in those centres |
| sanchalak | Assigned centres | All batches in those centres |
| shikshak | Tagged centres (read) | **Only** assigned batches (`inBatchWriteScope`) |
| parent | — | Own children only |
| student | — | Self only |
| guest | — | Public data only |

Higher role without the right centre/batch still gets **denied** — hierarchy alone is not enough.

---

## Capability matrix (by domain)

| Domain | Guest | Parent | Student | Shikshak | Sanchalak | City+ | State+ | Super |
|--------|-------|--------|---------|----------|-----------|-------|--------|-------|
| Attendance | — | History + leave notify | History | Mark / check-in (batch) | Oversight / alerts | Scoped admin | Scoped | Full |
| Niyam | — | Submit | Submit | Decide (batch) | Decide (centre) | Review | Review | Review + define |
| Homework | — | Submit | Submit | Assign / grade | Assign / grade | Same | Same | Same |
| Courses | Public browse | Child progress | Self (≥13 write) | Certify (batch) | Certify | Author standard | Author | + MSV/national |
| Library | Public | Use + offline | Use | Use | Use | Draft | Draft | **Publish** |
| Notices | Public | Feed | Feed | Author | Author | Author | Author | Author |
| Notifications | — | Inbox | Inbox | Inbox | Inbox | Inbox | Inbox | Inbox |
| Quiz / Exam / Comp | — | Take (child) | Take | — on mobile home | — mobile | **Web admin** | Web | Web |
| Gallery | Public wall | Browse; Q6 opt-in | Browse | Browse | Centre gallery | Feature media | Feature | Feature |
| Join / enrol | Apply | — | — | Approve student | + shikshak | + sanchalak | + | + |
| Impersonate / queues | — | — | — | — | — | — | — | Yes |

---

## Persona-by-persona

### 1. Guest

**Job:** Discover Pathshala and start join / sign-in.  
**Mobile:** Sign in, Centres, Shivirs, Library, Notices, More.  
**Can:** Public library (gated shells), public notices, public courses API, registration journey.  
**Cannot:** Anything authenticated.  
**Gap:** Guest browse paths parallel signed-in browse; Courses public API is easy to miss from guest chrome.

### 2. Parent

**Job:** Run the child’s Pathshala life.  
**Mobile:** Home, Children, Niyams, Library, Profile + Quick Actions.  
**Can:** Multi-child via `ChildSwitcher`; submit niyam/homework; absences; gallery visibility; MSV apply (API); ID card.  
**Cannot:** Admin panel, mark attendance, approve niyam, certify courses.  
**Gap:** CLAUDE’s **parent → student view toggle** (`POST /v1/auth/switch-view`) is **not shipped**. Today a “student” is a separate OTP login.

### 3. Student

**Job:** Learner on their own account.  
**Mobile:** Home, Punya, Niyams, Library, Profile.  
**Can:** Same learner flows for self; course writes blocked under 13.  
**Cannot:** Siblings, gallery consent, admin.  
**Gap:** Spec vs code: separate login, not parent toggle. Parent and student homes are near-duplicates.

### 4. Shikshak (Guruji / Didi)

**Job:** Day-of-class operations.  
**Mobile:** Today → attendance; Students; Batches; Homework; Profile; niyam review, courses, punya, join (student). Strongest **offline** persona.  
**Web:** Overlapping panel — not centres create, exams, quizzes, donations.  
**Can:** Mark attendance (batch); homework; certify courses; decide niyam in own batches.  
**Cannot:** Writes outside assigned batches; feature media; exams admin; donations; publish library.  
**Gap:** Best mobile day-to-day UX; no mobile “fire push quiz”.

### 5. Sanchalak

**Job:** Centre head / safety net.  
**Mobile:** Dashboard, Students, Enrolments, Batches, Profile + manage actions. Offline sync yes.  
**Web:** Centres/batches/enrolments/gallery/SR/analytics — not MSV apps, exams, quizzes, library publish, donations.  
**Can:** Whole-centre writes; approve student + shikshak join; niyam when shikshak can’t.  
**Cannot:** Feature media (city+); exam admin; donations; approve sanchalak join kinds.  
**Gap:** Mobile shell shared with city/state/super without filtering Quick Actions (API still enforces).

### 6. City admin

**Job:** City operations and programme authoring.  
**Mobile:** Same `/admin/*` shell as sanchalak — not a full city console.  
**Web:** Real power — MSV, ID cards, courses, exams, quizzes, competitions, library drafts, donations, media curation.  
**Can:** All centres in city; join settings; standard course author.  
**Cannot:** MSV/national course kinds (Q2); library publish; impersonate; queues.  
**Gap:** Mobile ≠ web. Offline sync loop is **not** started for city_admin (only shikshak + sanchalak).

### 7. State admin

**Job:** State oversight.  
**Mobile:** Same sanchalak-like shell.  
**Web:** State-wide nav + city+ programme tools; audit, geography, settings visibility.  
**Can:** All centres in state.  
**Cannot:** Impersonate; library publish; MSV course kinds; queue DLQ; many geography mutations are super-only.  
**Gap:** Nav vs API mismatch on geography/settings.

### 8. Super admin

**Job:** National authority.  
**Mobile:** Still the sanchalak-shaped admin shell.  
**Web:** Full nav — Queues, Geography, Settings, Impersonation, library publish, MSV/national courses.  
**Can:** Unscoped; publish library; MSV curriculum; impersonate (two audit rows).  
**Cannot:** Impersonate another super_admin (by design).  
**Gap:** System tools are web-first; mobile underrepresents the role.

---

## Hard gates

| Gate | Effect |
|------|--------|
| `requireAdminPanel` | parent / student / guest blocked from admin APIs |
| `inBatchWriteScope` | Shikshak writes limited to batches |
| Q2 / `assertMayAuthorCourseKind` | MSV/national courses → super only |
| Exams / feature media / donations | city_admin+ |
| Library publish | super_admin only |
| Join kinds ladder | shikshak ⊂ sanchalak ⊂ city+ |
| Q5 | Niyam reject window 30 days |
| Impersonation | super_admin only |

---

## Cross-persona issues (priority)

1. **Student view toggle missing** — CLAUDE Q4 vs real `student` role login.
2. **One mobile admin shell for four roles** — city/state/super look like sanchalak.
3. **Offline only for Guruji + Sanchalak**.
4. **Parent ≈ student UI** — shared activity grid.
5. **Web nav vs API** — Geography/Settings shown to state_admin; mutations often super-only.
6. **Guest Courses orphaned** — API/screens exist; guest chrome doesn’t push them.
7. **MSV** — parent apply exists; city MSV admin is web; mobile mostly shows a badge.

---

## Shell cheat sheet

| Group | Layout | Allowed |
|-------|--------|---------|
| Guest | `app/guest/_layout.tsx` | Unauthenticated |
| Parent | `app/parent/_layout.tsx` | `parent` |
| Student | `app/student/_layout.tsx` | `student` |
| Shikshak | `app/shikshak/_layout.tsx` | `shikshak` |
| Admin | `app/admin/_layout.tsx` | super / state / city / sanchalak (**not** shikshak) |

Key files: mobile `lib/roles.ts`, `QuickActions.tsx`, `SessionViewContext.tsx`; API `scope.ts`, `roles.ts`; web `sidebar-nav.ts`.

**Bottom line:** Shikshak and parent are the most complete **mobile** personas. Sanchalak is complete as centre ops. City/state/super are **web-first** roles wearing a sanchalak mobile costume. Guest is solid for browse/join. Student works as a separate login, not as the specified parent toggle.

*Last updated: August 2026*
