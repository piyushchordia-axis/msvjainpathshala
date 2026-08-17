import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { bodyFamily, fonts } from "@/constants/typography";
import {
  useAdminBatches,
  useAdminCentres,
  useBatchAction,
  useCentreShikshaks,
  useCreateAdminBatch,
} from "@/lib/queries";
import { recordStatusLabel } from "@/lib/status-labels";
import { formatTimeRange } from "@/lib/format";
import { AGE_GROUPS, formatAgeGroup, formatAgeGroups } from "@workspace/api-zod";
import { AppHeader } from "@/components/AppHeader";
import { CentreSwitcher, usePersistedCentreId } from "@/components/CentreSwitcher";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";
import { ApiError } from "@/lib/api";

const CENTRE_KEY = "jp.sanchalak.selectedCentreId";
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

// ISO weekday: 1=Mon … 7=Sun (index 0 unused) — matches the API/web convention.
const DAYS_EN = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAYS_HI = ["", "सोम", "मंगल", "बुध", "गुरु", "शुक्र", "शनि", "रवि"];

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: active ? c.primary : c.muted,
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderWidth: 1,
        borderColor: active ? c.primary : c.border,
      }}
    >
      <Text
        style={{
          fontFamily: fonts.bodySemiBold,
          fontSize: 13,
          color: active ? c.primaryForeground : c.mutedForeground,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function FieldLabel({ children }: { children: string }) {
  const c = useColors();
  const { hi } = useLocale();
  return (
    <Body muted style={{ fontSize: 12, marginBottom: 4, lineHeight: 22, fontFamily: bodyFamily(hi) }}>
      {children}
    </Body>
  );
}

function TextField({
  value,
  onChangeText,
  placeholder,
  keyboardType,
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "numeric";
}) {
  const c = useColors();
  const { hi } = useLocale();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={c.mutedForeground}
      keyboardType={keyboardType}
      autoCapitalize="none"
      style={{
        fontFamily: bodyFamily(hi),
        fontSize: 16,
        lineHeight: 22,
        color: c.foreground,
        backgroundColor: c.muted,
        borderRadius: c.radius ?? 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
        marginBottom: 12,
      }}
    />
  );
}

function CreateBatchModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const c = useColors();
  const { hi } = useLocale();
  const centresQ = useAdminCentres(open);
  const centres = useMemo(
    () =>
      (centresQ.data?.items ?? []).map((x) => ({
        centre_id: x.id,
        centre_name: x.name,
      })),
    [centresQ.data?.items],
  );
  const [centreId, setCentreId] = usePersistedCentreId(centres, CENTRE_KEY);
  const shikshaksQ = useCentreShikshaks(centreId, open && !!centreId);
  const createMut = useCreateAdminBatch();

  const [name, setName] = useState("");
  const [ageGroups, setAgeGroups] = useState<string[]>([]);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [capacity, setCapacity] = useState("30");
  const [primaryId, setPrimaryId] = useState("");

  useEffect(() => {
    if (!open) return;
    setName("");
    setAgeGroups([]);
    setStartTime("");
    setEndTime("");
    setSelectedDays([]);
    setCapacity("30");
    setPrimaryId("");
  }, [open]);

  useEffect(() => {
    setPrimaryId("");
  }, [centreId]);

  const tagged = (shikshaksQ.data?.items ?? []).filter((s) => s.is_active);

  function toggleAge(g: string) {
    setAgeGroups((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));
  }

  function toggleDay(d: number) {
    setSelectedDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }

  function submit() {
    if (!centreId) {
      Alert.alert(hi ? "केंद्र चुनें" : "Pick a centre", hi ? "पहले केंद्र चुनें।" : "Select a centre first.");
      return;
    }
    if (!name.trim() || ageGroups.length === 0 || !TIME_RE.test(startTime.trim()) || !TIME_RE.test(endTime.trim())) {
      Alert.alert(
        hi ? "अधूरा फ़ॉर्म" : "Incomplete form",
        hi
          ? "नाम, आयु समूह और समय (HH:MM) भरें।"
          : "Fill name, at least one age group, and times as HH:MM.",
      );
      return;
    }
    const cap = Number(capacity) || 30;
    createMut.mutate(
      {
        centre_id: centreId,
        name: name.trim(),
        age_groups: ageGroups as Array<"bal" | "kishor" | "tarun" | "yuva">,
        start_time: startTime.trim(),
        end_time: endTime.trim(),
        day_of_week: selectedDays,
        capacity: Math.min(500, Math.max(1, cap)),
        ...(primaryId ? { primary_shikshak_id: primaryId } : {}),
      },
      {
        onSuccess: () => {
          Alert.alert(hi ? "बैच बना" : "Batch created", hi ? "नया बैच जोड़ दिया गया।" : "The new batch was added.");
          onClose();
        },
        onError: (e) =>
          Alert.alert(
            hi ? "त्रुटि" : "Error",
            e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Action failed",
          ),
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
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Title style={{ fontSize: 18, lineHeight: 26, flex: 1, paddingRight: 12 }}>
            {hi ? "बैच बनाएँ" : "Create batch"}
          </Title>
          <Pressable onPress={onClose} hitSlop={12} disabled={createMut.isPending}>
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
          <FieldLabel>{hi ? "केंद्र *" : "Centre *"}</FieldLabel>
          <CentreSwitcher
            centres={centres}
            storageKey={CENTRE_KEY}
            selectedId={centreId}
            onChange={setCentreId}
          />

          <FieldLabel>{hi ? "बैच का नाम *" : "Batch name *"}</FieldLabel>
          <TextField
            value={name}
            onChangeText={setName}
            placeholder={hi ? "उदा. प्रातः बाल बैच" : "e.g. Morning Bal batch"}
          />

          <FieldLabel>
            {hi ? `आयु समूह * (${ageGroups.length} चुने)` : `Age groups * (${ageGroups.length} selected)`}
          </FieldLabel>
          <Row style={{ flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            {AGE_GROUPS.map((g) => (
              <Chip
                key={g}
                label={formatAgeGroup(g, hi ? "hi" : "en")}
                active={ageGroups.includes(g)}
                onPress={() => toggleAge(g)}
              />
            ))}
          </Row>

          <Row style={{ gap: 12 }}>
            <View style={{ flex: 1 }}>
              <FieldLabel>{hi ? "आरंभ समय *" : "Start time *"}</FieldLabel>
              <TextField value={startTime} onChangeText={setStartTime} placeholder="09:00" />
            </View>
            <View style={{ flex: 1 }}>
              <FieldLabel>{hi ? "समाप्ति समय *" : "End time *"}</FieldLabel>
              <TextField value={endTime} onChangeText={setEndTime} placeholder="10:30" />
            </View>
          </Row>

          <FieldLabel>{hi ? "सप्ताह के दिन" : "Days of week"}</FieldLabel>
          <Row style={{ flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <Chip
                key={d}
                label={(hi ? DAYS_HI[d] : DAYS_EN[d]) ?? String(d)}
                active={selectedDays.includes(d)}
                onPress={() => toggleDay(d)}
              />
            ))}
          </Row>

          <FieldLabel>{hi ? "क्षमता" : "Capacity"}</FieldLabel>
          <TextField value={capacity} onChangeText={setCapacity} placeholder="30" keyboardType="numeric" />

          <FieldLabel>{hi ? "मुख्य गुरुजी / दीदी (वैकल्पिक)" : "Primary Guruji / Didi (optional)"}</FieldLabel>
          {!centreId ? (
            <Body muted style={{ marginBottom: 12, lineHeight: 22 }}>
              {hi ? "पहले केंद्र चुनें।" : "Pick a centre first."}
            </Body>
          ) : tagged.length === 0 ? (
            <Body muted style={{ marginBottom: 12, lineHeight: 22 }}>
              {hi
                ? "इस केंद्र पर पहले गुरुजी टैग करें (शिक्षक स्क्रीन)।"
                : "Tag Gurujis on this centre first (Shikshaks screen)."}
            </Body>
          ) : (
            <Row style={{ flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
              <Chip
                label={hi ? "कोई नहीं" : "None yet"}
                active={!primaryId}
                onPress={() => setPrimaryId("")}
              />
              {tagged.map((t) => (
                <Chip
                  key={t.user_id}
                  label={`${t.gender === "female" ? (hi ? "दीदी" : "Didi") : hi ? "गुरुजी" : "Guruji"} ${t.full_name}`}
                  active={primaryId === t.user_id}
                  onPress={() => setPrimaryId(t.user_id)}
                />
              ))}
            </Row>
          )}

          <Button
            label={hi ? "बैच बनाएँ" : "Create batch"}
            onPress={submit}
            loading={createMut.isPending}
            style={{ marginTop: 8 }}
          />
        </KeyboardAwareScrollViewCompat>
      </View>
    </Modal>
  );
}

export default function BatchesScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { data, isLoading, isError, refetch, isRefetching } = useAdminBatches();
  const mutate = useBatchAction();
  const [createOpen, setCreateOpen] = useState(false);

  const items = data?.items ?? [];

  const formatDays = (days: number[]) =>
    days.map((d) => (hi ? DAYS_HI[d] : DAYS_EN[d]) ?? "").filter(Boolean).join(", ");

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader
        title={hi ? "बैच" : "Batches"}
        subtitle={hi ? "आपके केंद्रों के बैच" : "Batches across your centres"}
        right={
          <Button
            label={hi ? "बनाएँ" : "Create"}
            onPress={() => setCreateOpen(true)}
            style={{ paddingHorizontal: 12, minHeight: 36 }}
          />
        }
      />
      <Screen refreshing={isRefetching} onRefresh={refetch}>
        {isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "बैच लोड नहीं हुए।" : "Could not load batches."}
            onRetry={refetch}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : items.length === 0 ? (
          <StateView status="empty" emptyText={hi ? "कोई बैच नहीं मिला।" : "No batches found."} />
        ) : (
          items.map((b) => {
            const active = b.status === "active";
            const schedule = [b.shikshak_name, formatDays(b.day_of_week), formatTimeRange(b.start_time, b.end_time)]
              .filter(Boolean)
              .join(" · ");
            return (
              <Card key={b.id}>
                <Row style={{ justifyContent: "space-between" }}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Title style={{ fontSize: 17 }}>{b.name ?? "—"}</Title>
                    <Body muted style={{ fontSize: 12, marginTop: 2 }}>
                      {[b.centre_name, formatAgeGroups(b.age_groups, hi ? "hi" : "en")].filter(Boolean).join(" · ") || "—"}
                    </Body>
                  </View>
                  <Pill tone={active ? "success" : "neutral"} label={recordStatusLabel(b.status, hi)} />
                </Row>
                {schedule ? <Body muted style={{ fontSize: 13, marginTop: 8 }}>{schedule}</Body> : null}
                <Button
                  label={active ? (hi ? "निष्क्रिय करें" : "Deactivate") : (hi ? "सक्रिय करें" : "Activate")}
                  variant={active ? "outline" : "secondary"}
                  onPress={() =>
                    mutate.mutate(
                      { id: b.id, action: active ? "deactivate" : "activate" },
                      { onError: (e) => Alert.alert(hi ? "त्रुटि" : "Error", e instanceof Error ? e.message : "Action failed") },
                    )
                  }
                  loading={mutate.isPending && mutate.variables?.id === b.id}
                  style={{ marginTop: 12 }}
                />
              </Card>
            );
          })
        )}
      </Screen>
      <CreateBatchModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </View>
  );
}
