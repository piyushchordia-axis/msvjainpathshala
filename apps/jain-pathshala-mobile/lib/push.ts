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
import { Platform } from "react-native";
import { apiPost } from "@/lib/api";
import { isExpoGo } from "@/lib/expo-go";

// expo-notifications is imported lazily (below) so it is never loaded in Expo
// Go, where the module logs an error at import time (remote push removed in
// SDK 53). In real builds it loads normally and push works.

const PLACEHOLDER_PROJECT_ID = "00000000-0000-0000-0000-000000000000";

/** EAS projectId is required to mint a push token; read it from app config. */
function getProjectId(): string | null {
  const id =
    Constants.expoConfig?.extra?.eas?.projectId ??
    // Bare/old manifests expose it under easConfig.
    (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
  if (!id || id === PLACEHOLDER_PROJECT_ID) return null;
  return id;
}

/**
 * Resolve this device's Expo push token, requesting permission if needed.
 * Returns null on web, simulators, denied permission, or a missing projectId.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  // Push only works on real hardware; the web build has no notifications API.
  if (Platform.OS === "web" || !Device.isDevice) return null;

  // Remote push was removed from Expo Go (SDK 53+). Skip it there to avoid the
  // expo-notifications error; push works in real builds where isExpoGo is false.
  if (isExpoGo) {
    if (__DEV__) {
      console.log(
        "[push] skipping push registration in Expo Go — use a development build to test notifications",
      );
    }
    return null;
  }

  try {
    const Notifications = await import("expo-notifications");
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (status !== "granted") {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== "granted") return null;

    const projectId = getProjectId();
    if (!projectId) return null;

    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    return token.data ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve the push token and register it with the API. Best-effort: any failure
 * is swallowed so it can never block the sign-in flow.
 */
export async function registerPushTokenWithApi(): Promise<void> {
  try {
    const token = await registerForPushNotificationsAsync();
    if (!token) return;
    await apiPost("/v1/notifications/push-token", {
      expo_token: token,
      platform: Platform.OS,
    });
  } catch (err) {
    if (__DEV__) {
      console.warn("[push] token registration failed", err);
    }
  }
}
