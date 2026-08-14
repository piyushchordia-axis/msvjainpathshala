import { useCallback, useMemo } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { useRouter } from "expo-router";
import { useLocale } from "@/contexts/LocaleContext";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { useColors } from "@/hooks/useColors";
import { useNiyamCatalog, useStudentNiyams } from "@/lib/queries";
import type { NiyamCatalogRow } from "@/lib/types";
import { AppHeader } from "@/components/AppHeader";
import { ChildSwitcher } from "@/components/ChildSwitcher";
import { NiyamCatalogEntry } from "@/components/NiyamCatalogEntry";
import { NiyamSubmissionsList } from "@/components/NiyamSubmissionsList";
import { Body, Button, StateView, Title } from "@/components/ui";

/** Fetch one extra so preview can detect “more than 2” without a full list. */
const PREVIEW_FETCH = 3;

export default function ParentNiyams() {
  const { hi } = useLocale();
  const router = useRouter();
  const c = useColors();
  const { children, loading, isError, activeStudentId, refetch } = useSessionView();
  const niyams = useStudentNiyams(activeStudentId ?? undefined, { limit: PREVIEW_FETCH });
  const catalog = useNiyamCatalog(!!activeStudentId, activeStudentId);
  const items = niyams.data?.items ?? [];
  const catalogRows = catalog.data?.items ?? [];

  const onRefresh = useCallback(() => {
    refetch();
    void niyams.refetch();
    void catalog.refetch();
  }, [refetch, niyams, catalog]);

  const header = useMemo(() => {
    if (loading) return <StateView status="loading" emptyText="" />;
    if (isError) {
      return (
        <StateView
          status="error"
          emptyText=""
          errorText={hi ? "जानकारी लोड नहीं हुई।" : "Could not load your children."}
          onRetry={refetch}
          retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
        />
      );
    }
    if (children.length === 0) {
      return (
        <StateView
          status="empty"
          emptyText={
            hi
              ? "आपके खाते से कोई बच्चा जुड़ा नहीं है।"
              : "No children linked to your account yet."
          }
        />
      );
    }
    return (
      <View>
        <ChildSwitcher />

        <View style={{ alignItems: "flex-end", marginTop: 10, marginBottom: 10 }}>
          <Button
            label={hi ? "नियम प्रस्तुत करें" : "Submit Niyam"}
            icon="sparkles-outline"
            variant="primary"
            compact
            onPress={() => router.push("/niyam-submit")}
          />
        </View>

        {niyams.isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : niyams.isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "नियम लोड नहीं हुए।" : "Could not load niyams."}
            onRetry={niyams.refetch}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : items.length === 0 ? (
          <StateView
            status="empty"
            emptyText={hi ? "अभी कोई नियम दर्ज नहीं है।" : "No niyams submitted yet."}
          />
        ) : (
          <NiyamSubmissionsList items={items} hi={hi} preview />
        )}

        <Title style={{ fontSize: 17, marginTop: 14, marginBottom: 4 }}>
          {hi ? "नियम सूची" : "Niyam catalog"}
        </Title>
        <Body muted style={{ fontSize: 12, marginBottom: 8 }}>
          {hi
            ? "लकीर और बैज नीचे दिखते हैं।"
            : "Streak and badges appear below each Niyam."}
        </Body>

        {catalog.isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : catalog.isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "नियम सूची लोड नहीं हुई।" : "Could not load the niyam catalog."}
            onRetry={catalog.refetch}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : catalogRows.length === 0 ? (
          <StateView
            status="empty"
            emptyText={hi ? "अभी कोई नियम उपलब्ध नहीं है।" : "No niyams available yet."}
          />
        ) : null}
      </View>
    );
  }, [
    loading,
    isError,
    children.length,
    hi,
    refetch,
    router,
    niyams.isLoading,
    niyams.isError,
    niyams.refetch,
    items,
    catalog.isLoading,
    catalog.isError,
    catalog.refetch,
    catalogRows.length,
  ]);

  const listData: NiyamCatalogRow[] =
    !loading && !isError && children.length > 0 && !catalog.isLoading && !catalog.isError
      ? catalogRows
      : [];

  return (
    <ActivityThemed accent="niyam">
      <AppHeader
        title={hi ? "नियम" : "Niyams"}
        subtitle={hi ? "आपके बच्चे के संकल्प" : "Your child's submissions"}
      />
      <FlatList
        style={{ flex: 1, backgroundColor: c.activityNiyam }}
        data={listData}
        keyExtractor={(row) => row.id}
        renderItem={({ item: row }) => (
          <View style={{ marginBottom: 10 }}>
            <NiyamCatalogEntry
              row={row}
              hi={hi}
              onPress={() => router.push("/niyam-submit")}
            />
          </View>
        )}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 110 }}
        refreshControl={
          <RefreshControl
            refreshing={niyams.isRefetching || catalog.isRefetching}
            onRefresh={onRefresh}
            tintColor={c.primary}
            colors={[c.primary]}
          />
        }
      />
    </ActivityThemed>
  );
}
