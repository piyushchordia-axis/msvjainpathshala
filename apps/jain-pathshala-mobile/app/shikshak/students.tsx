import { useCallback } from "react";
import { FlatList, Platform, Pressable, RefreshControl, Text, View, type ListRenderItem } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useAdminStudents } from "@/lib/queries";
import type { AdminStudentRow } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { formatAgeGroup } from "@workspace/api-zod";
import { bodyFamily } from "@/constants/typography";
import { Body, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

export default function StudentsScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { data, isLoading, isError, refetch, isRefetching } = useAdminStudents();
  const items = data?.items ?? [];

  const onRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const renderItem: ListRenderItem<AdminStudentRow> = useCallback(
    ({ item: s }) => (
      <Pressable onPress={() => router.push(`/student-detail/${s.id}` as never)}>
        <Card>
          <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Title style={{ fontSize: 17 }}>{s.full_name ?? s.student_code}</Title>
              <Body muted style={{ fontSize: 12, marginTop: 2 }}>
                {[s.student_code, formatAgeGroup(s.age_group, hi ? "hi" : "en")].filter(Boolean).join(" · ") || "—"}
              </Body>
            </View>
            <Row style={{ gap: 6, alignItems: "center" }}>
              <Pill tone={s.status === "active" ? "success" : "neutral"} label={s.status} />
              <Ionicons name="chevron-forward" size={18} color={c.mutedForeground} />
            </Row>
          </Row>
          <Row style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            {s.dob ? (
              <Body muted style={{ fontSize: 12 }}>
                {hi ? "जन्म" : "DOB"}: {formatDate(s.dob)}
              </Body>
            ) : null}
            {s.msv_status && s.msv_status !== "none" ? (
              <Pill label={`MSV: ${s.msv_status}`} />
            ) : null}
          </Row>
          <Text
            style={{
              fontFamily: bodyFamily(hi),
              fontSize: 12,
              color: c.primary,
              marginTop: 10,
            }}
          >
            {hi ? "विवरण देखें" : "View details"}
          </Text>
        </Card>
      </Pressable>
    ),
    [c.mutedForeground, c.primary, hi],
  );

  const keyExtractor = useCallback((item: AdminStudentRow) => item.id, []);

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader title={hi ? "मेरे विद्यार्थी" : "My students"} />
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
