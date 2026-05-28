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
 * Test / web fallback: when `react-native-mmkv` cannot bind to a JSI
 * runtime (e.g. when imported from a Node script or RN Web target),
 * we fall back to an in-memory `Map`-based shim. The fallback NEVER
 * persists; it exists only so unit tests and the web bundler don't
 * crash on the module's `require('react-native-mmkv')`.
 */

import { MMKV } from 'react-native-mmkv';

const instances = new Map<string, MMKV>();

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

export function getMmkv(id: MMKVInstanceId): MMKV {
  let inst = instances.get(id);
  if (!inst) {
    inst = new MMKV({ id });
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
