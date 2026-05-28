/**
 * Auth store — splits secrets across three tiers per security best
 * practice on RN:
 *
 *   - `access_token` lives ONLY in memory (process-scoped). Stolen MMKV
 *     contents shouldn't reveal an unexpired access token; if the device
 *     reboots, we silently refresh via the refresh token.
 *   - `refresh_token` lives in `expo-secure-store` (Keychain on iOS,
 *     EncryptedSharedPreferences on Android). Hardware-backed where
 *     supported.
 *   - User profile + view context + token TTLs live in MMKV `jp.auth`
 *     so the splash screen can route by role without a refresh round-trip.
 */

import * as SecureStore from 'expo-secure-store';

import { getMmkv } from '../mmkv';

import type { AuthSnapshot } from '../types';

const KEY_USER = 'snapshot';
const SECURE_KEY_REFRESH = 'jp.auth.refresh_token';

let memoryAccessToken: string | null = null;

export const authStore = {
  // ---- Access token (memory) ------------------------------------------
  getAccessToken(): string | null {
    return memoryAccessToken;
  },
  setAccessToken(token: string | null): void {
    memoryAccessToken = token;
  },

  // ---- Refresh token (SecureStore) ------------------------------------
  async getRefreshToken(): Promise<string | null> {
    return SecureStore.getItemAsync(SECURE_KEY_REFRESH);
  },
  async setRefreshToken(token: string | null): Promise<void> {
    if (token === null) {
      await SecureStore.deleteItemAsync(SECURE_KEY_REFRESH);
      return;
    }
    await SecureStore.setItemAsync(SECURE_KEY_REFRESH, token);
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
    await SecureStore.deleteItemAsync(SECURE_KEY_REFRESH).catch(() => undefined);
    getMmkv('jp.auth').clearAll();
  },
};
