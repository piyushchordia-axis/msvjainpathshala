/**
 * AuthContext — owns the current-user state at render time.
 *
 * Sources of truth:
 *   - access token: `authStore.getAccessToken()` (memory only)
 *   - refresh token: `authStore.getRefreshToken()` (SecureStore)
 *   - user snapshot: `authStore.getSnapshot()` (MMKV `jp.auth`)
 *
 * On mount we:
 *   1. Read the snapshot from MMKV to render quickly with the cached user.
 *   2. If no snapshot → status `unauthenticated`.
 *   3. If snapshot present but no in-memory access token → trigger a
 *      refresh; on success rehydrate, on failure clear and set
 *      `unauthenticated`.
 *
 * `signIn(verifyResponse)` is called from the OTP screen on successful
 * verification. `signOut()` wipes secure store + MMKV + Zustand.
 */

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

import { runRefresh } from '@/api/client';
import { authApi, type AuthUser, type OtpVerifyResponse } from '@/api/endpoints/auth';
import { registerDeviceToken, unregisterDeviceToken } from '@/notifications/device-token';
import { authStore } from '@/storage/stores/auth.store';
import { profileStore } from '@/storage/stores/profile.store';
import { syncEngine } from '@/sync/sync-engine';
import { syncApi } from '@/sync/sync.api';

import type { AuthSnapshot } from '@/storage/types';

/** 24h — after this, cold-start prefers a full bootstrap over a delta. */
const BOOTSTRAP_REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

async function hydrateOfflineCache(): Promise<void> {
  const last = profileStore.get().last_sync_at;
  const lastMs = last ? Date.parse(last) : 0;
  const stale = !last || Date.now() - lastMs > BOOTSTRAP_REFRESH_AFTER_MS;
  try {
    if (stale) {
      const bootstrap = await syncApi.bootstrap();
      profileStore.set({ last_sync_at: bootstrap.generated_at });
    } else {
      const delta = await syncApi.delta(last!);
      profileStore.set({ last_sync_at: delta.generated_at });
    }
  } catch {
    // Best-effort — first launch on a flaky network shouldn't block sign-in.
  }
}

export type AuthStatus = 'booting' | 'unauthenticated' | 'authenticated';

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  view: 'parent' | 'student' | null;
  signIn(response: OtpVerifyResponse): Promise<void>;
  signOut(): Promise<void>;
  refreshMe(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('booting');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [view, setView] = useState<'parent' | 'student' | null>(null);

  const hydrate = useCallback(async () => {
    const snap = authStore.getSnapshot();
    if (!snap) {
      setStatus('unauthenticated');
      return;
    }
    setUser(snap.user);
    setView(snap.view);

    // We have a snapshot. If the access token is missing from memory (cold
    // start) try to refresh — silent if it works, fall back to logged-out
    // if it doesn't.
    if (!authStore.getAccessToken()) {
      const refresh = await authStore.getRefreshToken();
      if (!refresh) {
        await authStore.logout();
        setStatus('unauthenticated');
        return;
      }
      try {
        // Funnel through the client's single-flight runRefresh() so this and
        // any request-interceptor pre-emptive refresh share ONE in-flight
        // call — otherwise two concurrent refreshes reuse the same token and
        // the backend's reuse-detection revokes the family (everything 401s).
        // The refresh handler (endpoints/auth.ts) already persists the new
        // access + refresh tokens and updates the snapshot.
        await runRefresh();
      } catch {
        await authStore.logout();
        setUser(null);
        setView(null);
        setStatus('unauthenticated');
        return;
      }
    }
    setStatus('authenticated');
    // Refresh the device's push token on every cold-start (FCM rotates).
    void registerDeviceToken();
    // Step 14 — pull the latest working set (delta if recent, full bootstrap
    // otherwise). Non-blocking; the UI renders from MMKV caches in the meantime.
    void hydrateOfflineCache();
  }, []);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Start the sync engine when the user is authenticated; stop on logout
  // so we don't ping the API while no one's signed in.
  useEffect(() => {
    if (status === 'authenticated') {
      syncEngine.start();
      return () => syncEngine.stop();
    }
    return undefined;
  }, [status]);

  const signIn = useCallback(async (response: OtpVerifyResponse) => {
    authStore.setAccessToken(response.tokens.access_token);
    await authStore.setRefreshToken(response.tokens.refresh_token);
    const snap: AuthSnapshot = {
      user: response.user,
      view: response.default_view_context ?? null,
      access_expires_at: response.tokens.access_expires_at,
      refresh_expires_at: response.tokens.refresh_expires_at,
    };
    authStore.setSnapshot(snap);
    // Sync language preference to the device so cold restart matches.
    profileStore.set({
      preferred_language: response.user.preferred_language,
      last_login_phone: response.user.phone,
    });
    setUser(response.user);
    setView(snap.view);
    setStatus('authenticated');
    // Step 12 — register the device's push token now that we have a JWT.
    // Best-effort; failure surfaces in the dev log but never blocks sign-in.
    void registerDeviceToken();
    // Step 14 — hydrate the offline-cache working set right after sign-in.
    void hydrateOfflineCache();
  }, []);

  const signOut = useCallback(async () => {
    await unregisterDeviceToken().catch(() => undefined);
    await authApi.logout().catch(() => undefined);
    // Force a full bootstrap on the NEXT sign-in by clearing the delta cursor.
    profileStore.set({ last_sync_at: undefined });
    setUser(null);
    setView(null);
    setStatus('unauthenticated');
  }, []);

  const refreshMe = useCallback(async () => {
    try {
      // GET /v1/auth/me returns the user fields flat in `data`, not wrapped
      // in `{ user }`. See authApi.me() docstring.
      const u = await authApi.me();
      setUser(u);
      const snap = authStore.getSnapshot();
      if (snap) authStore.setSnapshot({ ...snap, user: u });
    } catch {
      // Ignore — surfaced via the next 401-driven refresh.
    }
  }, []);

  return (
    <AuthContext.Provider value={{ status, user, view, signIn, signOut, refreshMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}
