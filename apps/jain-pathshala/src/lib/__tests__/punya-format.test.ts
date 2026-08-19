import { describe, it, expect } from 'vitest';
import { formatSignedPoints } from '../punya-format';

describe('formatSignedPoints', () => {
  it('prefixes a credit with +', () => {
    expect(formatSignedPoints(10)).toBe('+10');
  });

  it('renders a reversal with a single minus, never "+-"', () => {
    // The bug: `+${t.points}` produced "+-10" for every reversal row.
    expect(formatSignedPoints(-10)).toBe('−10');
    expect(formatSignedPoints(-10)).not.toContain('+');
  });

  it('renders zero without a sign', () => {
    expect(formatSignedPoints(0)).toBe('0');
  });
});
