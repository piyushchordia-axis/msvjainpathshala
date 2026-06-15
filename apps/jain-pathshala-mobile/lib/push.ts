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
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { apiPost } from "@/lib/api";

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

  try {
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
