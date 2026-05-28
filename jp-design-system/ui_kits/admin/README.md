# Admin UI Kit — Jain Pathshala (Next.js web)

Hi-fi prototype of the web admin panel used by **Sanchalak**, **City Admin**, and **Super Admin**.

| File | Purpose |
|---|---|
| `index.html` | Stage — browser chrome wrapping the kit |
| `browser-window.jsx` | Browser frame (starter component) |
| `tokens.jsx` | Token mirror (same values as the mobile kit) |
| `components.jsx` | `Sidebar`, `Topbar`, `StatsCard`, `StatusBadge`, `Avatar`, `AgePill`, `TierBadge`, form fields, `AdminIcon` |
| `screens.jsx` | `DashboardScreen`, `StudentsScreen`, `NoticesScreen` (composer + preview), `AuditScreen` |
| `app.jsx` | Router + role switcher |

## Coverage
- **Dashboard**: 4 metric cards · attendance-by-centre bar chart · approvals queue
- **Students**: sortable table · age + status pills · MSV chip · pagination · row actions
- **Notices**: composer with audience/channel/schedule + mobile preview pane + recent feed
- **Audit log**: immutable row list with actor, action, target, status tag, CSV export

## Role-aware sidebar
The top-right segmented control flips the sidebar between **City Admin** (centres view), **Sanchalak** (single-centre view), and **Super Admin** (extra `Cities`, `Billing`).
