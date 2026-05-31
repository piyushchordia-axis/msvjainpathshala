/**
 * Generic cache store backed by MMKV.
 *
 * Layout per cache (e.g. `jp.cache.batches`):
 *   key:<id>  →  JSON-encoded CacheEntry<T> = { value, fetched_at, expires_at? }
 *
 * `set()` always stamps `fetched_at` — the stale-cache banner (SPEC §11.6)
 * reads it to show "Last updated 3h ago".
 *
 * No global keys-index here (unlike the queue stores): cache reads are
 * single-key lookups; rare bulk operations use MMKV.getAllKeys().
 */

import { getMmkv, type MMKVInstanceId } from '../../mmkv';

import type { CacheEntry } from '../../types';

const KEY_PREFIX = 'k:';

export class CacheStore<TValue> {
  constructor(private readonly mmkvId: MMKVInstanceId) {}

  private get mmkv() {
    return getMmkv(this.mmkvId);
  }

  get(key: string): TValue | null {
    const raw = this.mmkv.getString(KEY_PREFIX + key);
    if (!raw) return null;
    try {
      const entry = JSON.parse(raw) as CacheEntry<TValue>;
      if (entry.expires_at && new Date(entry.expires_at).getTime() < Date.now()) {
        this.delete(key);
        return null;
      }
      return entry.value;
    } catch {
      this.delete(key);
      return null;
    }
  }

  getEntry(key: string): CacheEntry<TValue> | null {
    const raw = this.mmkv.getString(KEY_PREFIX + key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CacheEntry<TValue>;
    } catch {
      return null;
    }
  }

  set(key: string, value: TValue, ttlSeconds?: number): void {
    const entry: CacheEntry<TValue> = {
      value,
      fetched_at: new Date().toISOString(),
      expires_at:
        ttlSeconds !== undefined && ttlSeconds > 0
          ? new Date(Date.now() + ttlSeconds * 1000).toISOString()
          : null,
    };
    this.mmkv.set(KEY_PREFIX + key, JSON.stringify(entry));
  }

  delete(key: string): void {
    this.mmkv.delete(KEY_PREFIX + key);
  }

  clear(): void {
    this.mmkv.clearAll();
  }

  getAll(): Array<{ key: string; entry: CacheEntry<TValue> }> {
    const out: Array<{ key: string; entry: CacheEntry<TValue> }> = [];
    for (const fullKey of this.mmkv.getAllKeys()) {
      if (!fullKey.startsWith(KEY_PREFIX)) continue;
      const raw = this.mmkv.getString(fullKey);
      if (!raw) continue;
      try {
        out.push({ key: fullKey.slice(KEY_PREFIX.length), entry: JSON.parse(raw) });
      } catch {
        this.mmkv.delete(fullKey);
      }
    }
    return out;
  }
}
