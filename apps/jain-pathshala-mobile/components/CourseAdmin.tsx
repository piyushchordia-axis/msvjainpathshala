/**
 * Shikshak / Sanchalak course list — browse without a student; mark/certify
 * is a short student-scoped path. Q12 requires both personas in the same release.
 */
import { useEffect, useMemo, useState } from "react";
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
import { bodyFamily } from "@/constants/typography";
import { AppHeader } from "@/components/AppHeader";
import { CentreSwitcher, usePersistedCentreId } from "@/components/CentreSwitcher";
import { Body, Button, Card, Pill, Screen, StateView, Title } from "@/components/ui";
import {
  useAdminBatches,
  useAdminCentres,
  useAdminCourses,
  useAdminStudents,
} from "@/lib/queries";

export type CourseAdminPersona = "shikshak" | "sanchalak";

const CENTRE_KEY = "jp.sanchalak.selectedCentreId";

export default function CourseAdmin({ persona }: { persona: CourseAdminPersona }) {
  const c = useColors();
  const { hi } = useLocale();
  const isSanchalak = persona === "sanchalak";
  const params = useLocalSearchParams<{
    student_id?: string;
    student_name?: string;
    batch_id?: string;
  }>();
  const coursesQ = useAdminCourses("active");
  const batchesQ = useAdminBatches();
  const centresQ = useAdminCentres(isSanchalak);
  const centres = useMemo(
    () =>
      (centresQ.data?.items ?? []).map((x) => ({
        centre_id: x.id,
        centre_name: x.name,
      })),
    [centresQ.data?.items],
  );
  const [selectedCentreId, pickCentre] = usePersistedCentreId(centres, CENTRE_KEY);

  const [pinnedStudentId, setPinnedStudentId] = useState<string | null>(
    typeof params.student_id === "string" ? params.student_id : null,
  );
  const [pinnedStudentName, setPinnedStudentName] = useState(
    typeof params.student_name === "string" ? params.student_name.trim() : "",
  );
  const [pinnedBatchId, setPinnedBatchId] = useState<string | null>(
    typeof params.batch_id === "string" ? params.batch_id : null,
  );

  const [pickerCourseId, setPickerCourseId] = useState<string | null>(null);
  const [pickerBatchId, setPickerBatchId] = useState<string | null>(null);
  const [pickerQ, setPickerQ] = useState("");

  useEffect(() => {
    if (typeof params.student_id === "string") setPinnedStudentId(params.student_id);
    if (typeof params.student_name === "string") {
      setPinnedStudentName(params.student_name.trim());
    }
    if (typeof params.batch_id === "string") setPinnedBatchId(params.batch_id);
  }, [params.student_id, params.student_name, params.batch_id]);

  const studentsQ = useAdminStudents({
    status: "active",
    batchId: pickerBatchId ?? undefined,
    q: pickerQ.trim() || undefined,
    enabled: !!pickerCourseId,
  });

  const batches = useMemo(() => {
    const items = batchesQ.data?.items ?? [];
    if (!isSanchalak || !selectedCentreId) return items;
    return items.filter((b) => b.centre_id === selectedCentreId);
  }, [batchesQ.data?.items, isSanchalak, selectedCentreId]);

  const students = useMemo(
    () => (studentsQ.data?.pages ?? []).flatMap((p) => p.items),
    [studentsQ.data?.pages],
  );

  const courses = coursesQ.data?.items ?? [];
  const courseBase = isSanchalak ? "/admin/course" : "/shikshak/course";

  function openBrowse(courseId: string) {
    router.push(`${courseBase}/${courseId}` as never);
  }

  function openCertify(
    courseId: string,
    studentId: string,
    studentName: string,
    batchId?: string | null,
  ) {
    const qs = new URLSearchParams({
      student_id: studentId,
      student_name: studentName,
    });
    if (batchId) qs.set("batch_id", batchId);
    router.push(`${courseBase}/${courseId}?${qs.toString()}` as never);
  }

  function onMarkCertify(courseId: string) {
    if (pinnedStudentId && pinnedStudentName) {
      openCertify(courseId, pinnedStudentId, pinnedStudentName, pinnedBatchId);
      return;
    }
    setPickerBatchId(pinnedBatchId);
    setPickerQ("");
    setPickerCourseId(courseId);
  }

  function clearPinnedStudent() {
    setPinnedStudentId(null);
    setPinnedStudentName("");
    setPinnedBatchId(null);
    const base = isSanchalak ? "/admin/courses" : "/shikshak/courses";
    router.replace(base as never);
  }

  function pickStudent(student: {
    id: string;
    full_name: string | null;
    student_code: string;
    batch_id?: string | null;
  }) {
    const name = (student.full_name ?? student.student_code).trim();
    const courseId = pickerCourseId;
    const batchId = pickerBatchId ?? student.batch_id ?? null;
    setPinnedStudentId(student.id);
    setPinnedStudentName(name);
    if (batchId) setPinnedBatchId(batchId);
    setPickerCourseId(null);
    if (courseId) openCertify(courseId, student.id, name, batchId);
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader
        title={hi ? "पाठ्यक्रम" : "Courses"}
        subtitle={
          hi
            ? "पाठ्यक्रम देखें · विद्यार्थी के लिए प्रगति अपडेट करें"
            : "View courses · update Progress for a student"
        }
      />
      <Screen
        refreshing={coursesQ.isFetching}
        onRefresh={() => {
          void coursesQ.refetch();
          void batchesQ.refetch();
        }}
      >
        {isSanchalak ? (
          <CentreSwitcher
            centres={centres}
            storageKey={CENTRE_KEY}
            selectedId={selectedCentreId}
            onChange={pickCentre}
          />
        ) : null}

        {pinnedStudentId && pinnedStudentName ? (
          <Card
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              paddingVertical: 12,
            }}
          >
            <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
              <Body muted style={{ fontSize: 12, lineHeight: 18 }}>
                {hi ? "प्रगति के लिए चुना" : "Selected for Progress"}
              </Body>
              <Text
                style={{
                  fontSize: 15,
                  lineHeight: 22,
                  fontFamily: bodyFamily(hi, "semibold"),
                  color: c.foreground,
                }}
                numberOfLines={1}
              >
                {pinnedStudentName}
              </Text>
            </View>
            <Button
              variant="ghost"
              label={hi ? "हटाएँ" : "Clear"}
              onPress={clearPinnedStudent}
            />
          </Card>
        ) : null}

        {coursesQ.isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : coursesQ.isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={
              hi
                ? "पाठ्यक्रम सूची नहीं मिली — फिर कोशिश करें।"
                : "Could not load courses — try again."
            }
            onRetry={() => void coursesQ.refetch()}
          />
        ) : courses.length === 0 ? (
          <StateView
            status="empty"
            emptyText={
              hi
                ? "इस शहर में कोई सक्रिय पाठ्यक्रम नहीं। नगर प्रशासक से प्रकाशित करवाएँ।"
                : "No active courses in scope. Ask a city admin to publish one."
            }
          />
        ) : (
          courses.map((course) => {
            const title = hi ? course.name_hi || course.name_en : course.name_en;
            return (
              <Card key={course.id} style={{ gap: 10 }}>
                <Text
                  style={{
                    fontSize: 16,
                    lineHeight: 24,
                    fontFamily: bodyFamily(hi, "semibold"),
                    color: c.foreground,
                  }}
                >
                  {title}
                </Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  <Pill label={course.kind} />
                  {course.academic_year ? <Pill label={course.academic_year} /> : null}
                  <Pill
                    label={`${course.punya_points} ${hi ? "पुण्य" : "Punya"}`}
                    tone="info"
                  />
                </View>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Button
                      label={hi ? "देखें" : "View"}
                      variant="outline"
                      onPress={() => openBrowse(course.id)}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      label={
                        pinnedStudentId
                          ? hi
                            ? "प्रगति"
                            : "Progress"
                          : hi
                            ? "प्रगति…"
                            : "Progress…"
                      }
                      onPress={() => onMarkCertify(course.id)}
                    />
                  </View>
                </View>
              </Card>
            );
          })
        )}
      </Screen>

      <Modal
        visible={!!pickerCourseId}
        animationType="slide"
        transparent
        onRequestClose={() => setPickerCourseId(null)}
      >
        <Pressable
          style={{
            flex: 1,
            justifyContent: "flex-end",
            backgroundColor: c.foreground + "73",
            padding: 16,
          }}
          onPress={() => setPickerCourseId(null)}
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
                style={{
                  paddingVertical: 8,
                  paddingHorizontal: 12,
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
                return (
                  <Pressable
                    key={b.id}
                    onPress={() => setPickerBatchId(b.id)}
                    style={{
                      paddingVertical: 8,
                      paddingHorizontal: 12,
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
                      {b.name ?? b.centre_name}
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
                  {students.map((s) => {
                    const label = s.full_name ?? s.student_code;
                    return (
                      <Pressable
                        key={s.id}
                        onPress={() => pickStudent(s)}
                        style={{
                          paddingVertical: 12,
                          paddingHorizontal: 12,
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
                          {label}
                        </Text>
                        {s.student_code && s.full_name ? (
                          <Body muted style={{ fontSize: 12, lineHeight: 18, marginTop: 2 }}>
                            {s.student_code}
                          </Body>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </ScrollView>

            <Button
              variant="outline"
              label={hi ? "रद्द करें" : "Cancel"}
              onPress={() => setPickerCourseId(null)}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
