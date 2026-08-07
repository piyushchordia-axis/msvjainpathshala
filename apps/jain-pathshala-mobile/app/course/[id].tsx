import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { AppHeader } from "@/components/AppHeader";
import { Screen, StateView } from "@/components/ui";
import { CourseTreeView } from "@/components/CourseTree";

export default function LearnerCourseDetailScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { activeStudentId, activeChild } = useSessionView();
  const params = useLocalSearchParams<{ id: string }>();
  const courseId = String(params.id ?? "");

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader title={hi ? "पाठ्यक्रम प्रगति" : "Course progress"} />
      <Screen>
        {!activeStudentId ? (
          <StateView
            status="empty"
            emptyText={hi ? "पहले बच्चा चुनें।" : "Pick a child first."}
          />
        ) : (
          <CourseTreeView
            courseId={courseId}
            studentId={activeStudentId}
            studentName={activeChild?.full_name ?? (hi ? "विद्यार्थी" : "Student")}
            mode="learner"
          />
        )}
      </Screen>
    </View>
  );
}
