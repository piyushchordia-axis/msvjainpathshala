/**
 * Parent / student course catalogue — numbered status strips + ChildSwitcher.
 */
import { View } from "react-native";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { useAuth } from "@/contexts/AuthContext";
import { AppHeader } from "@/components/AppHeader";
import { ChildSwitcher } from "@/components/ChildSwitcher";
import { CourseLearnerRow } from "@/components/CourseLearnerRow";
import { Button, Row, Screen, StateView } from "@/components/ui";
import { useCoursesCatalogue, usePublicCoursesCatalogue } from "@/lib/queries";
import type { CourseProgressStatus } from "@/lib/course-labels";

export default function CoursesCatalogueScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { user } = useAuth();
  const guest = !user;
  const { children, loading, isError, activeStudentId, refetch } = useSessionView();
  const memberQ = useCoursesCatalogue(activeStudentId ?? undefined, !guest && !!activeStudentId);
  const publicQ = usePublicCoursesCatalogue(guest);
  const coursesQ = guest ? publicQ : memberQ;
  const courses = coursesQ.data?.items ?? [];

  return (
    <ActivityThemed accent="courses">
      <AppHeader
        title={hi ? "पाठ्यक्रम" : "Courses"}
        subtitle={
          guest
            ? hi
              ? "प्रकाशित पाठ्यक्रम"
              : "Published courses"
            : hi
              ? "सक्रिय पाठ्यक्रम और प्रगति"
              : "Active courses and progress"
        }
      />
      <Screen
        refreshing={coursesQ.isFetching}
        onRefresh={() => {
          if (!guest) refetch();
          void coursesQ.refetch();
        }}
      >
        {guest ? (
          coursesQ.isLoading ? (
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
              retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
            />
          ) : courses.length === 0 ? (
            <StateView
              status="empty"
              emptyText={
                hi
                  ? "अभी कोई सक्रिय पाठ्यक्रम नहीं।"
                  : "No active courses yet."
              }
            />
          ) : (
            <View
              style={{
                backgroundColor: c.card,
                borderRadius: c.radius,
                borderWidth: 1,
                borderColor: c.border,
                overflow: "hidden",
              }}
            >
              {courses.map((course, i) => {
                const title = hi ? course.name_hi || course.name_en : course.name_en;
                const status: CourseProgressStatus = "not_started";
                return (
                  <CourseLearnerRow
                    key={course.id}
                    index={i + 1}
                    title={title}
                    status={status}
                    certifiedAt={null}
                    showChevron
                    subtitle={course.academic_year ? course.academic_year : course.kind}
                    onPress={() => router.push(`/course/${course.id}` as never)}
                  />
                );
              })}
            </View>
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
            emptyText={
              hi
                ? "आपकी विद्यार्थी प्रोफ़ाइल अभी तैयार नहीं है।"
                : "Your student profile isn't ready yet."
            }
          />
        ) : (
          <>
            <ChildSwitcher />

            <Row
              style={{
                justifyContent: "flex-end",
                alignItems: "center",
                marginBottom: 6,
                marginTop: 2,
              }}
            >
              <Button
                variant="outline"
                label={hi ? "प्रमाणपत्र" : "Certificates"}
                icon="ribbon-outline"
                onPress={() => router.push("/certificates" as never)}
              />
            </Row>

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
                retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
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
              <View
                style={{
                  backgroundColor: c.card,
                  borderRadius: c.radius,
                  borderWidth: 1,
                  borderColor: c.border,
                  overflow: "hidden",
                }}
              >
                {courses.map((course, i) => {
                  const title = hi ? course.name_hi || course.name_en : course.name_en;
                  // Catalogue has no per-course progress aggregate — neutral strip until opened.
                  const status: CourseProgressStatus = "not_started";
                  return (
                    <CourseLearnerRow
                      key={course.id}
                      index={i + 1}
                      title={title}
                      status={status}
                      certifiedAt={null}
                      showChevron
                      subtitle={
                        course.academic_year
                          ? course.academic_year
                          : course.kind
                      }
                      onPress={() => router.push(`/course/${course.id}` as never)}
                    />
                  );
                })}
              </View>
            )}
          </>
        )}
      </Screen>
    </ActivityThemed>
  );
}
