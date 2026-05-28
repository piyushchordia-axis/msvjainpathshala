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
