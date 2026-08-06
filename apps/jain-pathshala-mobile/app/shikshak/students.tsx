import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
  type ListRenderItem,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { fonts, bodyFamily } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useAdminStudents } from "@/lib/queries";
import type { AdminStudentRow } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { formatAgeGroup } from "@workspace/api-zod";
import { Body, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

const STATUS_FILTERS = [
  { key: "", en: "All", hi: "सभी" },
  { key: "active", en: "Active", hi: "सक्रिय" },
  { key: "inactive", en: "Inactive", hi: "निष्क्रिय" },
];

export default function StudentsScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const [status, setStatus] = useState("");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const list = useAdminStudents({ status: status || undefined, q: q || undefined });

  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 300);
    return () => clearTimeout(t);
  }, [qInput]);

  const items = useMemo(
    () => list.data?.pages.flatMap((p) => p.items) ?? [],
    [list.data?.pages],
  );

  const onRefresh = useCallback(() => {
    void list.refetch();
  }, [list]);

  const renderItem: ListRenderItem<AdminStudentRow> = useCallback(
    ({ item: s }) => {
      const place = [s.batch_name, s.centre_name].filter(Boolean).join(" · ");
      return (
        <Pressable onPress={() => router.push(`/student-detail/${s.id}` as never)}>
          <Card>
            <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Title style={{ fontSize: 17 }}>{s.full_name ?? s.student_code}</Title>
                <Body muted style={{ fontSize: 12, marginTop: 2 }}>
                  {[s.student_code, formatAgeGroup(s.age_group, hi ? "hi" : "en")].filter(Boolean).join(" · ") ||
                    "—"}
                </Body>
                {place ? (
                  <Body muted style={{ fontSize: 12, marginTop: 2 }}>
                    {place}
                  </Body>
                ) : null}
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
              {s.msv_status && s.msv_status !== "none" ? <Pill label={`MSV: ${s.msv_status}`} /> : null}
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
      );
    },
    [c.mutedForeground, c.primary, hi],
  );

  const keyExtractor = useCallback((item: AdminStudentRow) => item.id, []);

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader title={hi ? "मेरे विद्यार्थी" : "My students"} />
      <View
        style={{
          paddingHorizontal: 18,
          paddingTop: 8,
          paddingBottom: 4,
          gap: 10,
          borderBottomWidth: 1,
          borderBottomColor: c.border,
          backgroundColor: c.background,
        }}
      >
        <TextInput
          value={qInput}
          onChangeText={setQInput}
          placeholder={hi ? "नाम या विद्यार्थी कोड खोजें…" : "Search name or student code…"}
          placeholderTextColor={c.mutedForeground}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          style={{
            fontFamily: bodyFamily(hi),
            fontSize: 15,
            color: c.foreground,
            borderWidth: 1,
            borderColor: c.border,
            borderRadius: c.radius,
            paddingHorizontal: 14,
            paddingVertical: 10,
            backgroundColor: c.card,
          }}
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingBottom: 8 }}
        >
          {STATUS_FILTERS.map((f) => {
            const active = status === f.key;
            return (
              <Pressable
                key={f.key || "all"}
                onPress={() => setStatus(f.key)}
                style={{
                  backgroundColor: active ? c.primary : c.muted,
                  borderRadius: 999,
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                }}
              >
                <Text
                  style={{
                    fontFamily: fonts.bodySemiBold,
                    fontSize: 13,
                    color: active ? c.primaryForeground : c.mutedForeground,
                  }}
                >
                  {hi ? f.hi : f.en}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      <Screen scroll={false} contentStyle={{ flex: 1, paddingHorizontal: 0 }}>
        {list.isLoading ? (
          <View style={{ paddingHorizontal: 18, paddingTop: 8 }}>
            <StateView status="loading" emptyText="" />
          </View>
        ) : list.isError ? (
          <View style={{ paddingHorizontal: 18, paddingTop: 8 }}>
            <StateView
              status="error"
              emptyText=""
              errorText={hi ? "विद्यार्थी लोड नहीं हुए।" : "Could not load students."}
              onRetry={() => void list.refetch()}
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
                refreshing={!!list.isRefetching && !list.isFetchingNextPage}
                onRefresh={onRefresh}
                tintColor={c.primary}
                colors={[c.primary]}
              />
            }
            onEndReached={() => {
              if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
            }}
            onEndReachedThreshold={0.4}
            ListFooterComponent={
              list.isFetchingNextPage ? (
                <Body muted style={{ textAlign: "center", paddingVertical: 12 }}>
                  {hi ? "और लोड हो रहा है…" : "Loading more…"}
                </Body>
              ) : null
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
