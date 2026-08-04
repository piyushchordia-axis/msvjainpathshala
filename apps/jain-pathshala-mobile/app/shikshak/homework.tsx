import { useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import {
  useAdminBatches,
  useCreateHomeworkAssignment,
  useHomeworkAssignments,
} from "@/lib/queries";
import { ApiError } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { bodyFamily } from "@/constants/typography";
import { AppHeader } from "@/components/AppHeader";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

function tomorrowKolkata(): string {
  // YYYY-MM-DD in Asia/Kolkata — same shape as the API due_date.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const y = parts.find((p) => p.type === "year")?.value ?? "2026";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

function CreateAssignmentModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const c = useColors();
  const { hi } = useLocale();
  const batches = useAdminBatches(open);
  const create = useCreateHomeworkAssignment();
  const [batchId, setBatchId] = useState("");
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState(tomorrowKolkata());
  const [description, setDescription] = useState("");

  const items = batches.data?.items ?? [];

  function reset() {
    setBatchId("");
    setTitle("");
    setDueDate(tomorrowKolkata());
    setDescription("");
  }

  function submit() {
    if (!batchId || !title.trim() || !dueDate.trim()) {
      Alert.alert(
        hi ? "अधूरा" : "Missing details",
        hi ? "बैच, शीर्षक और नियत तिथि भरें।" : "Pick a batch, title, and due date.",
      );
      return;
    }
    create.mutate(
      {
        batch_id: batchId,
        title: title.trim(),
        due_date: dueDate.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
      },
      {
        onSuccess: (res) => {
          Alert.alert(
            hi ? "कार्य दिया गया" : "Assignment created",
            hi
              ? `${res.submissions_created} विद्यार्थी को दिया गया।`
              : `${res.submissions_created} student(s) assigned.`,
          );
          reset();
          onCreated();
          onClose();
        },
        onError: (e) => {
          Alert.alert(
            hi ? "त्रुटि" : "Could not create",
            e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed",
          );
        },
      },
    );
  }

  return (
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <View
          style={{
            paddingHorizontal: 18,
            paddingTop: 18,
            paddingBottom: 12,
            borderBottomWidth: 1,
            borderBottomColor: c.border,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Title style={{ fontSize: 20 }}>{hi ? "नया गृहकार्य" : "New assignment"}</Title>
          <Pressable onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={24} color={c.foreground} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 18, gap: 14, paddingBottom: 40 }}>
          <View style={{ gap: 6 }}>
            <Body muted style={{ fontSize: 12 }}>
              {hi ? "बैच *" : "Batch *"}
            </Body>
            {batches.isLoading ? (
              <Body muted>{hi ? "लोड हो रहा है…" : "Loading…"}</Body>
            ) : items.length === 0 ? (
              <Body muted>{hi ? "कोई बैच नहीं मिला।" : "No batches in your scope."}</Body>
            ) : (
              items.map((b) => {
                const active = b.id === batchId;
                return (
                  <Pressable
                    key={b.id}
                    onPress={() => setBatchId(b.id)}
                    style={{
                      paddingVertical: 12,
                      paddingHorizontal: 14,
                      borderRadius: c.radius,
                      borderWidth: 1,
                      borderColor: active ? c.primary : c.border,
                      backgroundColor: active ? c.primary + "14" : c.card,
                      marginBottom: 6,
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: bodyFamily(hi, "semibold"),
                        fontSize: 15,
                        color: c.foreground,
                      }}
                    >
                      {b.name ?? (hi ? "बैच" : "Batch")}
                    </Text>
                    <Text
                      style={{
                        fontFamily: bodyFamily(hi),
                        fontSize: 12,
                        color: c.mutedForeground,
                        marginTop: 2,
                      }}
                    >
                      {b.centre_name}
                    </Text>
                  </Pressable>
                );
              })
            )}
          </View>

          <View style={{ gap: 6 }}>
            <Body muted style={{ fontSize: 12 }}>
              {hi ? "शीर्षक *" : "Title *"}
            </Body>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder={hi ? "उदा. नवकार मंत्र याद करें" : "e.g. Learn the Navkar Mantra"}
              placeholderTextColor={c.mutedForeground}
              style={{
                fontFamily: bodyFamily(hi),
                fontSize: 15,
                color: c.foreground,
                borderWidth: 1,
                borderColor: c.border,
                borderRadius: c.radius,
                paddingHorizontal: 14,
                paddingVertical: 12,
                backgroundColor: c.card,
              }}
            />
          </View>

          <View style={{ gap: 6 }}>
            <Body muted style={{ fontSize: 12 }}>
              {hi ? "नियत तिथि (YYYY-MM-DD) *" : "Due date (YYYY-MM-DD) *"}
            </Body>
            <TextInput
              value={dueDate}
              onChangeText={setDueDate}
              autoCapitalize="none"
              placeholder="2026-08-10"
              placeholderTextColor={c.mutedForeground}
              style={{
                fontFamily: bodyFamily(hi),
                fontSize: 15,
                color: c.foreground,
                borderWidth: 1,
                borderColor: c.border,
                borderRadius: c.radius,
                paddingHorizontal: 14,
                paddingVertical: 12,
                backgroundColor: c.card,
              }}
            />
          </View>

          <View style={{ gap: 6 }}>
            <Body muted style={{ fontSize: 12 }}>
              {hi ? "निर्देश (वैकल्पिक)" : "Instructions (optional)"}
            </Body>
            <TextInput
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={3}
              placeholderTextColor={c.mutedForeground}
              style={{
                fontFamily: bodyFamily(hi),
                fontSize: 15,
                color: c.foreground,
                borderWidth: 1,
                borderColor: c.border,
                borderRadius: c.radius,
                paddingHorizontal: 14,
                paddingVertical: 12,
                backgroundColor: c.card,
                minHeight: 88,
                textAlignVertical: "top",
              }}
            />
          </View>

          <Button
            label={hi ? "बनाएँ" : "Create"}
            onPress={submit}
            loading={create.isPending}
            disabled={!batchId || !title.trim() || !dueDate.trim()}
          />
        </ScrollView>
      </View>
    </Modal>
  );
}

export default function ShikshakHomeworkScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const list = useHomeworkAssignments({ overdue: overdueOnly });
  const items = list.data?.items ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader
        title={hi ? "गृहकार्य" : "Homework"}
        subtitle={
          overdueOnly
            ? hi
              ? "केवल अतिदेय — खोलकर प्रस्तुतियाँ देखें"
              : "Overdue only — open to view submissions"
            : hi
              ? "असाइनमेंट खोलकर प्रस्तुत कार्य देखें और जाँचें"
              : "Open an assignment to see and grade submitted work"
        }
      />
      <Screen refreshing={list.isRefetching} onRefresh={list.refetch}>
        <Row style={{ justifyContent: "space-between", marginBottom: 14, gap: 10 }}>
          <Pressable
            onPress={() => setOverdueOnly((v) => !v)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: 999,
              backgroundColor: overdueOnly ? c.primary : c.muted,
            }}
          >
            <Ionicons
              name="alert-circle-outline"
              size={16}
              color={overdueOnly ? c.primaryForeground : c.mutedForeground}
            />
            <Text
              style={{
                fontFamily: bodyFamily(hi, "semibold"),
                fontSize: 13,
                color: overdueOnly ? c.primaryForeground : c.mutedForeground,
              }}
            >
              {hi ? "अतिदेय" : "Overdue"}
            </Text>
          </Pressable>
          <Button
            label={hi ? "नया" : "New"}
            icon="add"
            variant="primary"
            onPress={() => setCreateOpen(true)}
            style={{ paddingVertical: 8, paddingHorizontal: 14 } as never}
          />
        </Row>

        {list.isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : list.isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "गृहकार्य लोड नहीं हुआ।" : "Could not load homework."}
            onRetry={list.refetch}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : items.length === 0 ? (
          <StateView
            status="empty"
            emptyText={
              overdueOnly
                ? hi
                  ? "कोई अतिदेय असाइनमेंट नहीं।"
                  : "No overdue assignments."
                : hi
                  ? "अभी कोई गृहकार्य नहीं। नया असाइनमेंट बनाएँ।"
                  : "No homework yet. Create an assignment for your batch."
            }
          />
        ) : (
          items.map((a) => (
            <Pressable
              key={a.id}
              onPress={() => router.push(`/homework-assignment/${a.id}` as never)}
            >
              <Card>
                <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Title style={{ fontSize: 17 }}>{a.title}</Title>
                    <Body muted style={{ fontSize: 12, marginTop: 4 }}>
                      {[a.batch_name ?? (hi ? "बैच" : "Batch"), a.centre_name]
                        .filter(Boolean)
                        .join(" · ")}
                    </Body>
                  </View>
                  {a.overdue > 0 ? (
                    <Pill tone="error" label={hi ? "अतिदेय" : "Overdue"} />
                  ) : (
                    <Pill tone="info" label={formatDate(a.due_date)} />
                  )}
                </Row>
                <Row style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
                  <Pill
                    tone={a.submitted > 0 ? "info" : "neutral"}
                    label={
                      hi
                        ? `${a.submitted}/${a.total} प्रस्तुत`
                        : `${a.submitted}/${a.total} submitted`
                    }
                  />
                  <Pill
                    tone="success"
                    label={hi ? `${a.graded} जाँचे` : `${a.graded} graded`}
                  />
                </Row>
                <Row style={{ marginTop: 12, justifyContent: "space-between", alignItems: "center" }}>
                  <Body muted style={{ fontSize: 12 }}>
                    {hi ? "नियत तिथि" : "Due"}: {formatDate(a.due_date)}
                  </Body>
                  <Row style={{ gap: 4, alignItems: "center" }}>
                    <Body style={{ fontSize: 13, color: c.primary }}>
                      {a.submitted > 0
                        ? hi
                          ? "प्रस्तुतियाँ देखें"
                          : "View submissions"
                        : hi
                          ? "रोस्टर देखें"
                          : "View roster"}
                    </Body>
                    <Ionicons name="chevron-forward" size={16} color={c.primary} />
                  </Row>
                </Row>
              </Card>
            </Pressable>
          ))
        )}
      </Screen>

      <CreateAssignmentModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => void list.refetch()}
      />
    </View>
  );
}
