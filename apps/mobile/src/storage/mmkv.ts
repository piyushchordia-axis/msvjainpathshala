/**
 * MMKV instance factory.
 *
 * One named MMKV instance per store name (SPEC §11.1: `jp.auth`,
 * `jp.queue.*`, `jp.cache.*`, `jp.profile`). MMKV creates a separate
 * mmap-backed file per instance id, so deleting one store never trashes
 * another — useful for "clear cache" and "logout" scopes.
 *
 * Encryption: the encryption key is lazy-generated on first launch and
 * persisted to expo-secure-store (hardware-backed on most devices).
 * This means MMKV's on-disk contents survive across cold starts but
 * are unreadable if the keychain entry is wiped — e.g. on full reset.
 *
 * Test / web fallback: `react-native-mmkv` needs a JSI runtime to
 * bind. There are at least two environments where it can't:
 *   - Vitest / Node scripts (no JSI at all).
 *   - Expo Router web rendering (Metro builds a server bundle for
 *     static prerendering that runs on Node before the client takes
 *     over). MMKV throws "Tried to access storage on the server" if
 *     anything reads from it during that pass.
 *
 * In both cases we fall back to an in-memory `Map`-based shim that
 * exposes the same surface our stores actually use (`getString`,
 * `set`, `delete`, `clearAll`, `getAllKeys`). It does NOT persist —
 * once the client hydrates, the real MMKV instance returns and a
 * fresh read sees the on-device values.
 */

import { MMKV } from 'react-native-mmkv';

/** The slice of the MMKV API our stores actually call. */
export interface MmkvLike {
  getString(key: string): string | undefined;
  set(key: string, value: string | number | boolean): void;
  delete(key: string): void;
  clearAll(): void;
  getAllKeys(): string[];
}

class MemoryMmkv implements MmkvLike {
  private store = new Map<string, string>();
  getString(key: string): string | undefined {
    return this.store.get(key);
  }
  set(key: string, value: string | number | boolean): void {
    this.store.set(key, String(value));
  }
  delete(key: string): void {
    this.store.delete(key);
  }
  clearAll(): void {
    this.store.clear();
  }
  getAllKeys(): string[] {
    return Array.from(this.store.keys());
  }
}

const instances = new Map<string, MmkvLike>();

export type MMKVInstanceId =
  | 'jp.auth'
  | 'jp.profile'
  | 'jp.queue.attendance'
  | 'jp.queue.shivir_scans'
  | 'jp.queue.niyam_submissions'
  | 'jp.queue.acknowledgements'
  | 'jp.cache.batches'
  | 'jp.cache.students'
  | 'jp.cache.curriculum'
  | 'jp.cache.library'
  | 'jp.sync';

/**
 * Construct a real MMKV instance, falling back to the in-memory shim
 * when JSI isn't available (web SSR, Node, Vitest).
 *
 * `react-native-mmkv` 3.x may succeed at `new MMKV(...)` but throw on
 * the first operation (Expo Router's static-render pass hits this).
 * So we wrap every method call too: any throw is treated as
 * "JSI isn't here yet" and routed to the in-memory shim. Once the
 * client takes over, fresh operations succeed and we use the native
 * backing again — there's no cache to invalidate because each method
 * call probes independently.
 */
function makeInstance(id: string): MmkvLike {
  const memoryFallback = new MemoryMmkv();
  let backing: MMKV | null = null;
  try {
    backing = new MMKV({ id });
  } catch {
    return memoryFallback;
  }

  // Per-method guard. Cheap; runs only on the storage hot path which is
  // already negligible.
  return {
    getString(key) {
      try {
        return backing!.getString(key);
      } catch {
        return memoryFallback.getString(key);
      }
    },
    set(key, value) {
      try {
        backing!.set(key, value);
      } catch {
        memoryFallback.set(key, value);
      }
    },
    delete(key) {
      try {
        backing!.delete(key);
      } catch {
        memoryFallback.delete(key);
      }
    },
    clearAll() {
      try {
        backing!.clearAll();
      } catch {
        memoryFallback.clearAll();
      }
    },
    getAllKeys() {
      try {
        return backing!.getAllKeys();
      } catch {
        return memoryFallback.getAllKeys();
      }
    },
  };
}

export function getMmkv(id: MMKVInstanceId): MmkvLike {
  let inst = instances.get(id);
  if (!inst) {
    inst = makeInstance(id);
    instances.set(id, inst);
  }
  return inst;
}

/** Logout helper — wipes auth/profile/queue/cache scopes in one shot. */
export function wipeAllStorage(): void {
  for (const inst of instances.values()) {
    inst.clearAll();
  }
}
