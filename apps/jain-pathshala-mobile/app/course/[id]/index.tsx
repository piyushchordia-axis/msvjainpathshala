import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { AppHeader } from "@/components/AppHeader";
import { ChildSwitcher } from "@/components/ChildSwitcher";
import { CourseLearnerOutline } from "@/components/CourseLearnerOutline";
import { Screen, StateView } from "@/components/ui";
import { useCourseTree } from "@/lib/queries";

export default function LearnerCourseDetailScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { children, loading, isError, activeStudentId, refetch } = useSessionView();
  const params = useLocalSearchParams<{ id: string }>();
  const courseId = String(params.id ?? "");
  const treeQ = useCourseTree(courseId, activeStudentId ?? undefined, !!activeStudentId);
  const courseTitle = treeQ.data
    ? hi
      ? treeQ.data.course.name_hi || treeQ.data.course.name_en
      : treeQ.data.course.name_en
    : hi
      ? "पाठ्यक्रम"
      : "Course";

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader compact title={courseTitle} />
      <Screen
        refreshing={treeQ.isFetching}
        onRefresh={() => {
          refetch();
          void treeQ.refetch();
        }}
        contentStyle={{ paddingTop: 0, gap: 8 }}
      >
        {loading ? (
          <StateView status="loading" emptyText="" />
        ) : isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "जानकारी लोड नहीं हुई।" : "Could not load your children."}
            onRetry={refetch}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : children.length === 0 ? (
          <StateView
            status="empty"
            emptyText={
              hi
                ? "आपके खाते से कोई बच्चा जुड़ा नहीं है।"
                : "No children linked to your account yet."
            }
          />
        ) : !activeStudentId ? (
          <StateView
            status="empty"
            emptyText={hi ? "पहले बच्चा चुनें。" : "Pick a child first."}
          />
        ) : (
          <>
            <ChildSwitcher />
            <CourseLearnerOutline courseId={courseId} studentId={activeStudentId} />
          </>
        )}
      </Screen>
    </View>
  );
}
