/**
 * Numeric limits, TTLs and time windows referenced across the platform.
 *
 * Sources:
 *   - CLAUDE.md "Authentication rules" (OTP TTL, JWT TTLs, device session cap)
 *   - CLAUDE.md "Critical business rules → Q5" (niyam reversal window)
 *   - SPEC §7 (auth, rate limits)
 *   - SPEC §6.27 (validation defaults)
 */

// ---------------------------------------------------------------------------
// Auth — OTP / JWT / sessions
// ---------------------------------------------------------------------------

/** OTP digit length (CLAUDE.md "Authentication rules"). */
export const OTP_LENGTH = 6;

/** OTP time-to-live in seconds (5 minutes). */
export const OTP_TTL_SECONDS = 300;

/** Max number of incorrect OTP verifications before lockout. */
export const OTP_MAX_VERIFY_ATTEMPTS = 5;

/** Access-token TTL (signed RS256). */
export const JWT_ACCESS_TTL = '15m';

/** Refresh-token TTL (signed RS256, with family-based reuse detection). */
export const JWT_REFRESH_TTL = '30d';

/**
 * Max concurrent active device sessions per user. A 6th login revokes the
 * oldest session (CLAUDE.md "Authentication rules → Device sessions").
 */
export const MAX_DEVICE_SESSIONS = 5;

/** Minimum age (in years) for the student-view toggle (CLAUDE.md Q4). */
export const STUDENT_VIEW_MIN_AGE = 13;

// ---------------------------------------------------------------------------
// Niyam
// ---------------------------------------------------------------------------

/**
 * Niyam-submission rejection window in days (CLAUDE.md Q5).
 * After this window the reject button is disabled in the admin UI AND the API
 * returns `ERR_NIYAM_REVERSAL_WINDOW_EXPIRED` (HTTP 409).
 */
export const NIYAM_REVERSAL_WINDOW_DAYS = 30;

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

/** Default page size when the client does not specify one. */
export const PAGINATION_DEFAULT = 20;

/** Maximum page size the API will accept. */
export const PAGINATION_MAX = 100;

// ---------------------------------------------------------------------------
// Rate limiting (SPEC §7.10)
// ---------------------------------------------------------------------------

/** OTP-send sliding-window limits. */
export const OTP_SEND_LIMITS = {
  perMinutePerPhone: 3,
  perHourPerPhone: 10,
  perHourPerIp: 30,
} as const;

// ---------------------------------------------------------------------------
// Sync (offline) — CLAUDE.md "Offline sync rules"
// ---------------------------------------------------------------------------

/** Retry backoff in ms for mobile sync queue (5s → 15s → 45s → 2m → 5m cap). */
export const SYNC_RETRY_BACKOFF_MS = [5_000, 15_000, 45_000, 120_000, 300_000] as const;

/** Maximum attempts before a sync op moves to the DLQ. */
export const SYNC_MAX_ATTEMPTS = 10;

/** MMKV mobile-queue priority order — earlier kinds drain first. */
export const SYNC_QUEUE_PRIORITY = [
  'attendance',
  'shivir_scans',
  'niyam_submissions',
  'homework_submissions',
  'acknowledgements',
] as const;
