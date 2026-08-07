/**
 * Parent / student course catalogue (CU3 — long list by design).
 */
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { bodyFamily } from "@/constants/typography";
import { AppHeader } from "@/components/AppHeader";
import { Body, Button, Card, Pill, Screen, StateView } from "@/components/ui";
import { useCoursesCatalogue } from "@/lib/queries";

export default function CoursesCatalogueScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { activeStudentId, activeChild } = useSessionView();
  const coursesQ = useCoursesCatalogue(!!activeStudentId);
  const courses = coursesQ.data?.items ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader
        title={hi ? "पाठ्यक्रम" : "Courses"}
        subtitle={
          activeChild
            ? hi
              ? `${activeChild.full_name ?? "बच्चा"} के सक्रिय पाठ्यक्रम`
              : `Active courses for ${activeChild.full_name ?? "your child"}`
            : undefined
        }
      />
      <Screen
        refreshing={coursesQ.isFetching}
        onRefresh={() => void coursesQ.refetch()}
      >
        <Button
          variant="outline"
          label={hi ? "प्रमाणपत्र देखें" : "View certificates"}
          onPress={() => router.push("/certificates" as never)}
          disabled={!activeStudentId}
        />

        {!activeStudentId ? (
          <StateView
            status="empty"
            emptyText={
              hi
                ? "पहले बच्चा चुनें।"
                : "Pick a child first."
            }
          />
        ) : coursesQ.isLoading ? (
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
                ? "अभी कोई सक्रिय पाठ्यक्रम नहीं। नगर प्रशासक से प्रकाशित करवाएँ।"
                : "No active courses yet. Ask a city admin to publish one."
            }
          />
        ) : (
          courses.map((course) => {
            const title = hi ? course.name_hi || course.name_en : course.name_en;
            return (
              <Pressable
                key={course.id}
                onPress={() =>
                  router.push(`/course/${course.id}` as never)
                }
              >
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
                  </View>
                  <Body muted style={{ lineHeight: 22, fontSize: 12 }}>
                    {hi
                      ? "खोलकर शुरू करें, बंद करें या फिर खोलें।"
                      : "Open to start, close, or reopen nodes."}
                  </Body>
                </Card>
              </Pressable>
            );
          })
        )}
      </Screen>
    </View>
  );
}
