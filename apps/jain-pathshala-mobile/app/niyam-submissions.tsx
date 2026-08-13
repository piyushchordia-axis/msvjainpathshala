import { Stack } from "expo-router";
import { useLocale } from "@/contexts/LocaleContext";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { useStudentNiyams } from "@/lib/queries";
import { NiyamSubmissionsList } from "@/components/NiyamSubmissionsList";
import { Screen, StateView } from "@/components/ui";

export default function NiyamSubmissionsScreen() {
  const { hi } = useLocale();
  const { activeStudentId, activeChild, loading, refetch } = useSessionView();
  const niyams = useStudentNiyams(activeStudentId ?? undefined);
  const items = niyams.data?.items ?? [];

  return (
    <ActivityThemed accent="niyam">
      <Stack.Screen
        options={{ title: hi ? "सभी प्रस्तुतियाँ" : "All submissions" }}
      />
      <Screen
        refreshing={niyams.isRefetching}
        onRefresh={() => {
          refetch();
          niyams.refetch();
        }}
      >
        {loading ? (
          <StateView status="loading" emptyText="" />
        ) : !activeStudentId || !activeChild ? (
          <StateView
            status="empty"
            emptyText={
              hi
                ? "आपकी विद्यार्थी प्रोफ़ाइल अभी तैयार नहीं है।"
                : "Your student profile isn't ready yet."
            }
          />
        ) : niyams.isLoading ? (
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
          <NiyamSubmissionsList items={items} hi={hi} />
        )}
      </Screen>
    </ActivityThemed>
  );
}
