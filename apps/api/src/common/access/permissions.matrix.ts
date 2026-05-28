/**
 * Permissions matrix — `ACTION → minimum role(s) required`.
 *
 * Step 5 ships the auth-adjacent subset. Each feature module (centres,
 * batches, attendance, …) extends this in its own step by adding entries
 * keyed by the action name in its controller code:
 *
 *   @Action('centre.create') @Roles('city_admin', 'state_admin', 'super_admin')
 *
 * Service-layer checks should ALSO call `assertAction(role, action)` so an
 * out-of-band path (worker, cron) can't bypass the controller guard.
 */

import { roleSatisfiesAny, type Role } from './role-hierarchy';

export type Action =
  // Auth
  | 'auth.impersonate'
  | 'auth.devices.list'
  | 'auth.devices.revoke'
  // Reserved for Steps 6+ (extend via module-level files)
  | 'centre.create'
  | 'centre.update'
  | 'batch.create'
  | 'batch.update'
  | 'student.enrol'
  | 'enrolment.approve'
  | 'attendance.mark'
  | 'punya.manual_award'
  | 'niyam.create'
  | 'niyam_submission.reject'
  | 'msv.curriculum.edit'
  | 'msv.application.decide'
  | 'donation.config.80g'
  | 'audit_logs.read'
  | 'system_config.update';

/**
 * For each action, list the roles allowed. Use the LOWEST role that should
 * be permitted — `roleSatisfiesAny` honours hierarchy (super_admin always
 * passes for any action listed here).
 */
export const PERMISSIONS: Readonly<Record<Action, readonly Role[]>> = {
  // Auth
  'auth.impersonate': ['super_admin'],
  'auth.devices.list': ['guest'], // any authenticated user, lowest precedence
  'auth.devices.revoke': ['guest'],

  // Step 6+ — surfaced now so the matrix file is the canonical reference
  'centre.create': ['city_admin'],
  'centre.update': ['sanchalak'],
  'batch.create': ['sanchalak'],
  'batch.update': ['sanchalak'],
  'student.enrol': ['parent'],
  'enrolment.approve': ['sanchalak'],
  'attendance.mark': ['shikshak'],
  'punya.manual_award': ['shikshak'],
  'niyam.create': ['shikshak'],
  'niyam_submission.reject': ['shikshak'],
  'msv.curriculum.edit': ['super_admin'], // CLAUDE.md Q2 — super_admin only
  'msv.application.decide': ['city_admin'],
  'donation.config.80g': ['super_admin'], // CLAUDE.md Q3
  'audit_logs.read': ['sanchalak'],
  'system_config.update': ['super_admin'],
};

/**
 * Throw-on-deny helper. Service-layer code that performs a privileged
 * operation should call this BEFORE the side-effecting work — including
 * paths invoked from BullMQ workers and cron jobs that bypass controllers.
 */
export function assertAction(role: Role, action: Action): void {
  const allowed = PERMISSIONS[action];
  if (!roleSatisfiesAny(role, allowed)) {
    throw new Error(`Role '${role}' is not permitted to perform action '${action}'`);
  }
}
