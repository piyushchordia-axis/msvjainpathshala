/**
 * Realtime namespace / event surface (SPEC §9.3, §9.4).
 *
 * Three namespaces:
 *   /shivirs/:shivirId        → volunteers + admins of that shivir
 *   /push-quizzes/:quizId     → participants of that quiz
 *   /admin-dashboard/:cityId  → city_admin+ live activity feed
 *
 * Auth: client sends `{ auth: { token } }` on connect. The gateway
 * verifies via the JwtService and rejects on bad / expired token.
 */

export const NAMESPACES = {
  SHIVIRS: '/shivirs',
  PUSH_QUIZZES: '/push-quizzes',
  ADMIN_DASHBOARD: '/admin-dashboard',
} as const;

export type SocketNamespace = (typeof NAMESPACES)[keyof typeof NAMESPACES];

/** Common envelope for every realtime event. */
export interface RealtimeEnvelope<TData = unknown> {
  event: string;
  emitted_at: string;
  data: TData;
}

/** Admin dashboard activity item. */
export interface AdminDashboardActivity {
  event:
    | 'enrolment.submitted'
    | 'enrolment.approved'
    | 'notice.published'
    | 'attendance.marked'
    | 'donation.received'
    | string;
  city_id: string;
  actor_role?: string;
  summary_en: string;
  summary_hi: string;
  source_entity_kind?: string;
  source_entity_id?: string;
  at: string;
}
