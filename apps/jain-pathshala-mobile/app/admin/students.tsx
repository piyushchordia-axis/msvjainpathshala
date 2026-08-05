import { useCallback } from "react";
import { Alert, FlatList, Platform, RefreshControl, View, type ListRenderItem } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useAdminStudents, useStudentStatusAction } from "@/lib/queries";
import type { AdminStudentRow } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { formatAgeGroup } from "@workspace/api-zod";
import { AppHeader } from "@/components/AppHeader";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

export default function StudentsScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { data, isLoading, isError, refetch, isRefetching } = useAdminStudents();
  const mutate = useStudentStatusAction();

  const items = data?.items ?? [];

  const onRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const confirm = useCallback(
    (s: AdminStudentRow) => {
      const deactivate = s.status === "active";
      Alert.alert(
        deactivate ? (hi ? "निष्क्रिय करें?" : "Deactivate?") : (hi ? "पुनः सक्रिय करें?" : "Reactivate?"),
        s.full_name ?? s.student_code,
        [
          { text: hi ? "रद्द" : "Cancel", style: "cancel" },
          {
            text: hi ? "पुष्टि" : "Confirm",
            style: deactivate ? "destructive" : "default",
            onPress: () =>
              mutate.mutate(
                { id: s.id, action: deactivate ? "deactivate" : "reactivate" },
                {
                  onError: (e) =>
                    Alert.alert(hi ? "त्रुटि" : "Error", e instanceof Error ? e.message : "Action failed"),
                },
              ),
          },
        ],
      );
    },
    [hi, mutate],
  );

  const renderItem: ListRenderItem<AdminStudentRow> = useCallback(
    ({ item: s }) => (
      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Title style={{ fontSize: 17 }}>{s.full_name ?? s.student_code}</Title>
            <Body muted style={{ fontSize: 12, marginTop: 2 }}>
              {[s.student_code, formatAgeGroup(s.age_group, hi ? "hi" : "en")].filter(Boolean).join(" · ") || "—"}
            </Body>
          </View>
          <Pill tone={s.status === "active" ? "success" : "neutral"} label={s.status} />
        </Row>
        <Row style={{ gap: 8, marginTop: 8 }}>
          {s.dob ? (
            <Body muted style={{ fontSize: 12 }}>
              {hi ? "जन्म" : "DOB"}: {formatDate(s.dob)}
            </Body>
          ) : null}
          {s.msv_status && s.msv_status !== "none" ? (
            <Pill label={`MSV: ${s.msv_status}`} />
          ) : null}
        </Row>
        <Button
          label={
            s.status === "active"
              ? hi
                ? "निष्क्रिय करें"
                : "Deactivate"
              : hi
                ? "पुनः सक्रिय करें"
                : "Reactivate"
          }
          variant={s.status === "active" ? "outline" : "secondary"}
          onPress={() => confirm(s)}
          loading={mutate.isPending && mutate.variables?.id === s.id}
          style={{ marginTop: 12 }}
        />
      </Card>
    ),
    [confirm, hi, mutate.isPending, mutate.variables?.id],
  );

  const keyExtractor = useCallback((item: AdminStudentRow) => item.id, []);

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader
        title={hi ? "विद्यार्थी" : "Students"}
        subtitle={hi ? "आपके केंद्रों की सूची" : "Roster across your centres"}
      />
      <Screen scroll={false} contentStyle={{ flex: 1, paddingHorizontal: 0 }}>
        {isLoading ? (
          <View style={{ paddingHorizontal: 18, paddingTop: 8 }}>
            <StateView status="loading" emptyText="" />
          </View>
        ) : isError ? (
          <View style={{ paddingHorizontal: 18, paddingTop: 8 }}>
            <StateView
              status="error"
              emptyText=""
              errorText={hi ? "विद्यार्थी लोड नहीं हुए।" : "Could not load students."}
              onRetry={refetch}
              retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
            />
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            ListEmptyComponent={
              <StateView status="empty" emptyText={hi ? "कोई विद्यार्थी नहीं मिला।" : "No students found."} />
            }
            contentContainerStyle={{
              paddingHorizontal: 18,
              paddingTop: 8,
              paddingBottom: 40,
              gap: 14,
            }}
            refreshControl={
              <RefreshControl
                refreshing={!!isRefetching}
                onRefresh={onRefresh}
                tintColor={c.primary}
                colors={[c.primary]}
              />
            }
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            initialNumToRender={10}
            maxToRenderPerBatch={8}
            windowSize={7}
            removeClippedSubviews={Platform.OS !== "web"}
          />
        )}
      </Screen>
    </View>
  );
}
