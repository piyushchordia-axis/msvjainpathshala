/**
 * Auth store — splits secrets across three tiers per security best
 * practice on RN:
 *
 *   - `access_token` lives ONLY in memory (process-scoped). Stolen MMKV
 *     contents shouldn't reveal an unexpired access token; if the device
 *     reboots, we silently refresh via the refresh token.
 *   - `refresh_token` lives in `expo-secure-store` (Keychain on iOS,
 *     EncryptedSharedPreferences on Android). Hardware-backed where
 *     supported. On web `expo-secure-store` throws ("not supported"), so
 *     we transparently fall back to `localStorage`. The web target is
 *     dev/QA only today; if we ever ship web to end users, swap to
 *     an HTTP-only cookie issued by the API.
 *   - User profile + view context + token TTLs live in MMKV `jp.auth`
 *     so the splash screen can route by role without a refresh round-trip.
 */

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { getMmkv } from '../mmkv';

import type { AuthSnapshot } from '../types';

const KEY_USER = 'snapshot';
const SECURE_KEY_REFRESH = 'jp.auth.refresh_token';

let memoryAccessToken: string | null = null;

// ---- Web fallback for SecureStore ----------------------------------------
// expo-secure-store has no web implementation and throws synchronously on
// any call. localStorage is acceptable for the dev web target; sessionStorage
// would also work but loses the token on tab close which hurts QA UX.
const isWeb = Platform.OS === 'web';

// Access via globalThis so this file compiles without the DOM lib in
// tsconfig — the mobile project targets React Native, not the browser.
interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
function getWebStorage(): WebStorageLike | null {
  const g = globalThis as unknown as { localStorage?: WebStorageLike };
  return g.localStorage ?? null;
}

function webGet(key: string): string | null {
  try {
    return getWebStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function webSet(key: string, value: string): void {
  try {
    getWebStorage()?.setItem(key, value);
  } catch {
    // ignore — private mode, quota exceeded, SSR pass, etc.
  }
}
function webDelete(key: string): void {
  try {
    getWebStorage()?.removeItem(key);
  } catch {
    // ignore
  }
}

export const authStore = {
  // ---- Access token (memory) ------------------------------------------
  getAccessToken(): string | null {
    return memoryAccessToken;
  },
  setAccessToken(token: string | null): void {
    memoryAccessToken = token;
  },

  // ---- Refresh token (SecureStore on native, localStorage on web) -----
  async getRefreshToken(): Promise<string | null> {
    if (isWeb) return webGet(SECURE_KEY_REFRESH);
    try {
      return await SecureStore.getItemAsync(SECURE_KEY_REFRESH);
    } catch {
      return null;
    }
  },
  async setRefreshToken(token: string | null): Promise<void> {
    if (isWeb) {
      if (token === null) webDelete(SECURE_KEY_REFRESH);
      else webSet(SECURE_KEY_REFRESH, token);
      return;
    }
    try {
      if (token === null) {
        await SecureStore.deleteItemAsync(SECURE_KEY_REFRESH);
        return;
      }
      await SecureStore.setItemAsync(SECURE_KEY_REFRESH, token);
    } catch {
      // Native SecureStore failures (locked keychain, etc.) — swallow so
      // we don't bring down the auth flow. The user will silently re-OTP
      // on next launch.
    }
  },

  // ---- Snapshot (MMKV) ------------------------------------------------
  getSnapshot(): AuthSnapshot | null {
    const raw = getMmkv('jp.auth').getString(KEY_USER);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthSnapshot;
    } catch {
      return null;
    }
  },
  setSnapshot(snap: AuthSnapshot): void {
    getMmkv('jp.auth').set(KEY_USER, JSON.stringify(snap));
  },
  clearSnapshot(): void {
    getMmkv('jp.auth').delete(KEY_USER);
  },

  // ---- Logout — wipe everything ---------------------------------------
  async logout(): Promise<void> {
    memoryAccessToken = null;
    if (isWeb) {
      webDelete(SECURE_KEY_REFRESH);
    } else {
      await SecureStore.deleteItemAsync(SECURE_KEY_REFRESH).catch(() => undefined);
    }
    getMmkv('jp.auth').clearAll();
  },
};
