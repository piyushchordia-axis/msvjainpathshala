import { useEffect, useMemo, useState } from "react";
import { useLocalSearchParams, router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { LibraryItemDto } from "@workspace/api-zod";
import { useAuth } from "@/contexts/AuthContext";
import { useLocale } from "@/contexts/LocaleContext";
import { apiGet } from "@/lib/api";
import {
  findItemInTrees,
  libraryTreesFromCache,
  type LibraryTreePayload,
} from "@/lib/library/helpers";
import { LibraryTextSheet } from "@/components/LibraryTextSheet";
import { Screen, StateView } from "@/components/ui";

/**
 * Deep-link / returnTo host: loads the item then presents LibraryTextSheet.
 * Dismiss → router.back().
 */
export default function LibraryItemTextHost() {
  const { itemId: raw } = useLocalSearchParams<{ itemId: string }>();
  const itemId = String(raw ?? "");
  const { hi } = useLocale();
  const { user } = useAuth();
  const authed = !!user;
  const qc = useQueryClient();
  const [readerItem, setReaderItem] = useState<LibraryItemDto | null>(null);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["library", authed ? "member" : "public"],
    queryFn: () =>
      authed
        ? apiGet<LibraryTreePayload>("/v1/library")
        : apiGet<LibraryTreePayload>("/v1/public/library"),
  });

  const found = useMemo(() => {
    const fromFetch = data ? findItemInTrees([data], itemId) : null;
    if (fromFetch) return fromFetch;
    return findItemInTrees(libraryTreesFromCache(qc), itemId);
  }, [data, itemId, qc]);

  useEffect(() => {
    if (found?.item) setReaderItem(found.item);
  }, [found]);

  if (isLoading && !found) {
    return (
      <Screen>
        <StateView status="loading" emptyText="" />
      </Screen>
    );
  }

  if ((isError && !found) || !found) {
    return (
      <Screen refreshing={isRefetching} onRefresh={refetch}>
        <StateView
          status="error"
          emptyText=""
          errorText={hi ? "पाठ नहीं मिला।" : "That text could not be found."}
          onRetry={() => void refetch()}
          retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <StateView status="loading" emptyText="" />
      <LibraryTextSheet
        item={readerItem}
        onClose={() => {
          setReaderItem(null);
          if (router.canGoBack()) router.back();
          else router.replace("/(tabs)/library" as never);
        }}
      />
    </Screen>
  );
}
