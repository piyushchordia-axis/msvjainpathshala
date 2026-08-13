import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";
import { bodyFamily } from "@/constants/typography";
import { apiGet, apiPost } from "@/lib/api";
import {
  useAdminBatches,
  useAdminCentres,
  useAdminNotices,
  useCreateNotice,
  useDeleteNotice,
  useUpdateNotice,
  type AdminNoticeRow,
  type NoticeWriteBody,
} from "@/lib/queries";
import { AppHeader } from "@/components/AppHeader";
import { CentreSwitcher, usePersistedCentreId } from "@/components/CentreSwitcher";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

const CENTRE_KEY = "jp.sanchalak.selectedCentreId";

type AudienceKind = "centre" | "batch";

type FormState = {
  title_en: string;
  title_hi: string;
  content_en: string;
  content_hi: string;
  audience: AudienceKind;
  batch_id: string | null;
  is_public: boolean;
  pinned: boolean;
  is_critical: boolean;
  /** YYYY-MM-DD for the optional end date; empty = never expires. */
  ends_on: string;
};

const emptyForm = (): FormState => ({
  title_en: "",
  title_hi: "",
  content_en: "",
  content_hi: "",
  audience: "centre",
  batch_id: null,
  is_public: false,
  pinned: false,
  is_critical: false,
  ends_on: "",
});

/** ISO → YYYY-MM-DD in Asia/Kolkata for the ends-on field. */
function isoToEndsOn(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** YYYY-MM-DD → end-of-day IST ISO, or null when blank. */
function endsOnToIso(date: string): string | null {
  const trimmed = date.trim();
  if (!trimmed) return null;
  const d = new Date(`${trimmed}T23:59:59.999+05:30`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function Field({
  label,
  value,
  onChange,
  multiline,
  hi,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  hi: boolean;
}) {
  const c = useColors();
  return (
    <View style={{ marginBottom: 12 }}>
      <Body muted style={{ fontSize: 12, marginBottom: 4, lineHeight: 22 }}>
        {label}
      </Body>
      <TextInput
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        textAlignVertical={multiline ? "top" : "center"}
        placeholderTextColor={c.mutedForeground}
        style={{
          fontFamily: bodyFamily(hi),
          fontSize: 16,
          lineHeight: 22,
          color: c.foreground,
          backgroundColor: c.muted,
          borderRadius: c.radius ?? 12,
          paddingHorizontal: 14,
          paddingVertical: multiline ? 12 : 12,
          minHeight: multiline ? 96 : undefined,
        }}
      />
    </View>
  );
}

function NoticeEditor({
  open,
  onClose,
  initial,
  centreId,
  centreBatches,
  onSave,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  initial: FormState | null;
  centreId: string;
  centreBatches: { id: string; name: string }[];
  onSave: (body: NoticeWriteBody) => void;
  busy: boolean;
}) {
  const c = useColors();
  const { hi } = useLocale();
  const [form, setForm] = useState<FormState>(emptyForm());
  const [translateAvailable, setTranslateAvailable] = useState(false);
  const [translating, setTranslating] = useState<"title" | "content" | null>(null);
  const [titleHiSuggested, setTitleHiSuggested] = useState(false);
  const [contentHiSuggested, setContentHiSuggested] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(initial ?? emptyForm());
    setTitleHiSuggested(false);
    setContentHiSuggested(false);
    setTranslating(null);
    void apiGet<{ available: boolean }>("/v1/translate")
      .then((r) => setTranslateAvailable(r?.available === true))
      .catch(() => setTranslateAvailable(false));
  }, [open, initial]);

  async function translateField(field: "title" | "content") {
    const source = field === "title" ? form.title_en.trim() : form.content_en.trim();
    if (!source || !translateAvailable || translating) return;
    setTranslating(field);
    try {
      const res = await apiPost<{ text: string }>("/v1/translate", {
        text: source,
        target: "hi",
        context: "notice",
      });
      const text = res?.text?.trim() ?? "";
      if (!text) throw new Error("Empty translation");
      if (field === "title") {
        setForm((f) => ({ ...f, title_hi: text }));
        setTitleHiSuggested(true);
      } else {
        setForm((f) => ({ ...f, content_hi: text }));
        setContentHiSuggested(true);
      }
    } catch (e) {
      Alert.alert(
        hi ? "अनुवाद नहीं हुआ" : "Could not translate",
        e instanceof Error ? e.message : hi ? "फिर कोशिश करें।" : "Try again.",
      );
    } finally {
      setTranslating(null);
    }
  }

  function submit() {
    const title_en = form.title_en.trim();
    const title_hi = form.title_hi.trim();
    const content_en = form.content_en.trim();
    const content_hi = form.content_hi.trim();
    if (!title_en || !title_hi || !content_en || !content_hi) {
      Alert.alert(
        hi ? "अधूरा" : "Incomplete",
        hi
          ? "अंग्रेज़ी और हिंदी दोनों में शीर्षक और सामग्री आवश्यक हैं।"
          : "Title and content are required in both English and Hindi.",
      );
      return;
    }
    if (form.audience === "batch" && !form.batch_id) {
      Alert.alert(
        hi ? "बैच चुनें" : "Choose a batch",
        hi ? "बैच दर्शकों के लिए एक बैच चुनें।" : "Pick a batch for batch audience.",
      );
      return;
    }
    const body: NoticeWriteBody = {
      title_en,
      title_hi,
      content_en,
      content_hi,
      audience: form.audience,
      is_public: form.is_public,
      pinned: form.pinned,
      is_critical: form.is_critical,
      expires_at: endsOnToIso(form.ends_on),
      ...(form.audience === "centre"
        ? { centre_id: centreId }
        : { batch_id: form.batch_id! }),
    };
    onSave(body);
  }

  return (
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ActivityThemed accent="notices">
        <View
          style={{
            paddingHorizontal: 18,
            paddingTop: 18,
            paddingBottom: 12,
            borderBottomWidth: 1,
            borderBottomColor: c.border,
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Title style={{ fontSize: 18, lineHeight: 26, flex: 1, paddingRight: 12 }}>
            {initial ? (hi ? "सूचना संपादित करें" : "Edit notice") : hi ? "नई सूचना" : "Compose notice"}
          </Title>
          <Pressable onPress={onClose} hitSlop={12} disabled={busy}>
            <Text style={{ color: c.primary, fontFamily: bodyFamily(hi, "semibold") }}>
              {hi ? "बंद करें" : "Close"}
            </Text>
          </Pressable>
        </View>
        <KeyboardAwareScrollViewCompat
          contentContainerStyle={{ padding: 18, paddingBottom: 40 }}
          bottomOffset={20}
          keyboardShouldPersistTaps="handled"
        >
          <Field
            label={hi ? "शीर्षक (अंग्रेज़ी)" : "Title (English)"}
            value={form.title_en}
            onChange={(title_en) => setForm((f) => ({ ...f, title_en }))}
            hi={hi}
          />
          <Field
            label={hi ? "शीर्षक (हिंदी)" : "Title (Hindi)"}
            value={form.title_hi}
            onChange={(title_hi) => {
              setTitleHiSuggested(false);
              setForm((f) => ({ ...f, title_hi }));
            }}
            hi={hi}
          />
          {translateAvailable ? (
            <Pressable
              onPress={() => void translateField("title")}
              disabled={!form.title_en.trim() || translating !== null}
              style={{
                alignSelf: "flex-start",
                marginBottom: titleHiSuggested ? 4 : 12,
                opacity: !form.title_en.trim() || translating !== null ? 0.5 : 1,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
              }}
            >
              {translating === "title" ? (
                <ActivityIndicator color={c.primary} size="small" />
              ) : null}
              <Text
                style={{
                  color: c.primary,
                  fontFamily: bodyFamily(hi, "semibold"),
                  fontSize: 14,
                  lineHeight: 22,
                }}
              >
                {hi ? "हिंदी में अनुवाद करें" : "Translate to Hindi"}
              </Text>
            </Pressable>
          ) : null}
          {titleHiSuggested ? (
            <Body muted style={{ fontSize: 12, marginBottom: 12, lineHeight: 22 }}>
              {hi
                ? "मशीन अनुवाद — प्रकाशित करने से पहले जाँचें।"
                : "Machine translation — please check before publishing."}
            </Body>
          ) : null}

          <Field
            label={hi ? "सामग्री (अंग्रेज़ी)" : "Content (English)"}
            value={form.content_en}
            onChange={(content_en) => setForm((f) => ({ ...f, content_en }))}
            multiline
            hi={hi}
          />
          <Field
            label={hi ? "सामग्री (हिंदी)" : "Content (Hindi)"}
            value={form.content_hi}
            onChange={(content_hi) => {
              setContentHiSuggested(false);
              setForm((f) => ({ ...f, content_hi }));
            }}
            multiline
            hi={hi}
          />
          {translateAvailable ? (
            <Pressable
              onPress={() => void translateField("content")}
              disabled={!form.content_en.trim() || translating !== null}
              style={{
                alignSelf: "flex-start",
                marginBottom: contentHiSuggested ? 4 : 12,
                opacity: !form.content_en.trim() || translating !== null ? 0.5 : 1,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
              }}
            >
              {translating === "content" ? (
                <ActivityIndicator color={c.primary} size="small" />
              ) : null}
              <Text
                style={{
                  color: c.primary,
                  fontFamily: bodyFamily(hi, "semibold"),
                  fontSize: 14,
                  lineHeight: 22,
                }}
              >
                {hi ? "हिंदी में अनुवाद करें" : "Translate to Hindi"}
              </Text>
            </Pressable>
          ) : null}
          {contentHiSuggested ? (
            <Body muted style={{ fontSize: 12, marginBottom: 12, lineHeight: 22 }}>
              {hi
                ? "मशीन अनुवाद — प्रकाशित करने से पहले जाँचें।"
                : "Machine translation — please check before publishing."}
            </Body>
          ) : null}

          <Body muted style={{ fontSize: 12, marginBottom: 6, lineHeight: 22 }}>
            {hi ? "दर्शक" : "Audience"}
          </Body>
          <Row style={{ gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            {(
              [
                { key: "centre" as const, en: "My centre", hi: "मेरा केंद्र" },
                { key: "batch" as const, en: "A batch at my centre", hi: "मेरे केंद्र का बैच" },
              ] as const
            ).map((opt) => {
              const active = form.audience === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() =>
                    setForm((f) => ({
                      ...f,
                      audience: opt.key,
                      batch_id: opt.key === "centre" ? null : f.batch_id,
                    }))
                  }
                  style={{
                    backgroundColor: active ? c.primary : c.muted,
                    borderRadius: 999,
                    paddingHorizontal: 14,
                    paddingVertical: 9,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: bodyFamily(hi, "semibold"),
                      fontSize: 14,
                      lineHeight: 22,
                      color: active ? c.primaryForeground : c.mutedForeground,
                    }}
                  >
                    {hi ? opt.hi : opt.en}
                  </Text>
                </Pressable>
              );
            })}
          </Row>

          {form.audience === "batch" ? (
            <View style={{ marginBottom: 12 }}>
              <Body muted style={{ fontSize: 12, marginBottom: 6, lineHeight: 22 }}>
                {hi ? "बैच" : "Batch"}
              </Body>
              {centreBatches.length === 0 ? (
                <Body muted style={{ lineHeight: 22 }}>
                  {hi ? "इस केंद्र पर कोई बैच नहीं।" : "No batches at this centre."}
                </Body>
              ) : (
                <View style={{ gap: 8 }}>
                  {centreBatches.map((b) => {
                    const active = form.batch_id === b.id;
                    return (
                      <Pressable
                        key={b.id}
                        onPress={() => setForm((f) => ({ ...f, batch_id: b.id }))}
                        style={{
                          backgroundColor: active ? c.primary : c.muted,
                          borderRadius: c.radius ?? 12,
                          paddingHorizontal: 14,
                          paddingVertical: 12,
                        }}
                      >
                        <Text
                          style={{
                            fontFamily: bodyFamily(hi, "semibold"),
                            fontSize: 15,
                            lineHeight: 22,
                            color: active ? c.primaryForeground : c.foreground,
                          }}
                        >
                          {b.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          ) : null}

          <Row style={{ justifyContent: "space-between", marginBottom: 10 }}>
            <Body style={{ lineHeight: 22 }}>{hi ? "पिन किया" : "Pinned"}</Body>
            <Switch
              value={form.pinned}
              onValueChange={(pinned) => setForm((f) => ({ ...f, pinned }))}
              trackColor={{ true: c.primary, false: c.border }}
            />
          </Row>
          <Row style={{ justifyContent: "space-between", marginBottom: 10 }}>
            <Body style={{ lineHeight: 22 }}>{hi ? "महत्वपूर्ण" : "Critical"}</Body>
            <Switch
              value={form.is_critical}
              onValueChange={(is_critical) => setForm((f) => ({ ...f, is_critical }))}
              trackColor={{ true: c.primary, false: c.border }}
            />
          </Row>

          <Field
            label={hi ? "समाप्ति तिथि (वैकल्पिक)" : "Ends on (optional)"}
            value={form.ends_on}
            onChange={(ends_on) => setForm((f) => ({ ...f, ends_on }))}
            hi={hi}
          />
          <Body muted style={{ fontSize: 12, marginBottom: 18, lineHeight: 22 }}>
            {hi
              ? "खाली छोड़ें तो यह सूचना अनिश्चितकाल तक दिखेगी।"
              : "Leave blank to keep this notice up indefinitely."}
          </Body>

          <Button
            label={initial ? (hi ? "सहेजें" : "Save changes") : hi ? "प्रकाशित करें" : "Publish"}
            onPress={submit}
            loading={busy}
          />
        </KeyboardAwareScrollViewCompat>
      </ActivityThemed>
    </Modal>
  );
}

export default function NoticesScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const centresQ = useAdminCentres();
  const centres = useMemo(
    () =>
      (centresQ.data?.items ?? []).map((x) => ({
        centre_id: x.id,
        centre_name: x.name,
      })),
    [centresQ.data?.items],
  );
  const [selectedCentreId, pickCentre] = usePersistedCentreId(centres, CENTRE_KEY);
  const noticesQ = useAdminNotices();
  const batchesQ = useAdminBatches();
  const createMut = useCreateNotice();
  const updateMut = useUpdateNotice();
  const deleteMut = useDeleteNotice();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<AdminNoticeRow | null>(null);

  const centreBatches = useMemo(() => {
    const all = batchesQ.data?.items ?? [];
    if (!selectedCentreId) return [];
    return all
      .filter((b) => b.centre_id === selectedCentreId && b.status === "active")
      .map((b) => ({ id: b.id, name: b.name ?? (hi ? "बैच" : "Batch") }));
  }, [batchesQ.data?.items, selectedCentreId, hi]);

  // Sanchalak can only author centre/batch notices — hide city+ from the list noise.
  const items = useMemo(() => {
    const all = noticesQ.data?.items ?? [];
    return all.filter((n) => n.audience === "centre" || n.audience === "batch");
  }, [noticesQ.data?.items]);

  const initialForm: FormState | null = editing
    ? {
        title_en: editing.title_en,
        title_hi: editing.title_hi ?? "",
        content_en: editing.content_en ?? "",
        content_hi: editing.content_hi ?? "",
        audience: editing.audience === "batch" ? "batch" : "centre",
        batch_id: editing.batch_id,
        is_public: editing.is_public,
        pinned: editing.pinned,
        is_critical: editing.is_critical,
        ends_on: isoToEndsOn(editing.expires_at),
      }
    : null;

  function openCreate() {
    setEditing(null);
    setEditorOpen(true);
  }

  function openEdit(n: AdminNoticeRow) {
    setEditing(n);
    setEditorOpen(true);
  }

  return (
    <ActivityThemed accent="notices">
      <AppHeader
        title={hi ? "सूचनाएँ" : "Notices"}
        subtitle={hi ? "माता-पिता के लिए सूचनाएँ" : "Notices for parents"}
        right={
          <Pressable onPress={openCreate} hitSlop={12} disabled={!selectedCentreId}>
            <Text
              style={{
                color: selectedCentreId ? c.primary : c.mutedForeground,
                fontFamily: bodyFamily(hi, "semibold"),
                fontSize: 15,
                lineHeight: 22,
              }}
            >
              {hi ? "लिखें" : "Compose"}
            </Text>
          </Pressable>
        }
      />
      <Screen
        refreshing={noticesQ.isRefetching || centresQ.isRefetching}
        onRefresh={() => {
          void noticesQ.refetch();
          void centresQ.refetch();
        }}
      >
        <CentreSwitcher
          centres={centres}
          storageKey={CENTRE_KEY}
          selectedId={selectedCentreId}
          onChange={pickCentre}
        />

        {noticesQ.isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : noticesQ.isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "सूचनाएँ लोड नहीं हुईं।" : "Could not load notices."}
            onRetry={() => void noticesQ.refetch()}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : items.length === 0 ? (
          <StateView
            status="empty"
            emptyText={hi ? "कोई सूचना नहीं।" : "No notices yet."}
          />
        ) : (
          items.map((n) => {
            const title = hi ? (n.title_hi ?? n.title_en) : n.title_en;
            const content = hi ? (n.content_hi ?? n.content_en) : n.content_en;
            const audienceLabel =
              n.audience === "batch"
                ? n.batch_name ?? (hi ? "बैच" : "Batch")
                : n.centre_name ?? (hi ? "केंद्र" : "Centre");
            return (
              <Card key={n.id}>
                <Row style={{ justifyContent: "space-between", gap: 8 }}>
                  <Title style={{ fontSize: 17, lineHeight: 24, flex: 1 }}>{title}</Title>
                  {n.pinned ? <Pill tone="info" label={hi ? "पिन" : "Pinned"} /> : null}
                </Row>
                <Row style={{ marginTop: 8, gap: 8, flexWrap: "wrap" }}>
                  <Pill tone="neutral" label={audienceLabel} />
                  {n.is_critical ? (
                    <Pill tone="error" label={hi ? "महत्वपूर्ण" : "Critical"} />
                  ) : null}
                  {n.is_expired ? (
                    <Pill tone="neutral" label={hi ? "समाप्त" : "Expired"} />
                  ) : null}
                </Row>
                {content ? (
                  <Body muted style={{ marginTop: 10, lineHeight: 22 }} numberOfLines={3}>
                    {content}
                  </Body>
                ) : null}
                <Row style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
                  <Button
                    label={hi ? "संपादित करें" : "Edit"}
                    variant="outline"
                    onPress={() => openEdit(n)}
                  />
                  <Button
                    label={hi ? "हटाएँ" : "Delete"}
                    variant="ghost"
                    loading={deleteMut.isPending && deleteMut.variables === n.id}
                    onPress={() =>
                      Alert.alert(
                        hi ? "सूचना हटाएँ?" : "Delete notice?",
                        hi
                          ? "यह सूचना स्थायी रूप से हटा दी जाएगी।"
                          : "This notice will be permanently removed.",
                        [
                          { text: hi ? "रद्द" : "Cancel", style: "cancel" },
                          {
                            text: hi ? "हटाएँ" : "Delete",
                            style: "destructive",
                            onPress: () =>
                              deleteMut.mutate(n.id, {
                                onError: (e) =>
                                  Alert.alert(
                                    hi ? "त्रुटि" : "Error",
                                    e instanceof Error ? e.message : "Action failed",
                                  ),
                              }),
                          },
                        ],
                      )
                    }
                  />
                </Row>
              </Card>
            );
          })
        )}
      </Screen>

      {selectedCentreId ? (
        <NoticeEditor
          open={editorOpen}
          onClose={() => setEditorOpen(false)}
          initial={initialForm}
          centreId={editing?.centre_id ?? selectedCentreId}
          centreBatches={centreBatches}
          busy={createMut.isPending || updateMut.isPending}
          onSave={(body) => {
            const opts = {
              onSuccess: () => setEditorOpen(false),
              onError: (e: Error) =>
                Alert.alert(hi ? "त्रुटि" : "Error", e.message || "Action failed"),
            };
            if (editing) {
              updateMut.mutate({ id: editing.id, body }, opts);
            } else {
              createMut.mutate(body, opts);
            }
          }}
        />
      ) : null}
    </ActivityThemed>
  );
}
