/**
 * True when running inside the Expo Go sandbox app.
 *
 * Expo removed remote push notifications from Expo Go in SDK 53, so any
 * expo-notifications remote-push call logs a (harmless-in-dev but noisy) error
 * there. Code paths that touch remote push are skipped when this is true; they
 * run normally in development / preview / production builds, where it is false.
 *
 * `executionEnvironment === StoreClient` is the canonical check; we also accept
 * the legacy `appOwnership === "expo"` as a defensive fallback.
 */
import Constants, { ExecutionEnvironment } from "expo-constants";

export const isExpoGo: boolean =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient ||
  Constants.appOwnership === "expo";
