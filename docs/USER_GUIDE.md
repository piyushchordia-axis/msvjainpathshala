# Jain Pathshala — User Guide (all personas)

**Product:** Jain Pathshala (Megh Sanskar Vatika)  
**Surfaces:** Mobile app (main for families & Gurujis) · Web admin (city/state/super & centre ops)  
**Sign-in:** Mobile number + OTP only. There is no password and no role picker — your role is set on your account.

**Terms (same in English & Hindi):** Pathshala, Punya, Guruji / Didi, Sanchalak, Niyam, Shivir.

---

## 1. Guest (not signed in)

### Who you are

Anyone browsing before joining or signing in.

### How to start

Open the app → **Sign in** tab (or guest home). Or use the public website for centres, library, notices, and join forms.

### What you can do

| Task | Where | Steps |
|------|--------|--------|
| Browse centres | Centres tab / More | Open a centre for address & info |
| Browse Shivirs | Shivirs tab | See published events |
| Digital library | Library | Open Stavan & Bhakti, Panchang, Courses; login-gated items ask you to sign in |
| Notices | Notices | Read public announcements |
| Join Pathshala | Library tile **Join Pathshala**, or More → Registration / Join | Start student / shikshak / sanchalak journey |
| Sign in | Sign in / phone screen | Enter +91 number → OTP → you land on your role home |

### What you cannot do

Attendance, Niyam submit, homework, personal notifications, marking class, admin tools.

### Tips

- Bookmark items in the library on this device (stored locally).
- Courses can be browsed without signing in (outline only — no progress).
- Registration journey stays on guest home even after Join is hidden for signed-in users.

---

## 2. Parent (Abhivaavak)

### Who you are

Guardian of one or more children enrolled (or joining) Pathshala.

### Home

After OTP → **Parent home**. Tabs: **Home · Children · Niyams · Library · Profile**.

### Everyday tasks

**Switch child**  
Use the child switcher on home (and on homework / courses / quizzes). Everything below applies to the **active child**.

**Student ID & ID card**  
On home, see **Student ID**. Tap **ID Card** (primary button) to view / update photo / digital card.

**Attendance**  
Home or Quick Actions → Attendance. See calendar & %. Use **Notify leave** for planned absences (so Guruji can mark excused).

**Niyam**  
Niyams tab or Quick Actions → pick Niyam → add proof if required → submit. Track pending / approved and streaks. Rejection can happen within 30 days of an awarded submission.

**Homework**  
Quick Actions → Homework. Submit photo/file or mark done. See returned / graded work.

**Courses**  
Open Courses → pick course → mark progress (uncertified nodes). Certificates from Quick Actions when issued. Guruji certifies for Punya.

**Quizzes / Exams / Competitions**  
Quick Actions → take quiz or exam for the active child; register for open competitions.

**Library**  
Same digital library as guest, plus login-only sections. Offline audio download; bookmarks; Downloads / Bookmarks from library header.

**Notices & notifications**  
Browse notices; open **Notifications** for push/inbox (attendance marked, homework, Niyam, etc.).

**Gallery privacy**  
Profile → gallery visibility: one opt-in for **all** children (affects what appears on public gallery).

**Service requests / MSV**  
Raise service requests where offered. MSV application is available via join/MSV flows when your centre runs the programme (admin decides approval — no score gate).

### What you cannot do

Mark attendance, approve Niyams, create homework, open web admin.

---

## 3. Student

### Who you are

A learner with your **own** OTP login (`student` role), age 8+ for full course actions.

### Home

After OTP → **Student home**. Tabs: **Home · Punya · Niyams · Library · Profile**.

### Everyday tasks

Same learner flows as a parent acting for one child: attendance history, Niyam, homework, courses, quizzes, exams, competitions, library, notifications, ID card.

### Differences from parent

- No Children tab / no siblings.
- No gallery consent control (parent owns that).
- Course progress may be blocked if under 8, or if your date of birth is not on record — your parent can update it for you either way.

### Note

The product spec describes a “student view” switch on a **parent** account. Today the app uses a **separate student login**, not that toggle.

---

## 4. Shikshak (Guruji / Didi)

### Who you are

Teacher assigned to one or more **batches**.

### Home

After OTP → **Today**. Tabs: **Today · Students · Batches · Homework · Profile**.

### Everyday tasks

**Start / end class (optional GPS)**  
Today → session → Check in / Check out. GPS helps verify location; **you can still mark attendance without check-in**.

**Mark attendance**  
Open session → mark Present / Absent (and excused when leave was notified). Works **offline** — marks sync when online. Late is full attendance in the system; excused does not hurt %.

**Homework**  
Homework tab → create assignment for a batch → grade submissions (approve / star / return).

**Niyam review**  
Quick Actions / Niyam review → approve or reject with a clear reason (20+ characters). You can only **decide** for students in **your batches**; you may still **see** centre backlog.

**Courses**  
Open courses admin/browse → update progress or **certify** a student on a section (batch-scoped). Certification awards Punya.

**Students & Punya**  
Students list; Punya standings / award where offered.

**Join approvals**  
Approve **student** join requests in your scope (not sanchalak applications).

**Notices**  
Create/read notices for your centre/batch (web and/or mobile depending on setup).

**Shivir scan**  
Where enabled: scan student ID-card QR for Shivir attendance (separate from Pathshala %).

### Web admin

You can use the web panel for overlapping tools (students, attendance, homework, niyam, join). You do **not** get city exams/quizzes/donations/library publish.

### What you cannot do

Writes for batches you are not assigned to; feature gallery nationally; administer exams; manage donations; publish library.

### Tips

- Prefer marking even if GPS fails — class must not be lost.
- Keep the app online after class so offline marks sync.

---

## 5. Sanchalak (centre head)

### Who you are

Responsible for one or more **centres**.

### Home

After OTP → **Admin dashboard**. Tabs: **Dashboard · Students · Enrolments · Batches · Profile**, plus Manage quick actions.

### Everyday tasks

**Centre oversight**  
Dashboard KPIs; students; batches; enrolments approve/reject.

**Attendance safety net**  
Attendance alerts (consecutive absences, sessions with no marks, GPS flags). You can review logs even when Guruji forgot check-in.

**Holidays**  
Holiday calendar — add centre holidays (future empty sessions are adjusted).

**Niyam review**  
Full **centre** reach when a batch has no Guruji — clear the pending queue on mobile.

**Homework / courses**  
Assign and grade across the centre; certify within centre scope.

**Notices / gallery / service requests / reports**  
Centre communications, gallery moderation, SR inbox, monthly reports.

**Join**  
Approve **student** and **shikshak** registrations for your centres.

**Offline**  
Like Guruji, your device can sync offline attendance/homework ops.

### Web admin

Strong for centres, batches, enrolments, gallery, SR, analytics, reports. **Not** the place for city exams, quizzes, MSV applications, donations, or library publish.

### What you cannot do

Feature media to national walls (city+); run exams admin; donations; approve **sanchalak** join kinds; national library publish.

---

## 6. City admin

### Who you are

Operate Pathshala for **one city**.

### Mobile

You land on the **same admin shell as Sanchalak**. Use it for centre ops; use **web admin** for city programme tools.

### Web admin — primary console

**People:** Students, Enrolments, **MSV applications**, Shikshaks (list), **ID Cards**.  
**Programme:** Batches, **Courses** (city standard — publish OK; not MSV/national), **Exams / builder / grading**, Niyams (city), Niyam review, Homework, Progress, **Competitions**, **Quizzes**, **Shivirs**, Punya award/configs/audit.  
**Operations:** Centres & staff, Holidays, Attendance, Notices, Gallery, **Media curation**, **Library (draft only)**, Donations (view), Service requests, Shivir attendance, Enquiries.  
**Insights:** Analytics, Reports.  
**System:** Registration forms, Join (all kinds including sanchalak), open/close registration.

### What you cannot do (web)

Audit log, Geography mutate, Settings, Queues, library **publish**, MSV/national **course** authoring, impersonation.

### Tips

- Draft library content, then ask a **super admin** to publish.
- Prefer web for exams, quizzes, MSV, and ID card bulk generate.

---

## 7. State admin

### Who you are

Oversight across **all centres in a state**.

### Mobile

Same admin-style shell (limited vs web).

### Web admin

Everything a city admin can do, **across the state**, plus:

- **Audit log**
- **Geography** (usually view; creating states/cities is typically super-only)
- **Settings** (view; editing may be limited in UI)

### What you cannot do

Impersonate users; library publish; MSV course kinds; queue / DLQ tools; often cannot mutate geography even if you see the page.

---

## 8. Super admin

### Who you are

National authority for the whole network.

### Mobile

Same admin shell as Sanchalak — **not** a full national console. Use **web** for system work.

### Web admin — full sidebar

All city/state tools, plus:

- **MSV / national courses** and **course templates**
- **Library publish / unpublish**
- **Queues** (job stats, DLQ replay)
- **Geography** create state/city
- **Settings** view (API can patch; UI may be read-only today)
- **Impersonation** (API / limited UI — use carefully; actions are audited)

### Rules to respect

- Impersonation writes audit entries; do not impersonate another super admin.
- MSV curriculum edits are super-only even if someone calls the API as city admin.
- Students are never hard-deleted — deactivate only.

---

## Quick “who does what” cheat sheet

| I want to… | Who |
|------------|-----|
| Browse before joining | Guest |
| Track my child’s attendance / Niyam / homework | Parent |
| Study on my own login | Student |
| Mark today’s class | Shikshak |
| Clear stranded Niyams / centre holidays / alerts | Sanchalak |
| Run exams, quizzes, MSV apps, ID cards for a city | City admin (web) |
| State-wide audit & oversight | State admin (web) |
| Publish library, MSV courses, queues, geography | Super admin (web) |

---

## Shared tips for everyone

1. **OTP** expires quickly; request a new one if it fails.
2. **Punya** comes from attendance, approved Niyams, homework grades, course certification, quizzes/exams/competitions — not from browsing the library.
3. **Offline:** Guruji/Sanchalak attendance & homework sync when back online; open the app connected after class.
4. **Hindi / English:** Switch language in profile/settings where available; religious terms stay untranslated.
5. **Support:** Parents use service requests; public users use Enquire / Contact (city admin sees enquiries on web).

---

## Glossary

| Term | Meaning |
|------|---------|
| Pathshala | The learning centre / programme |
| Guruji / Didi | Shikshak (teacher) |
| Sanchalak | Centre head |
| Niyam | Daily/weekly spiritual practice with optional proof |
| Punya | Points / merit ledger |
| Shivir | Camp / intensive event (attendance separate) |
| MSV | Special enrolment track — admin discretion |

*Last updated: August 2026*
