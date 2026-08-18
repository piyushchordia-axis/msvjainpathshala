/**
 * v3 §17.11 — Online Granth client helpers.
 *
 * Deliberately tiny and RN-free: the Granth *behaviour* lives in the ordinary
 * section screen, because §17.11.2 is explicit that an online granth is an
 * ordinary library item rendered by the existing item_list rules. Nothing here
 * special-cases an item.
 */
import type { GranthDirectoryDto } from "@workspace/api-zod";
import { apiGet } from "@/lib/api";

export type GranthAvailability = {
  library_count: number;
  library_ids: string[];
};

/** itemId → where it can be borrowed. Items with nowhere to borrow are absent. */
export type GranthAvailabilityMap = Record<string, GranthAvailability>;

/** Query key for the cached directory — under "library", so it persists. */
export function granthDirectoryKey(sectionId: string) {
  return ["library", "granth", "directory", sectionId] as const;
}

/**
 * §17.11.4 — one payload, cached beside the section tree so the whole
 * directory is browsable with no network. Throws on failure so React Query
 * keeps the last good copy rather than replacing it with an empty one.
 */
export function fetchGranthDirectory(sectionId: string): Promise<GranthDirectoryDto> {
  return apiGet<GranthDirectoryDto>(
    `/v1/library/granth/directory?section_id=${encodeURIComponent(sectionId)}`,
  );
}

export const GRANTH_TABS = ["online", "offline"] as const;
export type GranthTab = (typeof GRANTH_TABS)[number];

export function isGranthTab(value: unknown): value is GranthTab {
  return value === "online" || value === "offline";
}

/**
 * One request per section open (never per card). Failure is silent and returns
 * an empty map: the cross-link is an extra, and a directory lookup that is down
 * must not stop someone reading the granth itself.
 */
export async function fetchGranthAvailability(
  sectionId: string,
): Promise<GranthAvailabilityMap> {
  if (!sectionId) return {};
  try {
    const res = await apiGet<{ items: GranthAvailabilityMap }>(
      `/v1/library/granth/availability?section_id=${encodeURIComponent(sectionId)}`,
    );
    return res?.items ?? {};
  } catch {
    return {};
  }
}

/**
 * Deep link into the Offline Granth directory, filtered to the libraries that
 * actually hold this granth. The ids ride in the URL rather than in memory so
 * the row survives a cold open from a notification or a shared link.
 */
export function offlineGranthHref(sectionId: string, libraryIds: string[]): string {
  const ids = libraryIds.join(",");
  return `/library/${sectionId}?tab=offline${ids ? `&libraryIds=${encodeURIComponent(ids)}` : ""}`;
}
