/**
 * Public shivir detail.
 *
 * Two things were wrong here. The scanner card rendered for EVERY signed-in
 * user, so every parent and student saw "Volunteers can record attendance here"
 * as the page's most prominent action and tapping it dead-ended in a 404. And a
 * parent had no action at all — no register, nothing — on the one screen where
 * registering is the whole point.
 *
 * The card now appears only for someone who actually holds a volunteer
 * assignment (or an ops role in scope), and parents get the Register CTA.
 */
import { useMemo } from "react";
import { Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  useShivir,
  useShivirSessions,
  useShivirMyRegistrations,
  useMyShivirVolunteering,
  useRegisterForShivir,
  useCancelShivirRegistration,
} from "@/lib/queries";
import { ApiError } from "@/lib/api";
import { formatDateRange } from "@/lib/format";
import { Body, Button, Card, Pill, Screen, StateView, Title, Row as URow } from "@/components/ui";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";

export default function ShivirDetailScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data, isLoading, isError, refetch, isRefetching } = useShivir(id);
  const sessions = useShivirSessions(id);
  const canRegister = !!user && (user.role === "parent" || user.role === "student");
  const myRegs = useShivirMyRegistrations(id, canRegister);
  const volunteering = useMyShivirVolunteering(!!user);

  const register = useRegisterForShivir(id);
  const cancel = useCancelShivirRegistration(id);

  /**
   * Show the scanner only to someone this shivir has actually granted. Gating on
   * "is signed in" was what turned the page's only CTA into a guaranteed 404.
   */
  const isVolunteerHere = useMemo(
    () => (volunteering.data?.items ?? []).some((s) => s.id === id),
    [volunteering.data, id],
  );

  function onRegisterError(err: unknown) {
    const message =
      err instanceof ApiError
        ? err.message
        : hi
          ? "अभी पंजीकरण नहीं हो सका। पुनः प्रयास करें।"
          : "That did not save. Please try again.";
    Alert.alert(hi ? "पंजीकरण" : "Registration", message);
  }

  if (isLoading) {
    return (
      <ActivityThemed accent="shivirs">
        <Screen scroll={false}>
          <StateView status="loading" emptyText="" />
        </Screen>
      </ActivityThemed>
    );
  }
  if (isError || !data) {
    return (
      <ActivityThemed accent="shivirs">
        <Screen scroll={false}>
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "शिविर लोड नहीं हो सका।" : "Could not load this shivir."}
            onRetry={refetch}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        </Screen>
      </ActivityThemed>
    );
  }

  const name = (hi ? data.name_hi : null) ?? data.name_en;
  const description = (hi ? data.description_hi : null) ?? data.description_en;
  const regs = myRegs.data;
  const seatsLeft =
    data.capacity != null ? Math.max(0, data.capacity - (regs?.registered_count ?? data.registered_count)) : null;

  return (
    <ActivityThemed accent="shivirs">
      <Screen refreshing={isRefetching} onRefresh={refetch}>
        <Card>
          <URow style={{ gap: 8, alignItems: "flex-start" }}>
            <Title style={{ flex: 1 }}>{name}</Title>
            {data.msv_only ? (
              <Pill tone="warning" label={hi ? "केवल एमएसवी" : "MSV only"} />
            ) : null}
          </URow>
          <URow style={{ gap: 8, marginTop: 12 }}>
            <Ionicons name="calendar-outline" size={16} color={c.primary} />
            <Body style={{ color: c.primary }}>
              {formatDateRange(data.start_date, data.end_date)}
            </Body>
          </URow>
          <URow style={{ gap: 8, marginTop: 8 }}>
            <Ionicons name="location-outline" size={16} color={c.mutedForeground} />
            <Body muted>
              {[data.location_text, data.city_name, data.state_name].filter(Boolean).join(", ") ||
                "—"}
            </Body>
          </URow>
          {data.capacity != null ? (
            <URow style={{ gap: 8, marginTop: 8 }}>
              <Ionicons name="people-outline" size={16} color={c.mutedForeground} />
              <Body muted>
                {hi ? "स्थान" : "Places"}: {seatsLeft} / {data.capacity}
              </Body>
            </URow>
          ) : null}
        </Card>

        {/* Registration — the module's core parent action, previously absent. */}
        {canRegister && regs ? (
          <Card>
            <Title style={{ fontSize: 17 }}>{hi ? "पंजीकरण" : "Register"}</Title>
            {!regs.registration_open ? (
              <Body muted style={{ marginTop: 8, lineHeight: 23 }}>
                {hi ? "यह शिविर समाप्त हो चुका है।" : "This shivir has already finished."}
              </Body>
            ) : regs.students.length === 0 ? (
              <Body muted style={{ marginTop: 8, lineHeight: 23 }}>
                {hi
                  ? "आपके खाते से कोई विद्यार्थी जुड़ा नहीं है।"
                  : "No students are linked to your account yet."}
              </Body>
            ) : (
              regs.students.map((s) => {
                const registered = s.status === "registered";
                const blocked = !registered && (!s.eligible || regs.is_full);
                return (
                  <URow
                    key={s.student_id}
                    style={{ marginTop: 12, gap: 10, alignItems: "center" }}
                  >
                    <Body style={{ flex: 1 }}>{s.full_name}</Body>
                    {registered ? (
                      <Button
                        label={hi ? "रद्द करें" : "Cancel"}
                        variant="outline"
                        loading={cancel.isPending && cancel.variables?.student_id === s.student_id}
                        onPress={() =>
                          cancel.mutate(
                            { student_id: s.student_id },
                            { onError: onRegisterError },
                          )
                        }
                      />
                    ) : (
                      <Button
                        label={
                          !s.eligible
                            ? hi
                              ? "एमएसवी आवश्यक"
                              : "MSV only"
                            : regs.is_full
                              ? hi
                                ? "स्थान भर गए"
                                : "Full"
                              : hi
                                ? "पंजीकरण करें"
                                : "Register"
                        }
                        disabled={blocked}
                        loading={
                          register.isPending && register.variables?.student_id === s.student_id
                        }
                        onPress={() =>
                          register.mutate(
                            { student_id: s.student_id },
                            { onError: onRegisterError },
                          )
                        }
                      />
                    )}
                  </URow>
                );
              })
            )}
          </Card>
        ) : null}

        {sessions.data?.items?.length ? (
          <Card>
            <Title style={{ fontSize: 17 }}>{hi ? "कार्यक्रम" : "Schedule"}</Title>
            {sessions.data.items.map((s) => (
              <URow key={s.id} style={{ marginTop: 10, gap: 8, alignItems: "flex-start" }}>
                <Ionicons name="ellipse-outline" size={14} color={c.mutedForeground} />
                <Body style={{ flex: 1 }}>
                  {s.title}
                  {"\n"}
                  <Body muted style={{ fontSize: 13 }}>
                    {s.session_date}
                    {s.start_time ? ` · ${s.start_time.slice(0, 5)}` : ""}
                    {s.end_time ? `–${s.end_time.slice(0, 5)}` : ""}
                  </Body>
                </Body>
              </URow>
            ))}
          </Card>
        ) : null}

        {/*
          Volunteer scanner — shown only when this caller genuinely holds an
          assignment on THIS shivir, resolved from /v1/shivirs/mine.
        */}
        {isVolunteerHere ? (
          <Card>
            <Title style={{ fontSize: 17 }}>{hi ? "उपस्थिति स्कैनर" : "Attendance scanner"}</Title>
            <Body muted style={{ marginTop: 8, lineHeight: 23 }}>
              {hi
                ? "आप इस शिविर के स्वयंसेवक हैं। विद्यार्थियों के पहचान पत्र QR स्कैन करके उपस्थिति दर्ज करें।"
                : "You are a volunteer for this shivir. Scan students' ID-card QR codes to record attendance."}
            </Body>
            <Button
              label={hi ? "QR स्कैन करें" : "Scan QR"}
              icon="scan-outline"
              onPress={() => router.push(`/shivir-scan/${data.id}` as Href)}
              style={{ marginTop: 14 }}
            />
          </Card>
        ) : null}

        {description ? (
          <Card>
            <Title style={{ fontSize: 17 }}>{hi ? "विवरण" : "About this shivir"}</Title>
            <Body muted style={{ marginTop: 8, lineHeight: 23 }}>
              {description}
            </Body>
          </Card>
        ) : null}

        {data.contact_info ? (
          <Card>
            <Title style={{ fontSize: 17 }}>{hi ? "संपर्क" : "Contact"}</Title>
            <Body muted style={{ marginTop: 8 }}>
              {data.contact_info}
            </Body>
          </Card>
        ) : null}
      </Screen>
    </ActivityThemed>
  );
}
