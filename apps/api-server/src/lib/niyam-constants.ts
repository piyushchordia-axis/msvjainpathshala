/** Shared niyam-module constants and rejection-window helpers (Q5). */

export const NIYAM_REVERSAL_WINDOW_DAYS = 30;

const AWARDED_STATUSES = new Set(["auto_approved", "approved"]);

export function reversalWindowExpiresAt(createdAt: Date): Date {
  const expires = new Date(createdAt.getTime());
  expires.setUTCDate(expires.getUTCDate() + NIYAM_REVERSAL_WINDOW_DAYS);
  return expires;
}

/**
 * Pending is always rejectable (no points awarded). Awarded statuses require
 * createdAt within the 30-day window. Rejected / other statuses cannot reject.
 */
export function canRejectSubmission(
  status: string,
  createdAt: Date,
  now: Date = new Date(),
): boolean {
  if (status === "pending") return true;
  if (!AWARDED_STATUSES.has(status)) return false;
  return createdAt.getTime() >= now.getTime() - NIYAM_REVERSAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

export function rejectionWindowFields(status: string, createdAt: Date, now?: Date) {
  return {
    reversal_window_expires_at: reversalWindowExpiresAt(createdAt).toISOString(),
    can_reject: canRejectSubmission(status, createdAt, now),
  };
}
