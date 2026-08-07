/**
 * Subsection list under a section + description content sheet.
 */
import { useMemo, useState } from "react";
import { Alert, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { bodyFamily } from "@/constants/typography";
import { AppHeader } from "@/components/AppHeader";
import { ChildSwitcher } from "@/components/ChildSwitcher";
import { CourseLearnerRow } from "@/components/CourseLearnerRow";
import { Body, Button, Screen, StateView, Title } from "@/components/ui";
import {
  certifiedFrozenExplanation,
  type CourseProgressStatus,
} from "@/lib/course-labels";
import {
  useCourseTree,
  useSetCourseNodeProgress,
  type CourseTreeSubsection,
} from "@/lib/queries";
import { ApiError } from "@/lib/api";

export default function LearnerSectionScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { children, loading, isError, activeStudentId, refetch } = useSessionView();
  const params = useLocalSearchParams<{ id: string; sectionId: string }>();
  const courseId = String(params.id ?? "");
  const sectionId = String(params.sectionId ?? "");

  const treeQ = useCourseTree(courseId, activeStudentId ?? undefined, !!activeStudentId);
  const setProgress = useSetCourseNodeProgress({ offline: false });
  const [busyNode, setBusyNode] = useState<string | null>(null);
  const [contentSub, setContentSub] = useState<CourseTreeSubsection | null>(null);

  const section = useMemo(
    () => treeQ.data?.sections.find((s) => s.id === sectionId) ?? null,
    [treeQ.data?.sections, sectionId],
  );

  const sectionTitle = section
    ? hi
      ? section.title_hi || section.title_en
      : section.title_en
    : hi
      ? "अनुभाग"
      : "Section";

  async function changeStatus(sub: CourseTreeSubsection, status: CourseProgressStatus) {
    if (sub.certified_at) {
      Alert.alert(
        hi ? "प्रमाणित नोड" : "Certified node",
        certifiedFrozenExplanation(hi),
      );
      return;
    }
    setBusyNode(sub.id);
    try {
      await setProgress.mutateAsync({
        nodeId: sub.id,
        nodeKind: "subsection",
        student_id: activeStudentId!,
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

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader title={sectionTitle} subtitle={hi ? "उप-अनुभाग" : "Subsections"} />
      <Screen
        refreshing={treeQ.isFetching}
        onRefresh={() => {
          refetch();
          void treeQ.refetch();
        }}
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
        ) : children.length === 0 || !activeStudentId ? (
          <StateView
            status="empty"
            emptyText={hi ? "पहले बच्चा चुनें।" : "Pick a child first."}
          />
        ) : treeQ.isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : treeQ.isError || !section ? (
          <StateView
            status="error"
            emptyText=""
            errorText={
              hi ? "अनुभाग नहीं मिला — वापस जाएँ।" : "Section not found — go back."
            }
            onRetry={() => void treeQ.refetch()}
          />
        ) : (
          <>
            <ChildSwitcher />
            <View
              style={{
                backgroundColor: c.card,
                borderRadius: c.radius,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: c.border,
                overflow: "hidden",
                marginTop: 4,
              }}
            >
              {section.subsections.length === 0 ? (
                <StateView
                  status="empty"
                  emptyText={
                    hi
                      ? "इस अनुभाग में अभी कोई उप-अनुभाग नहीं।"
                      : "No subsections in this section yet."
                  }
                />
              ) : (
                section.subsections.map((sub, i) => {
                  const title = hi ? sub.title_hi || sub.title_en : sub.title_en;
                  return (
                    <CourseLearnerRow
                      key={sub.id}
                      index={i + 1}
                      title={title}
                      status={sub.status}
                      certifiedAt={sub.certified_at}
                      certifiedByGender={sub.certified_by_gender}
                      busy={busyNode === sub.id}
                      showChevron
                      onPress={() => setContentSub(sub)}
                      onStart={() => void changeStatus(sub, "in_progress")}
                      onComplete={() => void changeStatus(sub, "completed")}
                      onReopen={() =>
                        void changeStatus(
                          sub,
                          sub.status === "completed" ? "in_progress" : "not_started",
                        )
                      }
                    />
                  );
                })
              )}
            </View>
          </>
        )}
      </Screen>

      <Modal
        visible={!!contentSub}
        transparent
        animationType="slide"
        onRequestClose={() => setContentSub(null)}
      >
        <Pressable
          style={[styles.backdrop, { backgroundColor: c.foreground + "73" }]}
          onPress={() => setContentSub(null)}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={[
              styles.sheet,
              {
                backgroundColor: c.card,
                borderColor: c.border,
                borderRadius: c.radius,
              },
            ]}
          >
            <Title style={{ fontSize: 18, lineHeight: 26 }}>
              {contentSub
                ? hi
                  ? contentSub.title_hi || contentSub.title_en
                  : contentSub.title_en
                : ""}
            </Title>
            <Text
              style={{
                marginTop: 12,
                fontSize: 15,
                lineHeight: 24,
                color: c.foreground,
                fontFamily: bodyFamily(hi),
              }}
            >
              {(() => {
                if (!contentSub) return "";
                const body = hi
                  ? contentSub.description_hi || contentSub.description_en
                  : contentSub.description_en || contentSub.description_hi;
                return (
                  body ||
                  (hi
                    ? "इस उप-अनुभाग के लिए अभी कोई सामग्री नहीं जोड़ी गई।"
                    : "No content has been added for this subsection yet.")
                );
              })()}
            </Text>
            {contentSub && !contentSub.certified_at ? (
              <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>
                {contentSub.status !== "completed" ? (
                  <View style={{ flex: 1 }}>
                    <Button
                      label={hi ? "पूर्ण करें" : "Mark complete"}
                      onPress={() => {
                        const sub = contentSub;
                        setContentSub(null);
                        void changeStatus(sub, "completed");
                      }}
                    />
                  </View>
                ) : (
                  <View style={{ flex: 1 }}>
                    <Button
                      variant="outline"
                      label={hi ? "फिर खोलें" : "Reopen"}
                      onPress={() => {
                        const sub = contentSub;
                        setContentSub(null);
                        void changeStatus(sub, "in_progress");
                      }}
                    />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Button
                    variant="outline"
                    label={hi ? "बंद करें" : "Close"}
                    onPress={() => setContentSub(null)}
                  />
                </View>
              </View>
            ) : (
              <View style={{ marginTop: 18 }}>
                {contentSub?.certified_at ? (
                  <Body muted style={{ lineHeight: 22, marginBottom: 12 }}>
                    {certifiedFrozenExplanation(hi)}
                  </Body>
                ) : null}
                <Button
                  variant="outline"
                  label={hi ? "बंद करें" : "Close"}
                  onPress={() => setContentSub(null)}
                />
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    padding: 16,
  },
  sheet: {
    padding: 20,
    borderWidth: 1,
    maxHeight: "80%",
  },
});
