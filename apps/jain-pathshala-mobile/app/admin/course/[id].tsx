import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { AppHeader } from "@/components/AppHeader";
import { Screen, StateView } from "@/components/ui";
import { CourseTreeView } from "@/components/CourseTree";

/** Sanchalak course tree — centre-wide certify (Q12 / CU21). */
export default function AdminCourseDetailScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const params = useLocalSearchParams<{
    id: string;
    student_id?: string;
    student_name?: string;
    batch_id?: string;
  }>();
  const courseId = String(params.id ?? "");
  const studentId = typeof params.student_id === "string" ? params.student_id : "";
  const studentName =
    typeof params.student_name === "string" ? params.student_name : hi ? "विद्यार्थी" : "Student";
  const batchId = typeof params.batch_id === "string" ? params.batch_id : null;

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader title={hi ? "पाठ्यक्रम वृक्ष" : "Course tree"} />
      <Screen>
        {!studentId ? (
          <StateView
            status="empty"
            emptyText={
              hi
                ? "पहले विद्यार्थी चुनें, फिर पाठ्यक्रम खोलें।"
                : "Select a student first, then open the course."
            }
          />
        ) : (
          <CourseTreeView
            courseId={courseId}
            studentId={studentId}
            studentName={studentName}
            mode="admin"
            batchId={batchId}
          />
        )}
      </Screen>
    </View>
  );
}
