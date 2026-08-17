/**
 * Shared, session-scoped cache for the library tree.
 *
 * The tree embeds every published item's full text (text_content_en/hi/gu), so
 * it is by far the heaviest public payload. The three library pages each
 * fetched it independently — browsing index → section → text downloaded the
 * whole corpus three times on the slowest guest connections (GST-PRF-01).
 *
 * One in-flight/settled promise per audience (guest vs member), with a short
 * TTL so long-lived tabs still pick up newly published content. A failed fetch
 * is never cached — the next call retries.
 */
import { ApiError, apiGet } from '@/lib/api-client';
import type { LibraryItemDto, LibrarySectionDto } from '@workspace/api-zod';

const TTL_MS = 5 * 60 * 1000;

type Entry = { promise: Promise<LibrarySectionDto[]>; at: number };
const cache = new Map<string, Entry>();

/** Warm full-tree promise for this audience, or null when absent/stale. */
function warmTree(authed: boolean): Promise<LibrarySectionDto[]> | null {
  const hit = cache.get(authed ? 'member' : 'guest');
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  return null;
}

type ScopedEntry<T> = { promise: Promise<T>; at: number };
const sectionCache = new Map<string, ScopedEntry<LibrarySectionDto | null>>();
const itemCache = new Map<string, ScopedEntry<LibraryItemDto | null>>();

function guestGet<T>(path: string, pick: (json: { data?: T }) => T): Promise<T> {
  return fetch(path, { headers: { Accept: 'application/json' } }).then(async (r) => {
    if (r.status === 404) return pick({});
    if (!r.ok) throw new Error(`library ${r.status}`);
    return pick((await r.json()) as { data?: T });
  });
}

export function fetchLibrarySections(
  authed: boolean,
  opts?: { force?: boolean },
): Promise<LibrarySectionDto[]> {
  const key = authed ? 'member' : 'guest';
  const now = Date.now();
  const hit = cache.get(key);
  if (!opts?.force && hit && now - hit.at < TTL_MS) return hit.promise;

  const promise = (
    authed
      ? apiGet<{ sections: LibrarySectionDto[] }>('/v1/library').then((r) => r.sections ?? [])
      : fetch('/v1/public/library', { headers: { Accept: 'application/json' } })
          .then((r) => {
            if (!r.ok) throw new Error(`library ${r.status}`);
            return r.json();
          })
          .then(
            (json: { data?: { sections?: LibrarySectionDto[] } }) => json.data?.sections ?? [],
          )
  ).catch((err) => {
    // Do not poison the cache with a failure.
    cache.delete(key);
    throw err;
  });

  cache.set(key, { promise, at: now });
  return promise;
}

/**
 * One section, without the corpus (GST-PRF-01 second half): a cold deep-link
 * used to download the whole tree. Serves from the warm tree when present;
 * otherwise hits the scoped endpoint. Resolves null for a real not-found.
 */
export function fetchLibrarySection(
  authed: boolean,
  sectionId: string,
): Promise<LibrarySectionDto | null> {
  const warm = warmTree(authed);
  if (warm) return warm.then((sections) => sections.find((s) => s.id === sectionId) ?? null);

  const key = `${authed ? 'member' : 'guest'}:${sectionId}`;
  const now = Date.now();
  const hit = sectionCache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.promise;

  const promise = (
    authed
      ? apiGet<{ section: LibrarySectionDto }>(`/v1/library/sections/${sectionId}`)
          .then((r) => r.section ?? null)
          .catch((err) => {
            if (err instanceof ApiError && err.code === 'ERR_NOT_FOUND') return null;
            throw err;
          })
      : guestGet<LibrarySectionDto | null>(
          `/v1/public/library/sections/${sectionId}`,
          (json) => (json as { data?: { section?: LibrarySectionDto } }).data?.section ?? null,
        )
  ).catch((err) => {
    // Transport failures are never cached; a definitive 404 (null) is.
    sectionCache.delete(key);
    throw err;
  });

  sectionCache.set(key, { promise, at: now });
  return promise;
}

/** One item — the deep-link unit. Same warm-tree/scoped-endpoint rules. */
export function fetchLibraryItem(
  authed: boolean,
  itemId: string,
): Promise<LibraryItemDto | null> {
  const warm = warmTree(authed);
  if (warm) {
    return warm.then((sections) => {
      for (const section of sections) {
        for (const sub of section.subsections ?? []) {
          const hit = (sub.items ?? []).find((i) => i.id === itemId);
          if (hit) return hit;
        }
        const loose = (section.items ?? []).find((i) => i.id === itemId);
        if (loose) return loose;
      }
      return null;
    });
  }

  const key = `${authed ? 'member' : 'guest'}:${itemId}`;
  const now = Date.now();
  const hit = itemCache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.promise;

  const promise = (
    authed
      ? apiGet<{ item: LibraryItemDto }>(`/v1/library/items/${itemId}`)
          .then((r) => r.item ?? null)
          .catch((err) => {
            if (err instanceof ApiError && err.code === 'ERR_NOT_FOUND') return null;
            throw err;
          })
      : guestGet<LibraryItemDto | null>(
          `/v1/public/library/items/${itemId}`,
          (json) => (json as { data?: { item?: LibraryItemDto } }).data?.item ?? null,
        )
  ).catch((err) => {
    itemCache.delete(key);
    throw err;
  });

  itemCache.set(key, { promise, at: now });
  return promise;
}

/** Sign-in / sign-out changes what the tree contains — drop both audiences. */
export function invalidateLibraryCache(): void {
  cache.clear();
  sectionCache.clear();
  itemCache.clear();
}
