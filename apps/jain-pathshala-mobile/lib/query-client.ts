/**
 * React Query client defaults + offline persistence allow-list.
 *
 * BEFORE (no cache, retry 3, 30s timeout): offline roster open ≈ 90s spinner
 * (REQUEST_TIMEOUT_MS 30_000 × 3 attempts) then error with no roster.
 * AFTER (persist + offlineFirst + retry 2): cache hit renders immediately;
 * miss still caps at 60s (30s × 2 retries) but Guruji keeps last roster.
 *
 * MMKV migration for queue storage is a separate commit — AsyncStorage persister
 * here matches the current storage layer.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient, focusManager, onlineManager } from "@tanstack/react-query";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { AppState, Platform } from "react-native";
import NetInfo from "@react-native-community/netinfo";

import { shouldPersistQueryKey } from "@/lib/query-persist-keys";

const STALE_MS = 5 * 60 * 1000;
const GC_MS = 24 * 60 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: STALE_MS,
      gcTime: GC_MS,
      retry: 2,
      networkMode: "offlineFirst",
      refetchOnWindowFocus: false,
    },
    // Mutations default to networkMode "online", which PAUSES them while
    // NetInfo reports offline: isPending stays true forever and neither
    // onSuccess nor onError ever fires. A student submitting an exam from a
    // basement classroom got an indefinite spinner and, on force-quit, no
    // submission — while the raw-fetch autosave on the same screen failed fast.
    // offlineFirst attempts the request and surfaces a real error instead.
    mutations: {
      networkMode: "offlineFirst",
    },
  },
});

export const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: "jp-query-cache",
});

export const persistOptions = {
  persister: asyncStoragePersister,
  maxAge: GC_MS,
  dehydrateOptions: {
    shouldDehydrateQuery: (query: { queryKey: readonly unknown[] }) =>
      shouldPersistQueryKey(query.queryKey),
  },
} as const;

if (Platform.OS !== "web") {
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => {
      setOnline(state.isConnected != null ? state.isConnected : state.isInternetReachable ?? false);
    }),
  );

  focusManager.setEventListener((handleFocus) => {
    const sub = AppState.addEventListener("change", (status) => {
      handleFocus(status === "active");
    });
    return () => sub.remove();
  });
}
