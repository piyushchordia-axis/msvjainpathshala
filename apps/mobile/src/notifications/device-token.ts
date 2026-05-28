/**
 * Mobile push handler — registers the device's FCM/APNs token on login
 * and revokes it on logout.
 *
 * Production: `@react-native-firebase/messaging` provides the real native
 * APIs. The mobile package doesn't depend on it yet (no native modules in
 * an Expo Go workflow), so this file ships a token *provider* function the
 * caller can swap when the native module is added.
 *
 * Dev: the placeholder token returned here is a stable per-device string
 * persisted in MMKV — it surfaces in the API logs so smoke tests can verify
 * the registration pipeline end-to-end without leaving managed Expo.
 *
 * Foreground handling: the iOS/Android system notification path is owned
 * by the native FCM SDK. When the SDK posts to this module's
 * `dispatchForegroundNotification()` we forward to the in-memory listeners
 * registered by the toast component.
 */

import { Platform } from 'react-native';
import { ulid } from 'ulid';

import { notificationsApi } from '@/api/endpoints/notifications';
import { getMmkv } from '@/storage/mmkv';

import type { NotificationFeedItem } from '@/api/endpoints/notifications';

const STORE_KEY = 'jp.notifications.device';
const TOKEN_KEY = 'jp.notifications.fcm_token';
const DEVICE_ID_KEY = 'jp.notifications.device_id';

interface StoredDeviceToken {
  id: string;
  token: string;
}

export type FcmTokenProvider = () => Promise<string | null>;

/**
 * Default provider: returns a stable pseudo-token persisted in MMKV. When
 * `@react-native-firebase/messaging` is wired, replace via
 * `setFcmTokenProvider(messaging().getToken)`.
 */
function defaultDevTokenProvider(): Promise<string | null> {
  const mmkv = getMmkv('jp.notifications');
  let token = mmkv.getString(TOKEN_KEY);
  if (!token) {
    token = `dev-${Platform.OS}-${ulid()}`;
    mmkv.set(TOKEN_KEY, token);
  }
  return Promise.resolve(token);
}

let provider: FcmTokenProvider = defaultDevTokenProvider;

export function setFcmTokenProvider(fn: FcmTokenProvider): void {
  provider = fn;
}

function deviceId(): string {
  const mmkv = getMmkv('jp.notifications');
  let id = mmkv.getString(DEVICE_ID_KEY);
  if (!id) {
    id = ulid();
    mmkv.set(DEVICE_ID_KEY, id);
  }
  return id;
}

function platformLabel(): 'ios' | 'android' | 'web' {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return 'web';
}

/**
 * Register the current device's push token with the backend. Called from
 * the post-OTP-verify flow so a freshly-signed-in user is immediately
 * push-addressable. Safe to call multiple times — backend upserts by token.
 */
export async function registerDeviceToken(): Promise<StoredDeviceToken | null> {
  try {
    const token = await provider();
    if (!token) return null;
    const id = deviceId();
    const res = await notificationsApi.registerDeviceToken({
      platform: platformLabel(),
      token,
      device_id: id,
    });
    const stored: StoredDeviceToken = { id: res.id, token };
    getMmkv('jp.notifications').set(STORE_KEY, JSON.stringify(stored));
    return stored;
  } catch {
    // Not fatal — the user can still use the app, just won't receive push.
    return null;
  }
}

export async function unregisterDeviceToken(): Promise<void> {
  const mmkv = getMmkv('jp.notifications');
  const raw = mmkv.getString(STORE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as StoredDeviceToken;
    if (parsed.id) {
      await notificationsApi.deleteDeviceToken(parsed.id).catch(() => undefined);
    }
  } catch {
    /* corrupted JSON — wipe anyway */
  }
  mmkv.delete(STORE_KEY);
}

// ---------------------------------------------------------------------------
// Foreground notification dispatch (consumed by the toast component)
// ---------------------------------------------------------------------------

type Listener = (notif: NotificationFeedItem) => void;
const listeners = new Set<Listener>();

export function onForegroundNotification(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Called by the native FCM SDK's foreground handler (production) and by
 * the smoke test in dev to simulate an incoming push.
 */
export function dispatchForegroundNotification(notif: NotificationFeedItem): void {
  for (const l of listeners) {
    try {
      l(notif);
    } catch {
      /* listener crash shouldn't break siblings */
    }
  }
}
