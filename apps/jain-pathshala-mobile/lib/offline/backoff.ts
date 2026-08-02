/**
 * Retry: 5s → 15s → 45s → 2min → 5min cap, max 10 attempts, exponential WITH JITTER.
 */
export const MAX_ATTEMPTS = 10;

const STEPS_MS = [5_000, 15_000, 45_000, 120_000, 300_000] as const;

/** Delay before attempt `attempt` (1-based after a failure). */
export function backoffDelayMs(attempt: number, random = Math.random): number {
  const idx = Math.min(Math.max(attempt - 1, 0), STEPS_MS.length - 1);
  const base = STEPS_MS[idx]!;
  // Full jitter in [0.5, 1.5) × base so thirty devices don't reconnect in lockstep.
  const jitter = 0.5 + random();
  return Math.min(300_000, Math.round(base * jitter));
}

export function shouldRetry(attempt: number, httpStatus?: number): boolean {
  if (attempt >= MAX_ATTEMPTS) return false;
  if (httpStatus == null) return true; // network
  if (httpStatus === 429 || httpStatus >= 500) return true;
  if (httpStatus === 409) return false; // conflict — terminal
  if (httpStatus >= 400 && httpStatus < 500) return false; // other 4xx terminal
  return true;
}
