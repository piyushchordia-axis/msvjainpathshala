import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
  type ListRenderItem,
} from "react-native";
import { fonts, bodyFamily } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import {
  useAdminBatches,
  useAdminCentres,
  useAdminStudents,
  useCreateAdminStudent,
  useStudentStatusAction,
} from "@/lib/queries";
import type { AdminStudentRow } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { ageGroupFromDob, formatAgeGroup } from "@workspace/api-zod";
import { ApiError } from "@/lib/api";
import { AppHeader } from "@/components/AppHeader";
import { CentreSwitcher, usePersistedCentreId } from "@/components/CentreSwitcher";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

const CENTRE_KEY = "jp.sanchalak.selectedCentreId";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const STATUS_FILTERS = [
  { key: "", en: "All", hi: "सभी" },
  { key: "active", en: "Active", hi: "सक्रिय" },
  { key: "inactive", en: "Inactive", hi: "निष्क्रिय" },
];

const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;

const GUARDIAN_RELATIONS = [
  { value: "father" as const, en: "Father", hi: "पिता" },
  { value: "mother" as const, en: "Mother", hi: "माता" },
  { value: "guardian" as const, en: "Guardian", hi: "अभिभावक" },
];

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return raw.trim();
}

function Chip({
  label,
  active,
  onPress,
  disabled,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        backgroundColor: active ? c.primary : c.muted,
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderWidth: 1,
        borderColor: active ? c.primary : c.border,
        opacity: disabled ? 0.5 : 1,
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
  const { hi } = useLocale();
  return (
    <Body muted style={{ fontSize: 12, marginBottom: 4, lineHeight: 22, fontFamily: bodyFamily(hi) }}>
      {children}
    </Body>
  );
}

function TextField(props: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "numeric" | "phone-pad";
  autoCapitalize?: "none" | "words";
}) {
  const c = useColors();
  const { hi } = useLocale();
  return (
    <TextInput
      value={props.value}
      onChangeText={props.onChangeText}
      placeholder={props.placeholder}
      placeholderTextColor={c.mutedForeground}
      keyboardType={props.keyboardType}
      autoCapitalize={props.autoCapitalize ?? "none"}
      autoCorrect={false}
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

function AddStudentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const c = useColors();
  const { hi } = useLocale();
  const centresQ = useAdminCentres(open);
  const batchesQ = useAdminBatches(open);
  const createMut = useCreateAdminStudent();

  const centres = useMemo(
    () =>
      (centresQ.data?.items ?? []).map((x) => ({
        centre_id: x.id,
        centre_name: x.name,
      })),
    [centresQ.data?.items],
  );
  const [centreId, setCentreId] = usePersistedCentreId(centres, CENTRE_KEY);

  const [fullName, setFullName] = useState("");
  const [dob, setDob] = useState("");
  const [batchId, setBatchId] = useState("");
  const [gender, setGender] = useState<"" | "male" | "female" | "other">("");
  const [bloodGroup, setBloodGroup] = useState("");
  const [guardianRelation, setGuardianRelation] = useState<"father" | "mother" | "guardian">("father");
  const [parentName, setParentName] = useState("");
  const [parentPhone, setParentPhone] = useState("");

  useEffect(() => {
    if (!open) return;
    setFullName("");
    setDob("");
    setBatchId("");
    setGender("");
    setBloodGroup("");
    setGuardianRelation("father");
    setParentName("");
    setParentPhone("");
  }, [open]);

  useEffect(() => {
    setBatchId("");
  }, [centreId]);

  const derivedAgeGroup = dob && DATE_RE.test(dob) ? ageGroupFromDob(dob) : null;

  const filteredBatches = useMemo(() => {
    const all = batchesQ.data?.items ?? [];
    return all.filter((b) => {
      if (centreId && b.centre_id && b.centre_id !== centreId) return false;
      if (centreId && !b.centre_id) {
        // fall back: match centre name when centre_id missing
        const centre = centres.find((x) => x.centre_id === centreId);
        if (centre && b.centre_name !== centre.centre_name) return false;
      }
      if (derivedAgeGroup && b.age_groups?.length && !b.age_groups.includes(derivedAgeGroup)) {
        return false;
      }
      return b.status === "active";
    });
  }, [batchesQ.data?.items, centreId, centres, derivedAgeGroup]);

  function submit() {
    const phone = normalizePhone(parentPhone);
    if (!fullName.trim() || !centreId || !DATE_RE.test(dob) || !parentName.trim() || !phone.startsWith("+")) {
      Alert.alert(
        hi ? "अधूरा फ़ॉर्म" : "Incomplete form",
        hi
          ? "नाम, केंद्र, जन्म तिथि (YYYY-MM-DD), अभिभावक नाम और मोबाइल भरें।"
          : "Fill name, centre, date of birth (YYYY-MM-DD), parent name and mobile.",
      );
      return;
    }
    if (!derivedAgeGroup) {
      Alert.alert(
        hi ? "जन्म तिथि गलत" : "Invalid date of birth",
        hi
          ? "आयु 5 से 21 वर्ष के बीच होनी चाहिए।"
          : "Date of birth must be between 5 and 21 years of age.",
      );
      return;
    }
    createMut.mutate(
      {
        full_name: fullName.trim(),
        centre_id: centreId,
        dob,
        batch_id: batchId || undefined,
        gender: gender || undefined,
        blood_group: bloodGroup || undefined,
        parent_full_name: parentName.trim(),
        parent_phone: phone,
        guardian_relation: guardianRelation,
      },
      {
        onSuccess: (res) => {
          Alert.alert(
            hi ? "विद्यार्थी जोड़ा" : "Student registered",
            res.parent_created
              ? hi
                ? `कोड ${res.student_code}. अभिभावक लॉगिन बनाया गया।`
                : `Code ${res.student_code}. Parent login created.`
              : hi
                ? `कोड ${res.student_code}. मौजूदा अभिभावक से जोड़ा गया।`
                : `Code ${res.student_code}. Linked to existing parent.`,
          );
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
      <ActivityThemed accent="students">
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
            {hi ? "विद्यार्थी जोड़ें" : "Add student"}
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
          <FieldLabel>{hi ? "पूरा नाम *" : "Full name *"}</FieldLabel>
          <TextField
            value={fullName}
            onChangeText={setFullName}
            placeholder={hi ? "विद्यार्थी का नाम" : "Student name"}
            autoCapitalize="words"
          />

          <FieldLabel>{hi ? "केंद्र *" : "Centre *"}</FieldLabel>
          <CentreSwitcher
            centres={centres}
            storageKey={CENTRE_KEY}
            selectedId={centreId}
            onChange={setCentreId}
          />

          <FieldLabel>{hi ? "जन्म तिथि * (YYYY-MM-DD)" : "Date of birth * (YYYY-MM-DD)"}</FieldLabel>
          <TextField value={dob} onChangeText={setDob} placeholder="2015-08-15" />
          <Body muted style={{ marginTop: -4, marginBottom: 12, lineHeight: 22, fontSize: 13 }}>
            {dob
              ? derivedAgeGroup
                ? `${hi ? "आयु समूह" : "Age group"}: ${formatAgeGroup(derivedAgeGroup, hi ? "hi" : "en")}`
                : hi
                  ? "आयु 5–21 वर्ष के बाहर"
                  : "Outside 5–21 years"
              : hi
                ? "आयु समूह जन्म तिथि से निकलेगा"
                : "Age group is derived from date of birth"}
          </Body>

          <FieldLabel>{hi ? "बैच (वैकल्पिक)" : "Batch (optional)"}</FieldLabel>
          <Row style={{ flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            <Chip
              label={hi ? "कोई नहीं" : "None"}
              active={!batchId}
              onPress={() => setBatchId("")}
            />
            {filteredBatches.map((b) => (
              <Chip
                key={b.id}
                label={b.name ?? b.id.slice(0, 8)}
                active={batchId === b.id}
                onPress={() => setBatchId(b.id)}
              />
            ))}
          </Row>

          <FieldLabel>{hi ? "लिंग" : "Gender"}</FieldLabel>
          <Row style={{ flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            {(
              [
                { v: "" as const, en: "—", hi: "—" },
                { v: "male" as const, en: "Male", hi: "पुरुष" },
                { v: "female" as const, en: "Female", hi: "महिला" },
                { v: "other" as const, en: "Other", hi: "अन्य" },
              ] as const
            ).map((g) => (
              <Chip
                key={g.v || "none"}
                label={hi ? g.hi : g.en}
                active={gender === g.v}
                onPress={() => setGender(g.v)}
              />
            ))}
          </Row>

          <FieldLabel>{hi ? "रक्त समूह" : "Blood group"}</FieldLabel>
          <Row style={{ flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            <Chip label="—" active={!bloodGroup} onPress={() => setBloodGroup("")} />
            {BLOOD_GROUPS.map((g) => (
              <Chip
                key={g}
                label={g}
                active={bloodGroup === g}
                onPress={() => setBloodGroup(g)}
              />
            ))}
          </Row>

          <Title style={{ fontSize: 15, marginBottom: 10, lineHeight: 22 }}>
            {hi ? "अभिभावक लॉगिन" : "Parent / guardian login"}
          </Title>

          <FieldLabel>{hi ? "संबंध *" : "Relation *"}</FieldLabel>
          <Row style={{ flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            {GUARDIAN_RELATIONS.map((r) => (
              <Chip
                key={r.value}
                label={hi ? r.hi : r.en}
                active={guardianRelation === r.value}
                onPress={() => setGuardianRelation(r.value)}
              />
            ))}
          </Row>

          <FieldLabel>{hi ? "अभिभावक का नाम *" : "Parent name *"}</FieldLabel>
          <TextField
            value={parentName}
            onChangeText={setParentName}
            placeholder={hi ? "पूरा नाम" : "Full name"}
            autoCapitalize="words"
          />

          <FieldLabel>{hi ? "मोबाइल *" : "Mobile *"}</FieldLabel>
          <TextField
            value={parentPhone}
            onChangeText={setParentPhone}
            placeholder="+91 98XXXXXXXX"
            keyboardType="phone-pad"
          />
          <Body muted style={{ marginTop: -4, marginBottom: 16, lineHeight: 22, fontSize: 13 }}>
            {hi
              ? "वे इस नंबर से ओटीपी से साइन इन कर सकेंगे।"
              : "They can sign in with this number (OTP) to manage the student."}
          </Body>

          <Button
            label={hi ? "पंजीकृत करें" : "Register"}
            onPress={submit}
            loading={createMut.isPending}
          />
        </KeyboardAwareScrollViewCompat>
      </ActivityThemed>
    </Modal>
  );
}

export default function StudentsScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const [status, setStatus] = useState("");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const list = useAdminStudents({ status: status || undefined, q: q || undefined });
  const mutate = useStudentStatusAction();

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
    ({ item: s }) => {
      const place = [s.batch_name, s.centre_name].filter(Boolean).join(" · ");
      return (
        <Card>
          <Row style={{ justifyContent: "space-between" }}>
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
            <Pill tone={s.status === "active" ? "success" : "neutral"} label={s.status} />
          </Row>
          <Row style={{ gap: 8, marginTop: 8 }}>
            {s.dob ? (
              <Body muted style={{ fontSize: 12 }}>
                {hi ? "जन्म" : "DOB"}: {formatDate(s.dob)}
              </Body>
            ) : null}
            {s.msv_status && s.msv_status !== "none" ? <Pill label={`MSV: ${s.msv_status}`} /> : null}
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
      );
    },
    [confirm, hi, mutate.isPending, mutate.variables?.id],
  );

  const keyExtractor = useCallback((item: AdminStudentRow) => item.id, []);

  return (
    <ActivityThemed accent="students">
      <AppHeader
        title={hi ? "विद्यार्थी" : "Students"}
        subtitle={hi ? "आपके केंद्रों की सूची" : "Roster across your centres"}
        right={
          <Button
            label={hi ? "जोड़ें" : "Add"}
            onPress={() => setAddOpen(true)}
            style={{ paddingHorizontal: 12, minHeight: 36 }}
          />
        }
      />
      <View
        style={{
          paddingHorizontal: 18,
          paddingTop: 8,
          paddingBottom: 4,
          gap: 10,
          borderBottomWidth: 1,
          borderBottomColor: c.border,
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
      <AddStudentModal open={addOpen} onClose={() => setAddOpen(false)} />
    </ActivityThemed>
  );
}
