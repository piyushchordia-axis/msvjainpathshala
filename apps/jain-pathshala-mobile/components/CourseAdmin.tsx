/**
 * Shikshak / Sanchalak course list — Q12 requires both personas in the same release.
 */
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { bodyFamily } from "@/constants/typography";
import { AppHeader } from "@/components/AppHeader";
import { CentreSwitcher, usePersistedCentreId } from "@/components/CentreSwitcher";
import { Body, Card, Pill, Screen, StateView, Title } from "@/components/ui";
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

  const [batchId, setBatchId] = useState<string | null>(
    typeof params.batch_id === "string" ? params.batch_id : null,
  );
  const [studentId, setStudentId] = useState<string | null>(
    typeof params.student_id === "string" ? params.student_id : null,
  );

  useEffect(() => {
    if (typeof params.student_id === "string") setStudentId(params.student_id);
    if (typeof params.batch_id === "string") setBatchId(params.batch_id);
  }, [params.student_id, params.batch_id]);

  const studentsQ = useAdminStudents({
    status: "active",
    batchId: batchId ?? undefined,
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

  const selectedStudent = students.find((s) => s.id === studentId) ?? null;
  const courses = coursesQ.data?.items ?? [];

  function openCourse(courseId: string) {
    if (!studentId || !selectedStudent) {
      Alert.alert(
        hi ? "विद्यार्थी चुनें" : "Select a student",
        hi
          ? "पाठ्यक्रम खोलने से पहले ऊपर विद्यार्थी चुनें।"
          : "Pick a student above before opening a course.",
      );
      return;
    }
    const base = isSanchalak ? "/admin/course" : "/shikshak/course";
    const qs = new URLSearchParams({
      student_id: studentId,
      student_name: selectedStudent.full_name ?? selectedStudent.student_code,
    });
    if (batchId) qs.set("batch_id", batchId);
    router.push(`${base}/${courseId}?${qs.toString()}` as never);
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader
        title={hi ? "पाठ्यक्रम" : "Courses"}
        subtitle={
          hi
            ? "सामूहिक प्रगति और प्रति-विद्यार्थी प्रमाणन"
            : "Bulk progress and per-student certification"
        }
      />
      <Screen
        refreshing={coursesQ.isFetching}
        onRefresh={() => {
          void coursesQ.refetch();
          void batchesQ.refetch();
          void studentsQ.refetch();
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

        <Card style={{ gap: 10 }}>
          <Title style={{ fontSize: 16, lineHeight: 24 }}>
            {hi ? "बैच और विद्यार्थी" : "Batch and student"}
          </Title>
          <Body muted style={{ lineHeight: 22, fontSize: 13 }}>
            {hi
              ? "सामूहिक बंद के लिए बैच चुनें। प्रमाणन हमेशा एक विद्यार्थी पर होता है।"
              : "Pick a batch for bulk close. Certification is always per student."}
          </Body>
          <ChipRow
            label={hi ? "बैच" : "Batch"}
            options={batches.map((b) => ({
              id: b.id,
              label: b.name ?? b.centre_name,
            }))}
            value={batchId}
            onChange={(id) => {
              setBatchId(id);
              setStudentId(null);
            }}
            hi={hi}
          />
          <ChipRow
            label={hi ? "विद्यार्थी" : "Student"}
            options={students.slice(0, 40).map((s) => ({
              id: s.id,
              label: s.full_name ?? s.student_code,
            }))}
            value={studentId}
            onChange={setStudentId}
            hi={hi}
          />
        </Card>

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
              <Pressable key={course.id} onPress={() => openCourse(course.id)}>
                <Card style={{ gap: 6 }}>
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
                </Card>
              </Pressable>
            );
          })
        )}
      </Screen>
    </View>
  );
}

function ChipRow(props: {
  label: string;
  options: Array<{ id: string; label: string }>;
  value: string | null;
  onChange: (id: string | null) => void;
  hi: boolean;
}) {
  const c = useColors();
  return (
    <View style={{ gap: 6 }}>
      <Body muted style={{ fontSize: 12, lineHeight: 20 }}>
        {props.label}
      </Body>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Pressable
          onPress={() => props.onChange(null)}
          style={{
            paddingVertical: 8,
            paddingHorizontal: 12,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: !props.value ? c.primary : c.border,
            backgroundColor: !props.value ? c.primary : c.card,
          }}
        >
          <Text
            style={{
              fontSize: 13,
              lineHeight: 22,
              color: !props.value ? c.primaryForeground : c.foreground,
              fontFamily: bodyFamily(props.hi),
            }}
          >
            {props.hi ? "सभी" : "All"}
          </Text>
        </Pressable>
        {props.options.map((o) => {
          const active = props.value === o.id;
          return (
            <Pressable
              key={o.id}
              onPress={() => props.onChange(o.id)}
              style={{
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: active ? c.primary : c.border,
                backgroundColor: active ? c.primary : c.card,
                maxWidth: "100%",
              }}
            >
              <Text
                style={{
                  fontSize: 13,
                  lineHeight: 22,
                  color: active ? c.primaryForeground : c.foreground,
                  fontFamily: bodyFamily(props.hi),
                }}
                numberOfLines={2}
              >
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
