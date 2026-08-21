/**
 * Shared course detail — browse (no student) or certify (student_id present).
 */
import { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";
import { bodyFamily } from "@/constants/typography";
import { AppHeader } from "@/components/AppHeader";
import { CourseBrowseOutline } from "@/components/CourseBrowseOutline";
import { CourseTreeView } from "@/components/CourseTree";
import { Body, Button, Screen, StateView, Title } from "@/components/ui";
import { useAdminBatches, useAdminStudentDetail, useAdminStudents } from "@/lib/queries";

export function CourseDetailScreen({ persona }: { persona: "shikshak" | "sanchalak" }) {
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

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerBatchId, setPickerBatchId] = useState<string | null>(batchId);
  const [pickerQ, setPickerQ] = useState("");

  const batchesQ = useAdminBatches(pickerOpen);
  const studentsQ = useAdminStudents({
    status: "active",
    batchId: pickerBatchId ?? undefined,
    q: pickerQ.trim() || undefined,
    enabled: pickerOpen,
  });
  // H18 — a resolvable batch_id must not depend on the picker's optional
  // batch chip: when the route carries none, fall back to the selected
  // student's own batch so CU13 bulk controls stay reachable.
  const studentDetailQ = useAdminStudentDetail(
    !batchId && studentId ? studentId : undefined,
    !batchId && !!studentId,
  );
  const effectiveBatchId = batchId ?? studentDetailQ.data?.batch_id ?? null;

  const batches = batchesQ.data?.items ?? [];
  const students = useMemo(
    () => (studentsQ.data?.pages ?? []).flatMap((p) => p.items),
    [studentsQ.data?.pages],
  );

  function applyStudent(student: {
    id: string;
    full_name: string | null;
    student_code: string;
    batch_id?: string | null;
  }) {
    const name = (student.full_name ?? student.student_code).trim();
    const qs = new URLSearchParams({
      student_id: student.id,
      student_name: name,
    });
    // H18 — matches CourseAdmin.tsx's pickStudent: fall back to the
    // student's own batch_id when no chip was picked, rather than leaving
    // bulk controls unreachable.
    const resolvedBatchId = pickerBatchId ?? student.batch_id ?? null;
    if (resolvedBatchId) qs.set("batch_id", resolvedBatchId);
    setPickerOpen(false);
    const base = persona === "sanchalak" ? "/admin/course" : "/shikshak/course";
    router.replace(`${base}/${courseId}?${qs.toString()}` as never);
  }

  const listHref = persona === "sanchalak" ? "/admin/courses" : "/shikshak/courses";
  const base = persona === "sanchalak" ? "/admin/course" : "/shikshak/course";

  function goBack() {
    if (studentId) {
      router.replace(`${base}/${courseId}` as never);
      return;
    }
    router.replace(listHref as never);
  }

  return (
    <ActivityThemed accent="courses">
      <AppHeader
        title={
          studentId
            ? hi
              ? "प्रगति"
              : "Progress"
            : hi
              ? "पाठ्यक्रम"
              : "Course"
        }
        subtitle={studentId ? studentName : undefined}
        showBack
        onBack={goBack}
      />
      <Screen>
        {!courseId ? (
          <StateView
            status="empty"
            emptyText={hi ? "पाठ्यक्रम नहीं मिला।" : "Course not found."}
          />
        ) : studentId ? (
          <CourseTreeView
            courseId={courseId}
            studentId={studentId}
            studentName={studentName}
            mode="admin"
            batchId={effectiveBatchId}
            persona={persona}
          />
        ) : (
          <CourseBrowseOutline
            courseId={courseId}
            onMarkForStudent={() => {
              setPickerBatchId(batchId);
              setPickerQ("");
              setPickerOpen(true);
            }}
          />
        )}
      </Screen>

      <Modal
        visible={pickerOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setPickerOpen(false)}
      >
        <Pressable
          style={{
            flex: 1,
            justifyContent: "flex-end",
            backgroundColor: c.foreground + "73",
            padding: 16,
          }}
          onPress={() => setPickerOpen(false)}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={{
              backgroundColor: c.card,
              borderRadius: c.radius,
              borderWidth: 1,
              borderColor: c.border,
              padding: 16,
              maxHeight: "85%",
              gap: 12,
            }}
          >
            <Title style={{ fontSize: 18, lineHeight: 26 }}>
              {hi ? "विद्यार्थी चुनें" : "Pick a student"}
            </Title>
            <Body muted style={{ lineHeight: 22, fontSize: 13 }}>
              {hi
                ? "इस विद्यार्थी की प्रगति अपडेट करने के लिए।"
                : "To update Progress for this student."}
            </Body>
            <TextInput
              value={pickerQ}
              onChangeText={setPickerQ}
              placeholder={
                hi ? "नाम या विद्यार्थी कोड खोजें…" : "Search name or student code…"
              }
              placeholderTextColor={c.mutedForeground}
              autoCorrect={false}
              autoCapitalize="none"
              style={{
                fontFamily: bodyFamily(hi),
                fontSize: 15,
                color: c.foreground,
                borderWidth: 1,
                borderColor: c.border,
                borderRadius: c.radius,
                paddingHorizontal: 14,
                paddingVertical: 10,
                backgroundColor: c.background,
              }}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8 }}
            >
              <Pressable
                onPress={() => setPickerBatchId(null)}
                accessibilityRole="button"
                accessibilityState={{ selected: !pickerBatchId }}
                hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
                style={{
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                  minHeight: 44,
                  justifyContent: "center",
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: !pickerBatchId ? c.primary : c.border,
                  backgroundColor: !pickerBatchId ? c.primary : c.background,
                }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    lineHeight: 22,
                    color: !pickerBatchId ? c.primaryForeground : c.foreground,
                    fontFamily: bodyFamily(hi),
                  }}
                >
                  {hi ? "सभी बैच" : "All batches"}
                </Text>
              </Pressable>
              {batches.map((b) => {
                const active = pickerBatchId === b.id;
                const batchLabel = b.name ?? b.centre_name;
                return (
                  <Pressable
                    key={b.id}
                    onPress={() => setPickerBatchId(b.id)}
                    accessibilityRole="button"
                    accessibilityLabel={batchLabel}
                    accessibilityState={{ selected: active }}
                    hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
                    style={{
                      paddingVertical: 8,
                      paddingHorizontal: 12,
                      minHeight: 44,
                      justifyContent: "center",
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: active ? c.primary : c.border,
                      backgroundColor: active ? c.primary : c.background,
                      maxWidth: 200,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 13,
                        lineHeight: 22,
                        color: active ? c.primaryForeground : c.foreground,
                        fontFamily: bodyFamily(hi),
                      }}
                      numberOfLines={1}
                    >
                      {batchLabel}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
              {studentsQ.isLoading ? (
                <StateView status="loading" emptyText="" />
              ) : students.length === 0 ? (
                <StateView
                  status="empty"
                  emptyText={
                    hi ? "कोई विद्यार्थी नहीं मिला।" : "No students match this search."
                  }
                />
              ) : (
                <View style={{ gap: 6 }}>
                  {students.map((s) => (
                    <Pressable
                      key={s.id}
                      onPress={() => applyStudent(s)}
                      accessibilityRole="button"
                      accessibilityLabel={s.full_name ?? s.student_code}
                      style={{
                        paddingVertical: 12,
                        paddingHorizontal: 12,
                        minHeight: 44,
                        justifyContent: "center",
                        borderRadius: c.radius,
                        borderWidth: 1,
                        borderColor: c.border,
                        backgroundColor: c.background,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 15,
                          lineHeight: 22,
                          fontFamily: bodyFamily(hi, "semibold"),
                          color: c.foreground,
                        }}
                        numberOfLines={2}
                      >
                        {s.full_name ?? s.student_code}
                      </Text>
                    </Pressable>
                  ))}
                  {/* M27 — the list silently capped at 50 with no way to reach
                      the rest of a large centre's roster. */}
                  {studentsQ.hasNextPage ? (
                    <Pressable
                      onPress={() => void studentsQ.fetchNextPage()}
                      disabled={studentsQ.isFetchingNextPage}
                      accessibilityRole="button"
                      accessibilityLabel={hi ? "और विद्यार्थी लोड करें" : "Load more students"}
                      style={{
                        paddingVertical: 12,
                        minHeight: 44,
                        alignItems: "center",
                        justifyContent: "center",
                        opacity: studentsQ.isFetchingNextPage ? 0.6 : 1,
                      }}
                    >
                      <Body style={{ color: c.primary, lineHeight: 22 }}>
                        {studentsQ.isFetchingNextPage
                          ? hi
                            ? "लोड हो रहा है…"
                            : "Loading…"
                          : hi
                            ? "और विद्यार्थी लोड करें"
                            : "Load more students"}
                      </Body>
                    </Pressable>
                  ) : null}
                </View>
              )}
            </ScrollView>
            <Button
              variant="outline"
              label={hi ? "रद्द करें" : "Cancel"}
              onPress={() => setPickerOpen(false)}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </ActivityThemed>
  );
}
