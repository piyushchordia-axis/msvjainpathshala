/**
 * Subsection list under a section + description content sheet.
 */
import { useMemo, useState } from "react";
import { Alert, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, type Href } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { useAuth } from "@/contexts/AuthContext";
import { bodyFamily } from "@/constants/typography";
import { AppHeader } from "@/components/AppHeader";
import { ChildSwitcher } from "@/components/ChildSwitcher";
import { CourseLearnerRow } from "@/components/CourseLearnerRow";
import { CourseSectionProgress } from "@/components/CourseSectionProgress";
import { Body, Button, Screen, StateView, Title } from "@/components/ui";
import {
  certifiedFrozenExplanation,
  descriptionPreview,
  type CourseProgressStatus,
} from "@/lib/course-labels";
import {
  useCourseTree,
  usePublicCourseTree,
  useSetCourseNodeProgress,
  type CourseTreeSubsection,
} from "@/lib/queries";
import { ApiError } from "@/lib/api";

export default function LearnerSectionScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { user } = useAuth();
  const guest = !user;
  const { children, loading, isError, activeStudentId, refetch } = useSessionView();
  const params = useLocalSearchParams<{ id: string; sectionId: string }>();
  const courseId = String(params.id ?? "");
  const sectionId = String(params.sectionId ?? "");

  const memberQ = useCourseTree(courseId, activeStudentId ?? undefined, !guest && !!activeStudentId);
  const publicQ = usePublicCourseTree(courseId, guest);
  const treeQ = guest ? publicQ : memberQ;
  // H20 — parent/student route through the SAME durable queue path as the
  // shikshak; CU31 scopes offline parity by op type, not persona.
  const setProgress = useSetCourseNodeProgress({ offline: true });
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
    if (guest || !section || !activeStudentId) return;
    if (sub.certified_at) {
      Alert.alert(
        hi ? "प्रमाणित नोड" : "Certified node",
        certifiedFrozenExplanation(hi),
      );
      return;
    }
    setBusyNode(sub.id);
    try {
      // C4 — a single declared write, never a client-side fan-out onto the
      // parent section (CU15/CU16). onMutate already patches the row
      // optimistically (H21), so no immediate refetch is needed here.
      await setProgress.mutateAsync({
        nodeId: sub.id,
        nodeKind: "subsection",
        student_id: activeStudentId,
        status,
      });
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

  /**
   * One renderer for both branches. They used to hold byte-identical copies of
   * this card, which is how the guest view came to be missing things the
   * member view had — and would have drifted again the moment either changed.
   */
  function renderSubsections(
    sec: NonNullable<typeof section>,
    readOnly: boolean,
  ) {
    return (
      <>
        <CourseSectionProgress section={sec} />
        <View
          style={{
            backgroundColor: c.card,
            borderRadius: c.radius,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: c.border,
            marginTop: 2,
            overflow: "visible",
          }}
        >
          {sec.subsections.length === 0 ? (
            <StateView
              status="empty"
              emptyText={
                hi
                  ? "इस अनुभाग में अभी कोई उप-अनुभाग नहीं।"
                  : "No subsections in this section yet."
              }
            />
          ) : (
            sec.subsections.map((sub, i) => (
              <CourseLearnerRow
                key={sub.id}
                index={i + 1}
                title={hi ? sub.title_hi || sub.title_en : sub.title_en}
                caption={descriptionPreview(
                  sub.description_en,
                  sub.description_hi,
                  hi,
                )}
                status={sub.status}
                certifiedAt={readOnly ? null : sub.certified_at}
                certifiedByGender={readOnly ? undefined : sub.certified_by_gender}
                busy={!readOnly && busyNode === sub.id}
                showChevron
                onPress={() => setContentSub(sub)}
                onChangeStatus={
                  readOnly ? undefined : (status) => void changeStatus(sub, status)
                }
              />
            ))
          )}
        </View>
      </>
    );
  }

  return (
    <ActivityThemed accent="courses">
      <AppHeader
        compact
        title={sectionTitle}
        showBack
        backHref={`/course/${courseId}` as Href}
      />
      <Screen
        refreshing={treeQ.isFetching}
        onRefresh={() => {
          if (!guest) refetch();
          void treeQ.refetch();
        }}
        contentStyle={{ paddingTop: 0, gap: 8 }}
      >
        {guest ? (
          treeQ.isLoading ? (
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
            renderSubsections(section, true)
          )
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
            {renderSubsections(section, false)}
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
            {contentSub && !guest && !contentSub.certified_at ? (
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
    </ActivityThemed>
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
