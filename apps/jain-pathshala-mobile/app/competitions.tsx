import { useState } from "react";
import { Alert, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { useOpenCompetitions, useRegisterCompetition } from "@/lib/queries";
import { ApiError } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { ChildSwitcher } from "@/components/ChildSwitcher";
import { Body, Button, Card, Numeric, Pill, Row, Screen, StateView, Title } from "@/components/ui";

export default function CompetitionsScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { activeStudentId, activeChild, loading, refetch } = useSessionView();

  const competitions = useOpenCompetitions(!!activeStudentId);
  const register = useRegisterCompetition();

  const rows = competitions.data?.items ?? [];

  // Mark competitions registered in this session so the button flips to a
  // confirmed pill without waiting for a list refetch.
  const [registered, setRegistered] = useState<Record<string, true>>({});

  function onRegister(id: string) {
    if (!activeStudentId) return;
    register.mutate(
      { id, student_id: activeStudentId },
      {
        onSuccess: () => {
          setRegistered((prev) => ({ ...prev, [id]: true }));
          Alert.alert(
            hi ? "पंजीकरण सफल" : "Registered",
            hi ? "आपका पंजीकरण हो गया है।" : "You're registered for this competition.",
          );
        },
        onError: (err) => {
          const code = err instanceof ApiError ? err.code : "";
          const status = err instanceof ApiError ? err.statusCode : 0;
          let title = hi ? "त्रुटि" : "Error";
          let message =
            err instanceof Error ? err.message : hi ? "पंजीकरण विफल रहा।" : "Registration failed.";

          if (status === 409) {
            // Already registered — treat as success state.
            setRegistered((prev) => ({ ...prev, [id]: true }));
            title = hi ? "पहले से पंजीकृत" : "Already registered";
            message = hi
              ? "आप इस प्रतियोगिता के लिए पहले से पंजीकृत हैं।"
              : "You're already registered for this competition.";
          } else if (status === 422 || code === "ERR_NOT_ELIGIBLE") {
            title = hi ? "पात्र नहीं" : "Not eligible";
            message = hi
              ? "यह विद्यार्थी इस प्रतियोगिता के लिए पात्र नहीं है।"
              : "This student isn't eligible for this competition.";
          } else if (code === "ERR_FULL") {
            title = hi ? "स्थान भर गए" : "Competition full";
            message = hi
              ? "इस प्रतियोगिता में सभी स्थान भर चुके हैं।"
              : "All places for this competition are taken.";
          }

          Alert.alert(title, message);
        },
      },
    );
  }

  return (
    <ActivityThemed accent="competitions">
      <Screen
        refreshing={competitions.isRefetching}
        onRefresh={() => {
          refetch();
          competitions.refetch();
        }}
      >
        {/* state ladder: session-loading -> no-child -> query-loading -> error -> empty -> data */}
        {loading ? (
          <StateView status="loading" emptyText="" />
        ) : !activeStudentId || !activeChild ? (
          <StateView
            status="empty"
            emptyText={
              hi ? "आपकी विद्यार्थी प्रोफ़ाइल अभी तैयार नहीं है।" : "Your student profile isn't ready yet."
            }
          />
        ) : (
          <>
            <ChildSwitcher />
            {competitions.isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : competitions.isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "प्रतियोगिताएँ लोड नहीं हुईं।" : "Could not load competitions."}
            onRetry={competitions.refetch}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : rows.length === 0 ? (
          <StateView
            status="empty"
            emptyText={hi ? "अभी कोई खुली प्रतियोगिता नहीं है।" : "No open competitions right now."}
          />
        ) : (
          rows.map((comp) => {
            const name = (hi ? comp.name_hi : comp.name_en) || comp.name_en || comp.name_hi;
            const eligible =
              !comp.eligible_student_ids ||
              comp.eligible_student_ids.length === 0 ||
              comp.eligible_student_ids.includes(activeStudentId);
            const isRegistered = !!registered[comp.id];
            const pending = register.isPending && register.variables?.id === comp.id;

            return (
              <Card key={comp.id}>
                <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <Title style={{ fontSize: 17 }}>{name}</Title>
                    {comp.category ? (
                      <Body muted style={{ fontSize: 12, marginTop: 2 }}>
                        {comp.category}
                      </Body>
                    ) : null}
                  </View>
                  {comp.category ? <Pill label={comp.category} /> : null}
                </Row>

                <Row style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
                  <Pill label={`${hi ? "तिथि" : "Event"}: ${formatDate(comp.event_date)}`} tone="info" />
                  <Pill
                    label={`${hi ? "पंजीकरण अंतिम" : "Register by"}: ${formatDate(
                      comp.registration_window_end,
                    )}`}
                    tone="warning"
                  />
                </Row>

                <Row style={{ marginTop: 10, justifyContent: "space-between", alignItems: "center" }}>
                  <View>
                    <Body muted style={{ fontSize: 11 }}>
                      {hi ? "विजेता / प्रतिभागी" : "Winner / Participant"}
                    </Body>
                    <Row style={{ gap: 6, marginTop: 2 }}>
                      <Numeric style={{ fontSize: 18, color: c.successText }}>
                        +{comp.winner_points}
                      </Numeric>
                      <Body muted style={{ fontSize: 14 }}>
                        /
                      </Body>
                      <Numeric style={{ fontSize: 18 }}>+{comp.participant_points}</Numeric>
                    </Row>
                  </View>
                  {isRegistered ? (
                    <Pill label={hi ? "पंजीकृत" : "Registered"} tone="success" />
                  ) : null}
                </Row>

                {isRegistered ? null : !eligible ? (
                  <Button
                    label={hi ? "पात्र नहीं" : "Not eligible"}
                    variant="outline"
                    disabled
                    onPress={() => {}}
                    style={{ marginTop: 12 }}
                  />
                ) : (
                  <Button
                    label={hi ? "पंजीकरण करें" : "Register"}
                    icon="trophy-outline"
                    onPress={() => onRegister(comp.id)}
                    loading={pending}
                    style={{ marginTop: 12 }}
                  />
                )}
              </Card>
            );
          })
        )}
          </>
        )}
      </Screen>
    </ActivityThemed>
  );
}
