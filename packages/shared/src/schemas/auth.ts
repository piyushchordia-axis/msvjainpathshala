/**
 * Auth DTOs (SPEC §6.1, §7.1–§7.5).
 *
 * Endpoints covered:
 *   POST /v1/auth/otp/request
 *   POST /v1/auth/otp/verify
 *   POST /v1/auth/refresh
 *   POST /v1/auth/logout
 *   POST /v1/auth/switch-view
 */

import { z } from 'zod';

import { OTP_LENGTH } from '../constants/limits.js';
import { ROLES } from '../enums/role.js';

import { isoDatetime, languageCode, phone, uuid } from './common.js';

// ---------------------------------------------------------------------------
// OTP request / verify
// ---------------------------------------------------------------------------

export const otpRequestSchema = z.object({
  phone,
  /** Optional language hint so the SMS is sent in the user's preferred language. */
  language: languageCode.optional(),
});
export type OtpRequestDto = z.infer<typeof otpRequestSchema>;

export const otpRequestResponseSchema = z.object({
  /**
   * Opaque token returned by the server. The client must echo this back on
   * `POST /v1/auth/otp/verify` — verify binds by token, not phone, so an
   * attacker who only knows the victim's phone cannot race a verify
   * against a legitimate send (SPEC §7.1 step 2; see `otpVerifySchema`).
   */
  otp_token: z.string().min(16),
  /** Time-to-live of the OTP in seconds (5 minutes by default). */
  expires_in_seconds: z.number().int().nonnegative(),
});
export type OtpRequestResponse = z.infer<typeof otpRequestResponseSchema>;

export const otpVerifySchema = z.object({
  /**
   * Opaque token returned by `POST /v1/auth/otp/send`. Binds the verify call
   * to the prior send so an attacker who knows only the victim's phone
   * cannot race a verify against a legitimate send (SPEC §7.1 step 2).
   */
  otp_token: z.string().min(16),
  /** 6-digit code. */
  code: z
    .string()
    .length(OTP_LENGTH, `OTP must be ${OTP_LENGTH} digits`)
    .regex(/^\d+$/, 'OTP must be digits only'),
  /** Device-bound metadata persisted in `device_sessions`. Required, not optional. */
  device: z.object({
    device_id: z.string().min(1).max(128),
    platform: z.enum(['ios', 'android', 'web']),
    app_version: z.string().min(1).max(32).optional(),
  }),
});
export type OtpVerifyDto = z.infer<typeof otpVerifySchema>;

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export const tokenPairSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  access_expires_at: isoDatetime,
  refresh_expires_at: isoDatetime,
});
export type TokenPair = z.infer<typeof tokenPairSchema>;

export const otpVerifyResponseSchema = z.object({
  tokens: tokenPairSchema,
  user: z.object({
    id: uuid,
    role: z.enum(ROLES),
    preferred_language: languageCode,
  }),
});
export type OtpVerifyResponse = z.infer<typeof otpVerifyResponseSchema>;

// ---------------------------------------------------------------------------
// Refresh / logout
// ---------------------------------------------------------------------------

export const refreshSchema = z.object({
  refresh_token: z.string().min(16),
});
export type RefreshDto = z.infer<typeof refreshSchema>;

export const logoutSchema = z.object({
  /** Optionally revoke a specific session by id; default revokes the current one. */
  session_id: uuid.optional(),
});
export type LogoutDto = z.infer<typeof logoutSchema>;

// ---------------------------------------------------------------------------
// Student-view toggle (CLAUDE.md Q4 — 13+ hard gate)
// ---------------------------------------------------------------------------

export const switchViewSchema = z.object({
  /**
   * Target view. `parent` switches back to the default parent view.
   * `student` requires the parent to be linked to a student aged ≥ 13.
   */
  view_context: z.enum(['parent', 'student']),
  /** Required when switching to `student` and the parent has multiple children. */
  student_id: uuid.optional(),
});
export type SwitchViewDto = z.infer<typeof switchViewSchema>;
