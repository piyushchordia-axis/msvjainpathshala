/**
 * Learner course outline — numbered section strips (drill into subsections).
 * Admin certify/bulk stays on CourseTreeView.
 */
import { useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { Body, StateView } from "@/components/ui";
import { CourseLearnerRow } from "@/components/CourseLearnerRow";
import { certifiedFrozenExplanation, type CourseProgressStatus } from "@/lib/course-labels";
import {
  useCourseTree,
  useSetCourseNodeProgress,
  type CourseTreeSection,
} from "@/lib/queries";
import { ApiError } from "@/lib/api";

export function CourseLearnerOutline(props: {
  courseId: string;
  studentId: string;
}) {
  const c = useColors();
  const { hi } = useLocale();
  const treeQ = useCourseTree(props.courseId, props.studentId);
  const setProgress = useSetCourseNodeProgress({ offline: false });
  const [busyNode, setBusyNode] = useState<string | null>(null);

  const tree = treeQ.data;

  async function changeStatus(
    section: CourseTreeSection,
    status: CourseProgressStatus,
  ) {
    if (section.certified_at) {
      Alert.alert(
        hi ? "प्रमाणित नोड" : "Certified node",
        certifiedFrozenExplanation(hi),
      );
      return;
    }
    setBusyNode(section.id);
    try {
      await setProgress.mutateAsync({
        nodeId: section.id,
        nodeKind: "section",
        student_id: props.studentId,
        status,
      });
      await treeQ.refetch();
    } catch (err) {
      const msg =
        err instanceof ApiError && err.code === "ERR_COURSE_NODE_CERTIFIED"
          ? certifiedFrozenExplanation(hi)
          : err instanceof ApiError
            ? err.message
            : hi
              ? "प्रगति सहेजी नहीं जा सकी — फिर कोशिश करें।"
              : "Could not save progress — try again.";
      Alert.alert(hi ? "त्रुटि" : "Error", msg);
      await treeQ.refetch();
    } finally {
      setBusyNode(null);
    }
  }

  if (treeQ.isLoading) {
    return <StateView status="loading" emptyText="" />;
  }
  if (treeQ.isError || !tree) {
    return (
      <StateView
        status="error"
        emptyText=""
        errorText={
          hi
            ? "पाठ्यक्रम नहीं खुल सका — रीफ़्रेश करें।"
            : "Could not load this course — pull to refresh."
        }
        onRetry={() => void treeQ.refetch()}
        retryLabel={hi ? "फिर कोशिश करें" : "Try again"}
      />
    );
  }

  const coverage =
    tree.progress.coverage == null
      ? "—"
      : `${Math.round(tree.progress.coverage * 100)}%`;
  const mastery =
    tree.progress.mastery == null
      ? "—"
      : `${Math.round(tree.progress.mastery * 100)}%`;
  const metricsParts = [
    tree.course.academic_year,
    `${hi ? "कवरेज" : "Coverage"} ${coverage}`,
    `${hi ? "निपुणता" : "Mastery"} ${mastery}`,
  ].filter(Boolean);

  return (
    <View style={{ gap: 6 }}>
      <Body muted style={{ fontSize: 12, lineHeight: 18 }} numberOfLines={1}>
        {metricsParts.join(" · ")}
      </Body>

      <View
        style={{
          backgroundColor: c.card,
          borderRadius: c.radius,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: c.border,
          overflow: "hidden",
        }}
      >
        {tree.sections.length === 0 ? (
          <StateView
            status="empty"
            emptyText={
              hi ? "इस पाठ्यक्रम में अभी कोई अनुभाग नहीं।" : "No sections in this course yet."
            }
          />
        ) : (
          tree.sections.map((section, i) => {
            const title = hi ? section.title_hi || section.title_en : section.title_en;
            return (
              <CourseLearnerRow
                key={section.id}
                index={i + 1}
                indexStyle="sec"
                title={title}
                status={section.status}
                certifiedAt={section.certified_at}
                certifiedByGender={section.certified_by_gender}
                busy={busyNode === section.id}
                showChevron
                subtitle={
                  section.subsections.length > 0
                    ? hi
                      ? `${section.subsections.length} उप-अनुभाग`
                      : `${section.subsections.length} subsections`
                    : null
                }
                onPress={() =>
                  router.push(
                    `/course/${props.courseId}/section/${section.id}` as never,
                  )
                }
                onStart={() => void changeStatus(section, "in_progress")}
                onComplete={() => void changeStatus(section, "completed")}
                onReopen={() =>
                  void changeStatus(
                    section,
                    section.status === "completed" ? "in_progress" : "not_started",
                  )
                }
              />
            );
          })
        )}
      </View>
    </View>
  );
}
