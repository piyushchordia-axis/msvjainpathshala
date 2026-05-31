/**
 * ULID generator for React Native (Expo).
 *
 * The `ulid` package auto-detects a crypto source at runtime. In the Expo/
 * Hermes runtime that detection is unreliable — Metro resolves the package's
 * CommonJS build, whose PRNG calls Node's `crypto.randomBytes`, which does not
 * exist on-device (`nodeCrypto.randomBytes is not a function`). Hermes also
 * has no global `crypto.getRandomValues`, so the browser build would fail too.
 *
 * We sidestep the whole detection by supplying our OWN secure PRNG backed by
 * `expo-crypto.getRandomBytes` (synchronous, available on every platform) and
 * building the ULID factory from it. Every caller in the app imports `ulid`
 * from here instead of from the `ulid` package directly.
 */

import { getRandomBytes } from 'expo-crypto';
import { monotonicFactory } from 'ulid';

/** Uniform random in [0, 1) sourced from 4 secure random bytes. */
function secureRandom(): number {
  const bytes = getRandomBytes(4);
  const int = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
  return int / 0x1_0000_0000;
}

/**
 * Monotonic factory: IDs generated within the same millisecond are guaranteed
 * to sort after one another — important for the MMKV op queue, which orders
 * pending operations by their ULID `client_op_id`.
 */
export const ulid = monotonicFactory(secureRandom);
