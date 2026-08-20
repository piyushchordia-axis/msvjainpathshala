/**
 * M13 — quiz windows are Asia/Kolkata, and `datetime-local` is not.
 *
 * `<input type="datetime-local">` yields a bare wall-clock string with no zone.
 * The dialog fed it straight to `new Date(...)`, which resolves it in the
 * BROWSER's zone — so an admin travelling, or a hosted admin panel used from
 * outside India, set a window hours away from the one they typed. Reading it
 * back with `toLocaleString('en-GB')` fixed the format but not the zone, so
 * nothing on screen revealed the drift.
 *
 * AT26 already establishes Asia/Kolkata as the platform's operating day. India
 * has a fixed +05:30 offset and no DST, so the conversion is exact rather than
 * a best-effort — that is why this is a constant and not an Intl round-trip.
 */
export const IST_OFFSET = '+05:30';
export const IST_TIME_ZONE = 'Asia/Kolkata';

/**
 * "2026-08-20T14:30" (as typed, meaning 14:30 IST) → the ISO instant.
 * Returns null for an empty or unparseable field.
 */
export function istLocalInputToIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  // datetime-local omits seconds when they are zero.
  const withSeconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed) ? `${trimmed}:00` : trimmed;
  const d = new Date(`${withSeconds}${IST_OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** ISO instant → "20/08/2026, 14:30" in IST, for display. */
export function formatIst(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', { timeZone: IST_TIME_ZONE });
}

/** ISO instant → "2026-08-20T14:30" IST, for prefilling a datetime-local input. */
export function isoToIstLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // en-CA gives ISO-ordered date parts; the time comes back as HH:MM:SS.
  const date = d.toLocaleDateString('en-CA', { timeZone: IST_TIME_ZONE });
  const time = d.toLocaleTimeString('en-GB', { timeZone: IST_TIME_ZONE, hour12: false });
  return `${date}T${time.slice(0, 5)}`;
}
