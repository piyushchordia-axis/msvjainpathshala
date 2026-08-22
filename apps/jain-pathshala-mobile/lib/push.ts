/**
 * Expo push registration (client-side). Asks for permission, resolves the
 * device's Expo push token, and registers it with the API so the server can
 * deliver notifications (see /v1/notifications/push-token + lib/push.ts on the
 * server). Everything here is best-effort: simulators, web, denied permission,
 * or a missing EAS projectId all return null/no-op rather than throwing, so a
 * failure never blocks sign-in.
 */
import Constants from "expo-constants";
import * as Device from "expo-device";
import { Alert, Platform } from "react-native";
import { apiPost, ApiError } from "@/lib/api";
import { isExpoGo } from "@/lib/expo-go";

// expo-notifications is imported lazily (below) so it is never loaded in Expo
// Go, where the module logs an error at import time (remote push removed in
// SDK 53). In real builds it loads normally and push works.

const PLACEHOLDER_PROJECT_ID = "00000000-0000-0000-0000-000000000000";

/** P-6 — Android 8+ notification channels. A critical notice/notification
 * gets the high-importance channel; everything else gets the default one. */
const DEFAULT_CHANNEL_ID = "default";
const CRITICAL_CHANNEL_ID = "critical";

let channelsReady = false;

/**
 * P-6 (review 2026-08) — there was no setNotificationChannelAsync anywhere,
 * so on Android 8+ every notification landed on the OS default channel at
 * default importance; a critical notice got the same treatment as a routine
 * one. Idempotent — safe to call on every app start.
 */
export async function ensureAndroidNotificationChannels(): Promise<void> {
  if (Platform.OS !== "android" || isExpoGo || channelsReady) return;
  try {
    const Notifications = await import("expo-notifications");
    await Notifications.setNotificationChannelAsync(DEFAULT_CHANNEL_ID, {
      name: "General",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
    await Notifications.setNotificationChannelAsync(CRITICAL_CHANNEL_ID, {
      name: "Important",
      importance: Notifications.AndroidImportance.MAX,
      sound: "default",
      vibrationPattern: [0, 250, 250, 250],
    });
    channelsReady = true;
  } catch {
    // Channel setup is a nicety — never block boot over it.
  }
}

/** EAS projectId is required to mint a push token; read it from app config. */
function getProjectId(): string | null {
  const id =
    Constants.expoConfig?.extra?.eas?.projectId ??
    // Bare/old manifests expose it under easConfig.
    (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
  if (!id || id === PLACEHOLDER_PROJECT_ID) return null;
  return id;
}

export type PushPermissionOutcome =
  | { status: "granted"; token: string }
  | { status: "unsupported" } // web / simulator / Expo Go
  | { status: "denied"; canAskAgain: boolean } // P-6 — distinguishes "never asked" from "hard denied"
  | { status: "no-project-id" }
  | { status: "error" };

/**
 * Resolve this device's Expo push token, requesting permission if needed.
 *
 * P-6 (review 2026-08) — previously returned a bare `null` for every
 * failure mode, so a caller (and the user) could not tell "never asked",
 * "hard denied — needs Settings", "no EAS project configured", and "granted
 * but the token call failed" apart. `canAskAgain` (from getPermissionsAsync,
 * previously read and discarded) is what makes "hard denied" detectable:
 * on iOS a second requestPermissionsAsync call resolves denied with no
 * prompt at all once canAskAgain is false.
 */
export async function registerForPushNotificationsAsync(): Promise<PushPermissionOutcome> {
  // Push only works on real hardware; the web build has no notifications API.
  if (Platform.OS === "web" || !Device.isDevice) return { status: "unsupported" };

  // Remote push was removed from Expo Go (SDK 53+). Skip it there to avoid the
  // expo-notifications error; push works in real builds where isExpoGo is false.
  if (isExpoGo) {
    if (__DEV__) {
      console.log(
        "[push] skipping push registration in Expo Go — use a development build to test notifications",
      );
    }
    return { status: "unsupported" };
  }

  try {
    const Notifications = await import("expo-notifications");
    await ensureAndroidNotificationChannels();

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    let canAskAgain = existing.canAskAgain;
    if (status !== "granted" && canAskAgain) {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
      canAskAgain = req.canAskAgain;
    }
    if (status !== "granted") return { status: "denied", canAskAgain };

    const projectId = getProjectId();
    if (!projectId) return { status: "no-project-id" };

    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token.data) return { status: "error" };
    return { status: "granted", token: token.data };
  } catch {
    return { status: "error" };
  }
}

/**
 * Resolve the push token and register it with the API. Best-effort: any
 * failure is swallowed so it can never block the sign-in flow — except
 * ERR_PUSH_TOKEN_CLAIMED (X-4/P-6, review 2026-08), which previously
 * disappeared into a `__DEV__`-only console.warn. The server's message is
 * already written for the user ("sign out on that device first") — the bug
 * was never showing it, not needing a new one.
 */
export async function registerPushTokenWithApi(): Promise<void> {
  try {
    const outcome = await registerForPushNotificationsAsync();
    if (outcome.status !== "granted") return;
    await apiPost("/v1/notifications/push-token", {
      expo_token: outcome.token,
      platform: Platform.OS,
    });
  } catch (err) {
    if (err instanceof ApiError && err.code === "ERR_PUSH_TOKEN_CLAIMED") {
      Alert.alert(err.message);
      return;
    }
    if (__DEV__) {
      console.warn("[push] token registration failed", err);
    }
  }
}

/**
 * X-4 client half (review 2026-08) — call on sign-out. Without this, a
 * shared family handset kept delivering the signed-out account's
 * notifications forever: the only other thing that frees a token is Expo
 * returning DeviceNotRegistered on a healthy device, which never happens.
 * Best-effort: a sign-out must complete even if this fails.
 */
export async function deactivatePushTokenWithApi(): Promise<void> {
  try {
    const outcome = await registerForPushNotificationsAsync();
    if (outcome.status !== "granted") return;
    await apiPost("/v1/notifications/push-token/deactivate", { expo_token: outcome.token });
  } catch (err) {
    if (__DEV__) console.warn("[push] token deactivation failed", err);
  }
}

let tokenListenerRegistered = false;

/**
 * P-6 (review 2026-08) — there was no addPushTokenListener anywhere, so a
 * token Expo rotates (OS-level, out of the app's control) was never
 * re-registered with the server until the user's next sign-in. Idempotent
 * and safe to call on every app start; the subscription lives for the
 * process lifetime like the rest of this module's registration flow.
 */
export async function watchForPushTokenRotation(): Promise<void> {
  if (tokenListenerRegistered || Platform.OS === "web" || isExpoGo || !Device.isDevice) return;
  tokenListenerRegistered = true;
  try {
    const Notifications = await import("expo-notifications");
    Notifications.addPushTokenListener(() => {
      void registerPushTokenWithApi();
    });
  } catch {
    // Best-effort — the app still works without rotation handling; it just
    // means a rotated token needs a fresh sign-in to re-register, same as
    // the behaviour before this fix.
  }
}
