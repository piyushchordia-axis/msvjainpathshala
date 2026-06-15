import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

/**
 * Token storage. On native, secrets live in the OS keystore (iOS Keychain /
 * Android Keystore) via expo-secure-store. expo-secure-store has no web
 * implementation, so on Expo-web we fall back to AsyncStorage (localStorage).
 */
const isWeb = Platform.OS === "web";

export const secureStorage = {
  getItem(key: string): Promise<string | null> {
    return isWeb ? AsyncStorage.getItem(key) : SecureStore.getItemAsync(key);
  },
  setItem(key: string, value: string): Promise<void> {
    return isWeb ? AsyncStorage.setItem(key, value) : SecureStore.setItemAsync(key, value);
  },
  removeItem(key: string): Promise<void> {
    return isWeb ? AsyncStorage.removeItem(key) : SecureStore.deleteItemAsync(key);
  },
};
