/**
 * Shared type aliases used across the notifications module.
 *
 * Kept here (and not inside notifications.service.ts) so processors,
 * templates, and the controller all import from one stable surface.
 */

import type { Language } from '@jp/shared';

/** Every event the fanout pipeline can fan out on. */
export const NOTIFICATION_EVENTS = [
  'enrolment.submitted',
  'enrolment.approved',
  'enrolment.rejected',
  'enrolment.waitlisted',
  'attendance.marked',
  'niyam.assigned',
  'niyam.rejected',
  'homework.assigned',
  'homework.approved',
  'homework.late',
  'notice.published',
  'notice.critical',
  'shivir.registered',
  'shivir.reminder',
  'exam.result_published',
  'quiz.scheduled',
  'donation.receipt_ready',
  'idcard.ready',
  'birthday.wish',
  'holiday.announced',
  'centre_holiday_announced',
  'session.cancelled',
  'competition.registered',
  'competition.result',
  'service_request.resolved',
  'punya.tier_upgrade',
  'streak.badge_earned',
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

/** Scope shape: how the fanout worker resolves the recipient list. */
export const SCOPE_KINDS = [
  'user',
  'batch',
  'centre',
  'city',
  'state',
  'national',
  'msv_cohort',
  'role',
] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];

export interface NotificationScope {
  kind: ScopeKind;
  /** Bound id for centre/batch/city/state. Ignored for national. */
  id?: string;
  /** For `role` scope, the role to target (e.g. 'city_admin'). */
  role?: string;
  /** Optional age_group / msv_only constraints. */
  msv_only?: boolean;
  age_group?: string;
}

/** Payload of an enqueued fanout job. */
export interface NotificationFanoutPayload {
  event: NotificationEvent;
  /** Optional scope; if omitted the payload must include `recipient_user_ids`. */
  scope?: NotificationScope;
  /** Explicit recipient list (bypasses scope resolution). */
  recipient_user_ids?: string[];
  /** Domain entity this fan-out is about — appears on the in-app row. */
  source?: { kind: string; id: string };
  /** Whether the matching SMS job should be enqueued for opt-in users. */
  send_sms?: boolean;
  /** Whether this is a critical (SMS-eligible) push. */
  is_critical?: boolean;
  /** Arbitrary data that templates can interpolate (e.g. student names). */
  data?: Record<string, unknown>;
  /** Optional deep-link path (e.g. `/notices/abc-123`). */
  deep_link?: string;
}

/** Output of a template invocation. */
export interface NotificationContent {
  title_en: string;
  title_hi: string;
  body_en: string;
  body_hi: string;
}

/** Provider-agnostic push payload. */
export interface PushDeliveryPayload {
  notification_id: string;
  user_id: string;
  tokens: string[];
  title: string;
  body: string;
  language: Language;
  data?: Record<string, unknown>;
  deep_link?: string;
}

/** Provider-agnostic SMS payload. */
export interface SmsDeliveryPayload {
  notification_id?: string;
  user_id: string;
  phone: string;
  body: string;
  language: Language;
  /** When true the monthly cap is bypassed (OTP / critical-ops only). */
  bypass_cap?: boolean;
  source?: { kind: string; id: string };
}

/** Provider-agnostic email payload. */
export interface EmailDeliveryPayload {
  notification_id?: string;
  user_id: string;
  to: string;
  template:
    | 'enrolment-approved'
    | 'monthly-report-ready'
    | 'donation-receipt'
    | 'eighty-g-certificate'
    | 'weekly-digest-city-admin'
    | 'weekly-digest-sanchalak'
    | 'generic';
  subject: string;
  language: Language;
  data?: Record<string, unknown>;
}
