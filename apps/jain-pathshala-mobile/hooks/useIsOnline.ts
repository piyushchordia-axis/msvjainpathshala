/**
 * Live connectivity, read from React Query's onlineManager.
 *
 * onlineManager is already wired to NetInfo in `lib/query-client.ts`, so this
 * reuses that single subscription rather than opening a second NetInfo listener
 * that could disagree with the one the query cache is acting on.
 */
import { useEffect, useState } from "react";
import { onlineManager } from "@tanstack/react-query";

export function useIsOnline(): boolean {
  const [online, setOnline] = useState(() => onlineManager.isOnline());
  useEffect(() => {
    setOnline(onlineManager.isOnline());
    return onlineManager.subscribe(() => setOnline(onlineManager.isOnline()));
  }, []);
  return online;
}
