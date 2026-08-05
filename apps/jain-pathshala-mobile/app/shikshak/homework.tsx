import { useMemo, useState } from "react";
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
import * as ImagePicker from "expo-image-picker";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import {
  useAdminBatches,
  useCreateHomeworkAssignment,
  useHomeworkAssignments,
  useHomeworkCurriculumTopics,
  type CurriculumTopicOption,
} from "@/lib/queries";
import { ApiError, apiUpload } from "@/lib/api";
import { formatDate } from "@/lib/format";
import {
  PREFERRED_ASSET_REPRESENTATION_MODE,
  ensureFileUri,
  guessMime,
} from "@/lib/proof-media";
import { bodyFamily } from "@/constants/typography";
import { AppHeader } from "@/components/AppHeader";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

type CurriculumTopic = CurriculumTopicOption;

/** Collapsible searchable curriculum dropdown (avoids nested Modal inside create sheet). */
function CurriculumTopicDropdown({
  topics,
  value,
  onChange,
  hi,
  disabled,
  loading,
  emptyMessage,
}: {
  topics: CurriculumTopic[];
  value: string;
  onChange: (id: string) => void;
  hi: boolean;
  disabled?: boolean;
  loading?: boolean;
  emptyMessage?: string;
}) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = useMemo(
    () => topics.find((t) => t.id === value) ?? null,
    [topics, value],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return topics;
    return topics.filter((t) => {
      const hay = `${t.label_en} ${t.label_hi} ${t.curriculum_name ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [topics, query]);

  const selectedLabel = selected
    ? hi
      ? selected.label_hi || selected.label_en
      : selected.label_en
    : hi
      ? "विषय चुनें…"
      : "Select topic…";

  if (loading) {
    return <Body muted>{hi ? "लोड हो रहा है…" : "Loading…"}</Body>;
  }
  if (disabled) {
    return (
      <Body muted style={{ fontSize: 13 }}>
        {emptyMessage ?? (hi ? "पहले बैच चुनें।" : "Pick a batch first.")}
      </Body>
    );
  }
  if (topics.length === 0) {
    return (
      <Body muted style={{ fontSize: 13 }}>
        {emptyMessage ?? (hi ? "इस बैच के लिए कोई विषय नहीं।" : "No topics for this batch.")}
      </Body>
    );
  }

  return (
    <View style={{ gap: 8 }}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={{
          paddingVertical: 12,
          paddingHorizontal: 14,
          borderRadius: c.radius,
          borderWidth: 1,
          borderColor: open || value ? c.primary : c.border,
          backgroundColor: c.card,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text
            numberOfLines={1}
            style={{
              fontFamily: bodyFamily(hi, "semibold"),
              fontSize: 15,
              color: value ? c.foreground : c.mutedForeground,
            }}
          >
            {value ? selectedLabel : hi ? "कोई नहीं / विषय चुनें…" : "None / select topic…"}
          </Text>
          {selected?.curriculum_name ? (
            <Text
              numberOfLines={1}
              style={{
                fontFamily: bodyFamily(hi),
                fontSize: 12,
                color: c.mutedForeground,
                marginTop: 2,
              }}
            >
              {selected.curriculum_name}
            </Text>
          ) : null}
        </View>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={18}
          color={c.mutedForeground}
        />
      </Pressable>

      {open ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: c.border,
            borderRadius: c.radius,
            backgroundColor: c.card,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderBottomWidth: 1,
              borderBottomColor: c.border,
            }}
          >
            <Ionicons name="search" size={16} color={c.mutedForeground} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={hi ? "विषय खोजें…" : "Search topics…"}
              placeholderTextColor={c.mutedForeground}
              autoCorrect={false}
              style={{
                flex: 1,
                fontFamily: bodyFamily(hi),
                fontSize: 15,
                color: c.foreground,
                paddingVertical: 6,
              }}
            />
            {query ? (
              <Pressable onPress={() => setQuery("")} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={c.mutedForeground} />
              </Pressable>
            ) : null}
          </View>

          <ScrollView
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            style={{ maxHeight: 220 }}
          >
            <Pressable
              onPress={() => {
                onChange("");
                setOpen(false);
                setQuery("");
              }}
              style={{
                paddingVertical: 12,
                paddingHorizontal: 14,
                borderBottomWidth: 1,
                borderBottomColor: c.border,
                backgroundColor: !value ? c.primary + "14" : "transparent",
              }}
            >
              <Text
                style={{
                  fontFamily: bodyFamily(hi, "semibold"),
                  fontSize: 15,
                  color: c.foreground,
                }}
              >
                {hi ? "कोई नहीं" : "None"}
              </Text>
            </Pressable>
            {filtered.length === 0 ? (
              <Body muted style={{ padding: 14, fontSize: 13 }}>
                {hi ? "कोई मिलान नहीं।" : "No matching topic."}
              </Body>
            ) : (
              filtered.map((t) => {
                const active = t.id === value;
                const label = hi ? t.label_hi || t.label_en : t.label_en;
                return (
                  <Pressable
                    key={t.id}
                    onPress={() => {
                      onChange(t.id);
                      setOpen(false);
                      setQuery("");
                    }}
                    style={{
                      paddingVertical: 12,
                      paddingHorizontal: 14,
                      borderBottomWidth: 1,
                      borderBottomColor: c.border,
                      backgroundColor: active ? c.primary + "14" : "transparent",
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: bodyFamily(hi, "semibold"),
                        fontSize: 15,
                        color: c.foreground,
                      }}
                    >
                      {label}
                    </Text>
                    {t.curriculum_name ? (
                      <Text
                        style={{
                          fontFamily: bodyFamily(hi),
                          fontSize: 12,
                          color: c.mutedForeground,
                          marginTop: 2,
                        }}
                      >
                        {t.curriculum_name}
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}
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
  const [curriculumItemId, setCurriculumItemId] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [attachmentLabel, setAttachmentLabel] = useState("");
  const [uploading, setUploading] = useState(false);

  const topics = useHomeworkCurriculumTopics(batchId || undefined, open);
  const topicItems = topics.data?.items ?? [];
  const items = batches.data?.items ?? [];

  function reset() {
    setBatchId("");
    setTitle("");
    setDueDate(tomorrowKolkata());
    setDescription("");
    setCurriculumItemId("");
    setAttachmentUrl("");
    setAttachmentLabel("");
  }

  function selectBatch(id: string) {
    setBatchId(id);
    setCurriculumItemId("");
  }

  async function uploadWorksheetAsset(uri: string, name: string, mime: string) {
    setUploading(true);
    try {
      const uploaded = await apiUpload(
        { uri: ensureFileUri(uri), name, type: mime },
        "homework",
      );
      setAttachmentUrl(uploaded.url);
      setAttachmentLabel(name);
    } catch (err) {
      Alert.alert(
        hi ? "अपलोड नहीं हुआ" : "Could not upload worksheet",
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : hi
              ? "फिर से प्रयास करें।"
              : "Please try again.",
      );
    } finally {
      setUploading(false);
    }
  }

  async function pickWorksheetFromLibrary() {
    if (uploading || create.isPending) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        hi ? "अनुमति आवश्यक" : "Permission needed",
        hi ? "फोटो लाइब्रेरी की अनुमति दें।" : "Please allow photo library access.",
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
      preferredAssetRepresentationMode: PREFERRED_ASSET_REPRESENTATION_MODE,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const mime = guessMime("photo", asset.mimeType);
    const name = asset.fileName ?? "worksheet.jpg";
    await uploadWorksheetAsset(asset.uri, name, mime);
  }

  function clearWorksheet() {
    setAttachmentUrl("");
    setAttachmentLabel("");
  }

  function submit() {
    if (!batchId || !title.trim() || !dueDate.trim()) {
      Alert.alert(
        hi ? "अधूरा" : "Missing details",
        hi ? "बैच, शीर्षक और नियत तिथि भरें।" : "Pick a batch, title, and due date.",
      );
      return;
    }
    if (uploading) return;
    create.mutate(
      {
        batch_id: batchId,
        title: title.trim(),
        due_date: dueDate.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(attachmentUrl.trim() ? { attachment_url: attachmentUrl.trim() } : {}),
        ...(curriculumItemId ? { curriculum_item_id: curriculumItemId } : {}),
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

  const fieldStyle = {
    fontFamily: bodyFamily(hi),
    fontSize: 15,
    color: c.foreground,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: c.radius,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: c.card,
  } as const;

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
                    onPress={() => selectBatch(b.id)}
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
              style={fieldStyle}
            />
          </View>

          <View style={{ gap: 6 }}>
            <Body muted style={{ fontSize: 12 }}>
              {hi ? "पाठ्यक्रम विषय (वैकल्पिक)" : "Curriculum topic (optional)"}
            </Body>
            <CurriculumTopicDropdown
              key={batchId || "no-batch"}
              topics={topicItems}
              value={curriculumItemId}
              onChange={setCurriculumItemId}
              hi={hi}
              disabled={!batchId}
              loading={!!batchId && topics.isLoading}
              emptyMessage={
                !batchId
                  ? hi
                    ? "पहले बैच चुनें।"
                    : "Pick a batch first."
                  : hi
                    ? "इस बैच के लिए कोई विषय नहीं।"
                    : "No topics for this batch."
              }
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
              style={fieldStyle}
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
              placeholder={hi ? "वैकल्पिक निर्देश" : "Optional instructions"}
              placeholderTextColor={c.mutedForeground}
              style={{
                ...fieldStyle,
                minHeight: 88,
                textAlignVertical: "top",
              }}
            />
          </View>

          <View style={{ gap: 6 }}>
            <Body muted style={{ fontSize: 12 }}>
              {hi ? "वर्कशीट (वैकल्पिक)" : "Worksheet (optional)"}
            </Body>
            <Row style={{ gap: 10, flexWrap: "wrap" }}>
              <Button
                label={
                  uploading
                    ? hi
                      ? "अपलोड…"
                      : "Uploading…"
                    : attachmentUrl
                      ? hi
                        ? "बदलें"
                        : "Replace"
                      : hi
                        ? "फ़ोटो चुनें"
                        : "Choose photo"
                }
                variant="outline"
                icon="image-outline"
                disabled={uploading || create.isPending}
                onPress={() => void pickWorksheetFromLibrary()}
                style={{ minWidth: 140 }}
              />
              {attachmentUrl ? (
                <Button
                  label={hi ? "हटाएँ" : "Remove"}
                  variant="ghost"
                  disabled={uploading || create.isPending}
                  onPress={clearWorksheet}
                />
              ) : null}
            </Row>
            {attachmentUrl ? (
              <Body muted style={{ fontSize: 12 }}>
                {hi
                  ? `संलग्न — परिवार गृहकार्य फ़ीड में देखेंगे${attachmentLabel ? ` (${attachmentLabel})` : ""}।`
                  : `Attached — families will see this on their homework feed${attachmentLabel ? ` (${attachmentLabel})` : ""}.`}
              </Body>
            ) : (
              <Body muted style={{ fontSize: 12 }}>
                {hi
                  ? "छवि अपलोड करें। PDF के लिए वेब व्यवस्थापक का उपयोग करें।"
                  : "Upload an image. For PDF worksheets, use the web admin."}
              </Body>
            )}
          </View>

          <Button
            label={hi ? "बनाएँ" : "Create"}
            onPress={submit}
            loading={create.isPending}
            disabled={!batchId || !title.trim() || !dueDate.trim() || uploading}
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
                    {(hi ? a.curriculum_topic_hi ?? a.curriculum_topic_en : a.curriculum_topic_en) ? (
                      <Body muted style={{ fontSize: 12, marginTop: 2 }}>
                        {hi
                          ? a.curriculum_topic_hi ?? a.curriculum_topic_en
                          : a.curriculum_topic_en ?? a.curriculum_topic_hi}
                      </Body>
                    ) : null}
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
                  {a.attachment_url ? (
                    <Pill tone="neutral" label={hi ? "वर्कशीट" : "Worksheet"} />
                  ) : null}
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
