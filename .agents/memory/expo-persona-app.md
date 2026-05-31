---
name: Expo persona-based app patterns
description: Durable conventions for the Jain Pathshala mobile app's per-role tab architecture and cross-account safety
---

# Expo persona app (jain-pathshala-mobile)

## Per-role groups use REAL path segments, not parenthesized groups
Each role lives under a real directory segment: `app/{guest,parent,student,shikshak,admin}/`.
**Why:** expo-router treats parenthesized groups `(x)` as shared URL space, so same-named
screens (e.g. each persona's `library.tsx` / `home.tsx`) collide and clobber each other.
Real segments give each persona its own namespace and its own `_layout.tsx` Tabs shell.
**How to apply:** when adding a new role or screen, put it under the role's real-segment
dir; register the group once in `app/_layout.tsx`. `app/index.tsx` redirects by role via
`routeForRole`. `components/PersonaTabs.tsx` is the role-guarded Tabs shell (logged-out →
`/auth/phone`, wrong-role → that role's home); the guest group is intentionally public (no guard).

## Clear the React Query cache on every auth transition
`AuthContext.signIn` and `logout` both call `queryClient.clear()`.
**Why:** query keys are not user-scoped, and React Query persists across a logout→login on
the same device. Without clearing, the previous account's children/profile briefly render
and dependent fetches fire with the prior user's student IDs (cross-account data leak).
**How to apply:** never rely on key-scoping alone here — keep the explicit clear on both
transitions. `SessionViewContext` also hard-resets `activeStudentId` on `user?.id`/`enabled` change.

## expo-router param hardening
`useLocalSearchParams` values can be `string | string[]` at runtime even when typed as string.
Normalize with a `first()` helper, and on screens that require a handoff token (e.g.
`app/auth/otp.tsx` needs `otp_token`), redirect back to the previous step when it's missing
instead of leaving a dead-end button.

## Workflow / backend notes
- Restart the app via the `artifacts/jain-pathshala-mobile: expo` workflow tool — never `npx expo`.
- Backend persona data is read via `/v1/me/*` (requireAuth); admin/shikshak list endpoints
  under `/v1/admin/*` are auto-scoped by the caller's role, so one admin group serves all
  four admin roles and shikshak reuses admin endpoints read-only.
- API base is `https://$EXPO_PUBLIC_DOMAIN`; both `/api/auth/*` and `/v1/*` are routed
  (NOT `/api/v1/*`). `lib/api.ts` apiGet/apiPost unwrap the `{data, meta}` envelope.
