/**
 * Load Panchang year data: bundled JSON + AsyncStorage cache, offline-first.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import bundled2026 from "@/assets/data/panchang-2026.json";
import {
  panchangYearSchema,
  type PanchangYear,
} from "@/lib/panchang/schema";
import {
  fetchRemotePanchangYear,
  panchangCacheKey,
  pickNewerPanchangYear,
} from "@/lib/panchang/version";

function parseYear(raw: unknown): PanchangYear | null {
  const parsed = panchangYearSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

const BUNDLED: Record<number, PanchangYear> = (() => {
  const y = parseYear(bundled2026);
  if (!y) throw new Error("Bundled panchang-2026.json failed schema validation");
  const year = y.year ?? 2026;
  return { [year]: y };
})();

export function bundledPanchangYear(year: number): PanchangYear | null {
  return BUNDLED[year] ?? null;
}

export async function readCachedPanchangYear(
  year: number,
): Promise<PanchangYear | null> {
  try {
    const raw = await AsyncStorage.getItem(panchangCacheKey(year));
    if (!raw) return null;
    return parseYear(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function writeCachedPanchangYear(
  year: number,
  data: PanchangYear,
): Promise<void> {
  await AsyncStorage.setItem(panchangCacheKey(year), JSON.stringify(data));
}

/**
 * Offline-first load: max(cache, bundled), then best-effort remote (stub).
 */
export async function loadPanchangYear(year: number): Promise<PanchangYear | null> {
  const bundled = bundledPanchangYear(year);
  const cached = await readCachedPanchangYear(year);
  let current =
    bundled || cached
      ? pickNewerPanchangYear(cached, bundled ?? cached!)
      : null;

  // Remote stub returns null today; when it returns data with a higher
  // contentVersion we persist and prefer it.
  try {
    const remote = await fetchRemotePanchangYear(year);
    if (remote) {
      const next = pickNewerPanchangYear(remote, current ?? remote);
      if (next === remote) {
        await writeCachedPanchangYear(year, remote);
      }
      current = next;
    }
  } catch {
    /* stay on local */
  }

  return current;
}

/** Asia/Kolkata "today" as YYYY-MM-DD. */
export function todayIstDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export function yearFromIsoDate(isoDate: string): number {
  return Number(isoDate.slice(0, 4));
}
