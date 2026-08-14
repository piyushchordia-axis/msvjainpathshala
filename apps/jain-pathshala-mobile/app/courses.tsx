/**
 * Parent / student course catalogue — folder cards + ChildSwitcher.
 */
import { View } from "react-native";
import { router } from "expo-router";
import { useLocale } from "@/contexts/LocaleContext";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { useAuth } from "@/contexts/AuthContext";
import { AppHeader } from "@/components/AppHeader";
import { ChildSwitcher } from "@/components/ChildSwitcher";
import { CourseFolderCard } from "@/components/CourseFolderCard";
import { Button, Screen, StateView } from "@/components/ui";
import { routeForRole } from "@/lib/roles";
import {
  useCoursesCatalogue,
  usePublicCoursesCatalogue,
  useStudentCertificates,
} from "@/lib/queries";

function courseSubtitle(course: {
  academic_year: string | null;
  kind: string;
}): string {
  return course.academic_year ? course.academic_year : course.kind;
}

export default function CoursesCatalogueScreen() {
  const { hi } = useLocale();
  const { user } = useAuth();
  const guest = !user;
  const { children, loading, isError, activeStudentId, refetch } = useSessionView();
  const memberQ = useCoursesCatalogue(activeStudentId ?? undefined, !guest && !!activeStudentId);
  const publicQ = usePublicCoursesCatalogue(guest);
  const coursesQ = guest ? publicQ : memberQ;
  const courses = coursesQ.data?.items ?? [];
  const certsQ = useStudentCertificates(activeStudentId ?? undefined, !guest && !!activeStudentId);
  const courseCertTitles = new Set<string>();
  for (const row of certsQ.data?.items ?? []) {
    if (row.kind !== "course" || row.voided_at) continue;
    if (row.title_en) courseCertTitles.add(row.title_en);
    if (row.title_hi) courseCertTitles.add(row.title_hi);
  }

  const certificatesBtn = guest ? undefined : (
    <Button
      compact
      variant="outline"
      label={hi ? "प्रमाणपत्र" : "Certificates"}
      icon="ribbon-outline"
      onPress={() => router.push("/certificates" as never)}
    />
  );

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
        showBack
        backHref={routeForRole(user?.role)}
        right={certificatesBtn}
      />
      <Screen
        refreshing={coursesQ.isFetching}
        onRefresh={() => {
          if (!guest) refetch();
          void coursesQ.refetch();
          if (!guest) void certsQ.refetch();
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
            <View style={{ gap: 10 }}>
              {courses.map((course) => {
                const title = hi ? course.name_hi || course.name_en : course.name_en;
                return (
                  <CourseFolderCard
                    key={course.id}
                    title={title}
                    subtitle={courseSubtitle(course)}
                    showChevron
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
              <View style={{ gap: 10 }}>
                {courses.map((course) => {
                  const title = hi ? course.name_hi || course.name_en : course.name_en;
                  const certified =
                    courseCertTitles.has(course.name_en) ||
                    (!!course.name_hi && courseCertTitles.has(course.name_hi));
                  return (
                    <CourseFolderCard
                      key={course.id}
                      title={title}
                      subtitle={courseSubtitle(course)}
                      showChevron
                      certificateLabel={
                        certified ? (hi ? "प्रमाणपत्र" : "Certificate") : null
                      }
                      onCertificatePress={
                        certified
                          ? () => router.push("/certificates" as never)
                          : undefined
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
