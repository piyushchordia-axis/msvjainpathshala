/**
 * Punya ledger display helpers.
 *
 * The admin transaction table used to prefix a hardcoded '+' to a signed value,
 * so a reversal (a niyam rejection, an attendance correction — both write
 * negative rows) rendered as "+-10" and was coloured as a credit. Sign is
 * derived from the value, never assumed.
 */

/** Render a signed ledger amount: 10 -> "+10", -10 -> "−10", 0 -> "0". */
export function formatSignedPoints(points: number): string {
  if (points === 0) return '0';
  // U+2212 MINUS SIGN, not a hyphen — it aligns with digits at the same weight.
  return points > 0 ? `+${points}` : `−${Math.abs(points)}`;
}
