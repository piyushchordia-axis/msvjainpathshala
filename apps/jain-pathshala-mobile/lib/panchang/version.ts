/**
 * Resolve which Panchang year payload to use (cache vs bundled).
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

/**
 * Remote fetch stub — no public endpoint yet.
 * When an API lands, implement GET here and write through the cache.
 */
export async function fetchRemotePanchangYear(
  _year: number,
): Promise<PanchangYear | null> {
  return null;
}
