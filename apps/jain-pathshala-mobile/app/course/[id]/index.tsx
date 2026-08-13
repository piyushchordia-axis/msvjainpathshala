import { useLocalSearchParams } from "expo-router";
import { useLocale } from "@/contexts/LocaleContext";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { useAuth } from "@/contexts/AuthContext";
import { AppHeader } from "@/components/AppHeader";
import { ChildSwitcher } from "@/components/ChildSwitcher";
import { CourseLearnerOutline } from "@/components/CourseLearnerOutline";
import { Screen, StateView } from "@/components/ui";
import { useCourseTree, usePublicCourseTree } from "@/lib/queries";

export default function LearnerCourseDetailScreen() {
  const { hi } = useLocale();
  const { user } = useAuth();
  const guest = !user;
  const { children, loading, isError, activeStudentId, refetch } = useSessionView();
  const params = useLocalSearchParams<{ id: string }>();
  const courseId = String(params.id ?? "");
  const memberQ = useCourseTree(courseId, activeStudentId ?? undefined, !guest && !!activeStudentId);
  const publicQ = usePublicCourseTree(courseId, guest);
  const treeQ = guest ? publicQ : memberQ;
  const courseTitle = treeQ.data
    ? hi
      ? treeQ.data.course.name_hi || treeQ.data.course.name_en
      : treeQ.data.course.name_en
    : hi
      ? "पाठ्यक्रम"
      : "Course";

  return (
    <ActivityThemed accent="courses">
      <AppHeader compact title={courseTitle} />
      <Screen
        refreshing={treeQ.isFetching}
        onRefresh={() => {
          if (!guest) refetch();
          void treeQ.refetch();
        }}
        contentStyle={{ paddingTop: 0, gap: 8 }}
      >
        {guest ? (
          <CourseLearnerOutline courseId={courseId} readOnly />
        ) : loading ? (
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
    </ActivityThemed>
  );
}
