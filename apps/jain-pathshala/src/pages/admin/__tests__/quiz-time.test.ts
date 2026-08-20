/**
 * M13 — a quiz window means the same thing wherever the admin's browser is.
 *
 * `<input type="datetime-local">` hands back a bare wall-clock with no zone,
 * and the dialog passed it to `new Date(...)`, which resolves it in the
 * BROWSER's zone. An admin abroad, or a hosted panel used from outside India,
 * set a window hours away from the one they typed — and reading it back with
 * `toLocaleString('en-GB')` fixed the format but not the zone, so nothing on
 * screen revealed the drift. AT26 makes these windows Asia/Kolkata.
 */
import { describe, expect, it } from 'vitest';
import { formatIst, isoToIstLocalInput, istLocalInputToIso } from '@/pages/admin/quiz-time';

describe('istLocalInputToIso — the field is IST, not browser-local', () => {
  it('reads a wall clock as IST (+05:30)', () => {
    // 14:30 IST is 09:00 UTC, whatever zone this test runs in.
    expect(istLocalInputToIso('2026-08-20T14:30')).toBe('2026-08-20T09:00:00.000Z');
  });

  it('handles a value that already carries seconds', () => {
    expect(istLocalInputToIso('2026-08-20T14:30:45')).toBe('2026-08-20T09:00:45.000Z');
  });

  it('rolls back across midnight correctly', () => {
    // 00:30 IST on the 20th is 19:00 UTC on the 19th.
    expect(istLocalInputToIso('2026-08-20T00:30')).toBe('2026-08-19T19:00:00.000Z');
  });

  it('returns null for empty or unparseable input', () => {
    expect(istLocalInputToIso('')).toBeNull();
    expect(istLocalInputToIso('   ')).toBeNull();
    expect(istLocalInputToIso('not a date')).toBeNull();
  });
});

describe('formatIst — display matches the zone that was authored', () => {
  it('renders an instant in IST', () => {
    // 09:00 UTC → 14:30 IST.
    expect(formatIst('2026-08-20T09:00:00.000Z')).toBe('20/08/2026, 14:30:00');
  });

  it('renders a dash for missing or invalid values', () => {
    expect(formatIst(null)).toBe('—');
    expect(formatIst(undefined)).toBe('—');
    expect(formatIst('nonsense')).toBe('—');
  });
});

describe('round trip', () => {
  it('survives input → ISO → input unchanged', () => {
    const typed = '2026-12-31T23:45';
    const iso = istLocalInputToIso(typed);
    expect(iso).not.toBeNull();
    expect(isoToIstLocalInput(iso)).toBe(typed);
  });

  it('is stable across a year boundary in UTC', () => {
    // 00:15 IST on 1 Jan is 18:45 UTC on 31 Dec — the naive path lands a day out.
    const iso = istLocalInputToIso('2027-01-01T00:15');
    expect(iso).toBe('2026-12-31T18:45:00.000Z');
    expect(isoToIstLocalInput(iso)).toBe('2027-01-01T00:15');
  });
});
