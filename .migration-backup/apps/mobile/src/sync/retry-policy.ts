/**
 * Retry policy per CLAUDE.md "Offline sync rules":
 *   - exponential backoff 5s → 15s → 45s → 2min → 5min cap
 *   - max 10 attempts
 *
 * `nextDelayMs(attempt)` is pure and returns the delay before the (attempt+1)-th
 * try. `isDead(attempt)` flags ops that should be moved to dead-letter.
 */

const LADDER_MS: readonly number[] = [
  5_000,
  15_000,
  45_000,
  120_000,
  300_000, // cap — every subsequent attempt waits this long
];

export const MAX_ATTEMPTS = 10;

export function nextDelayMs(attempt: number): number {
  const i = Math.min(attempt, LADDER_MS.length - 1);
  return LADDER_MS[i] ?? LADDER_MS[LADDER_MS.length - 1] ?? 300_000;
}

export function isDead(attempt: number): boolean {
  return attempt >= MAX_ATTEMPTS;
}
