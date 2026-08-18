/**
 * Which Panchang year payload wins, and where it is cached.
 *
 * Deliberately PURE — no network, no storage, no react-native. The fetch used to
 * live here as a stub; giving it a real implementation pulled in @/lib/api and
 * through it react-native, whose Flow syntax the test bundler cannot parse, and
 * took the whole panchang suite down with it. Network lives in ./remote.
 */
import type { PanchangYear } from "@/lib/panchang/schema";

/** Prefer the higher contentVersion; ties keep `preferred` (usually cache). */
export function pickNewerPanchangYear(
  preferred: PanchangYear | null,
  fallback: PanchangYear,
): PanchangYear {
  if (!preferred) return fallback;
  if (preferred.contentVersion >= fallback.contentVersion) return preferred;
  return fallback;
}

export function panchangCacheKey(year: number): string {
  return `jp.panchang.year.${year}`;
}
