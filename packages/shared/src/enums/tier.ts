/**
 * `tier_enum` (SPEC §5.1) — Punya spiritual tiers, locked per CLAUDE.md.
 *
 * Point thresholds match CLAUDE.md "Punya spiritual tiers (locked)".
 * Tier colours live in `@jp/design-tokens` (colors.tier.*).
 */

export const TIERS = ['jigyasu', 'shravak', 'sadhak', 'shraman', 'tirthankar'] as const;
export type Tier = (typeof TIERS)[number];

/** Lower-bound (inclusive) Punya points required to reach each tier. */
export const TIER_THRESHOLDS: Record<Tier, number> = {
  jigyasu: 0,
  shravak: 101,
  sadhak: 501,
  shraman: 1501,
  tirthankar: 5001,
};

/** Resolve a Punya total to the highest tier it qualifies for. */
export function tierForPoints(totalPoints: number): Tier {
  let current: Tier = 'jigyasu';
  for (const t of TIERS) {
    if (totalPoints >= TIER_THRESHOLDS[t]) current = t;
  }
  return current;
}

/**
 * Return the next-higher tier after `tier`, or null at the top (Tirthankar).
 * Used by the Punya card "X points to <next>" line.
 */
export function nextTier(tier: Tier): Tier | null {
  const idx = TIERS.indexOf(tier);
  if (idx < 0 || idx >= TIERS.length - 1) return null;
  return TIERS[idx + 1]!;
}

/**
 * Progress within the current tier's band:
 *   { current, next, lowerBound, upperBound, pointsIntoTier, pointsToNext, pct (0..1) }
 * For Tirthankar (top), `next` and `upperBound`/`pointsToNext` are null and
 * `pct` is always 1.0 — i.e. the bar is full.
 */
export interface TierProgress {
  current: Tier;
  next: Tier | null;
  lowerBound: number;
  upperBound: number | null;
  pointsIntoTier: number;
  pointsToNext: number | null;
  /** 0..1 — how far along the band; 1 if already at top. */
  pct: number;
}

export function tierProgressFor(totalPoints: number): TierProgress {
  const current = tierForPoints(totalPoints);
  const next = nextTier(current);
  const lowerBound = TIER_THRESHOLDS[current];
  if (!next) {
    return {
      current,
      next: null,
      lowerBound,
      upperBound: null,
      pointsIntoTier: Math.max(0, totalPoints - lowerBound),
      pointsToNext: null,
      pct: 1,
    };
  }
  const upperBound = TIER_THRESHOLDS[next];
  const pointsIntoTier = Math.max(0, totalPoints - lowerBound);
  const pointsToNext = Math.max(0, upperBound - totalPoints);
  const span = upperBound - lowerBound;
  const pct = span > 0 ? Math.min(1, Math.max(0, pointsIntoTier / span)) : 0;
  return { current, next, lowerBound, upperBound, pointsIntoTier, pointsToNext, pct };
}
