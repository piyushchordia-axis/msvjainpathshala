import { useCallback, useMemo } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { useRouter } from "expo-router";
import { useLocale } from "@/contexts/LocaleContext";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { useColors } from "@/hooks/useColors";
import { useNiyamCatalog, useStudentNiyams } from "@/lib/queries";
import type { NiyamCatalogRow } from "@/lib/types";
import { AppHeader, ProfileAvatarButton } from "@/components/AppHeader";
import { ChildSwitcher } from "@/components/ChildSwitcher";
import { NiyamCatalogEntry } from "@/components/NiyamCatalogEntry";
import { NiyamSubmissionsList } from "@/components/NiyamSubmissionsList";
import { Body, Button, StateView, Title } from "@/components/ui";

/** Fetch one extra so preview can detect “more than 2” without a full list. */
const PREVIEW_FETCH = 3;

export default function StudentNiyams() {
  const { hi } = useLocale();
  const router = useRouter();
  const c = useColors();
  const { activeStudentId, activeChild, loading, refetch } = useSessionView();

  const submissions = useStudentNiyams(activeStudentId ?? undefined, { limit: PREVIEW_FETCH });
  const catalog = useNiyamCatalog(!!activeStudentId, activeStudentId);

  const submissionRows = submissions.data?.items ?? [];
  const catalogRows = catalog.data?.items ?? [];

  const onRefresh = useCallback(() => {
    refetch();
    void submissions.refetch();
    void catalog.refetch();
  }, [refetch, submissions, catalog]);

  const header = useMemo(() => {
    if (loading) return <StateView status="loading" emptyText="" />;
    if (!activeStudentId || !activeChild) {
      return (
        <StateView
          status="empty"
          emptyText={
            hi
              ? "आपकी विद्यार्थी प्रोफ़ाइल अभी तैयार नहीं है।"
              : "Your student profile isn't ready yet."
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

        {submissions.isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : submissions.isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "नियम लोड नहीं हुए।" : "Could not load your niyams."}
            onRetry={submissions.refetch}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : submissionRows.length === 0 ? (
          <StateView
            status="empty"
            emptyText={hi ? "अभी कोई नियम प्रस्तुत नहीं किया।" : "No niyams submitted yet."}
          />
        ) : (
          <NiyamSubmissionsList items={submissionRows} hi={hi} preview />
        )}

        <Title style={{ fontSize: 16, marginTop: 10, marginBottom: 4 }}>
          {hi ? "नियम सूची" : "Niyam catalog"}
        </Title>
        <Body muted style={{ fontSize: 12, marginBottom: 8 }}>
          {hi
            ? "नियम चुनें — लकीर और बैज नीचे दिखते हैं।"
            : "Tap a Niyam — streak and badges appear below."}
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
    activeStudentId,
    activeChild,
    hi,
    router,
    submissions.isLoading,
    submissions.isError,
    submissions.refetch,
    submissionRows,
    catalog.isLoading,
    catalog.isError,
    catalog.refetch,
    catalogRows.length,
  ]);

  const listData: NiyamCatalogRow[] =
    !loading && activeStudentId && activeChild && !catalog.isLoading && !catalog.isError
      ? catalogRows
      : [];

  return (
    <ActivityThemed accent="niyam">
      <AppHeader
        title={hi ? "नियम" : "Niyams"}
        subtitle={hi ? "आपके संकल्प और नियम सूची" : "Your resolutions and the niyam catalog"}
        right={
          <ProfileAvatarButton
            name={activeChild?.full_name}
            photoUrl={activeChild?.photo_url}
            href="/student/profile"
          />
        }
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
              // Carry the tapped niyam through. Without it the child lands on a
              // blank picker under copy that just told them to tap a Niyam.
              onPress={() =>
                router.push({ pathname: "/niyam-submit", params: { niyam_id: row.id } })
              }
            />
          </View>
        )}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 110 }}
        refreshControl={
          <RefreshControl
            refreshing={submissions.isRefetching || catalog.isRefetching}
            onRefresh={onRefresh}
            tintColor={c.primary}
            colors={[c.primary]}
          />
        }
      />
    </ActivityThemed>
  );
}
