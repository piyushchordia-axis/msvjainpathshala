/**
 * Shared error describer for admin mutations (CTY-ERR-02).
 *
 * Admin pages toasted a generic "Failed." with the raw server sentence as a
 * sub-line, never branching on `error.code` — a 403 (not allowed), a 409
 * (someone else changed it) and a 500 (try again) all read identically. This
 * maps the code to a title + actionable next step; the server's own message
 * stays as the detail line where it adds information.
 *
 * The admin chrome is English-only today, so this helper is too.
 */
import { ApiError } from '@/lib/api-client';

const BY_CODE: Record<string, { title: string; hint: string }> = {
  ERR_FORBIDDEN: {
    title: 'Not allowed',
    hint: 'Your role cannot do this — ask an admin with a higher role.',
  },
  ERR_NOT_FOUND: {
    title: 'Not found',
    hint: 'It may have been deleted — refresh the list and try again.',
  },
  ERR_VALIDATION_FAILED: {
    title: 'Check the form',
    hint: 'Some fields are invalid — fix the highlighted values and resubmit.',
  },
  ERR_CONFLICT: {
    title: 'Conflict',
    hint: 'The record changed since you loaded it — refresh and retry.',
  },
  ERR_RATE_LIMITED: {
    title: 'Too many attempts',
    hint: 'Wait a minute and try again.',
  },
  ERR_RESULTS_PUBLISHED: {
    title: 'Results already released',
    hint: 'Total marks and pass mark are locked once results are released — the title and window are still editable.',
  },
  ERR_EXAM_HAS_ATTEMPTS: {
    title: 'Students have already started',
    hint: 'Questions lock once anyone has attempted this exam, because editing them would change scores mid-flight. Create a new exam instead.',
  },
  ERR_NETWORK: {
    title: "Can't reach the server",
    hint: 'Check your connection and try again.',
  },
};

export function describeApiError(
  err: unknown,
  fallbackTitle = 'Something went wrong',
): { title: string; detail?: string } {
  if (err instanceof ApiError) {
    const mapped = BY_CODE[err.code];
    if (mapped) {
      // Server messages that just restate the code add nothing; specific ones
      // (e.g. "Pass mark cannot be higher than total marks.") are the detail.
      const detail =
        err.message && err.message.toLowerCase() !== mapped.title.toLowerCase()
          ? `${err.message} ${mapped.hint}`
          : mapped.hint;
      return { title: mapped.title, detail };
    }
    return { title: fallbackTitle, detail: err.message || undefined };
  }
  return { title: fallbackTitle, detail: 'Try again — if it keeps failing, refresh the page.' };
}
