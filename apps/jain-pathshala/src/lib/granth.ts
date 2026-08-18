/**
 * v3 §17.11 — Online Granth client helpers (web).
 *
 * Mirrors the mobile module. Deliberately tiny: §17.11.2 is explicit that an
 * online granth is an ordinary library item rendered by the existing item_list
 * rules, so nothing here special-cases an item.
 */
import type { GranthDirectoryDto } from '@workspace/api-zod';
import { apiGet } from '@/lib/api-client';

export type GranthAvailability = {
  library_count: number;
  library_ids: string[];
};

/** itemId → where it can be borrowed. Items with nowhere to borrow are absent. */
export type GranthAvailabilityMap = Record<string, GranthAvailability>;

export type GranthTab = 'online' | 'offline';

export function isGranthTab(value: unknown): value is GranthTab {
  return value === 'online' || value === 'offline';
}

/**
 * One request per section open. Failure is silent and returns an empty map: the
 * cross-link is an extra, and a directory lookup that is down must not stop
 * someone reading the granth itself.
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

/** Query key for the cached directory. */
export function granthDirectoryKey(sectionId: string) {
  return ['library', 'granth', 'directory', sectionId] as const;
}

/**
 * §17.11.4 — one payload, so the directory is browsable in a single load
 * rather than three requests any of which could leave a half-built screen.
 */
export function fetchGranthDirectory(sectionId: string): Promise<GranthDirectoryDto> {
  return apiGet<GranthDirectoryDto>(
    `/v1/library/granth/directory?section_id=${encodeURIComponent(sectionId)}`,
  );
}

/**
 * Deep link into the Offline Granth directory, filtered to the libraries that
 * hold this granth. The ids ride in the URL so the link survives a cold open
 * and can be shared.
 */
export function offlineGranthHref(sectionId: string, libraryIds: string[]): string {
  const ids = libraryIds.join(',');
  return `/library/${sectionId}?tab=offline${ids ? `&libraryIds=${encodeURIComponent(ids)}` : ''}`;
}
