import { useCallback, useEffect, useMemo, useState } from "react";
import { Image, Pressable, ScrollView, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { apiGet, apiPost } from "@/lib/api";
import { apiErrorMessage } from "@/lib/api-error-copy";
import { mergeById, usePickerSearch } from "@/lib/picker-search";
import { joinUpload, safeImageMime, safeImageUploadName } from "@/lib/join-upload";
import {
  STAFF_SECTIONS,
  dobProblem,
  fieldLabel,
  fieldPlaceholder,
  fieldsForSection,
  optionLabel,
  photoField,
  type JoinField,
} from "@/lib/join";
import { DateOfBirthField } from "@/components/join/DateOfBirthField";
import { fonts } from "@/constants/typography";
import { Body, Button, Card, Screen, Title } from "@/components/ui";

/** Age band the staff join form accepts, mirrored by staffCreateSchema. */
const STAFF_MIN_AGE = 15;
const STAFF_MAX_AGE = 90;

type Centre = {
  id: string;
  name: string;
  code: string | null;
  city_name?: string;
};

export function StaffJoinScreen({ kind }: { kind: "shikshak" | "sanchalak" }) {
  const c = useColors();
  const { hi } = useLocale();
  const router = useRouter();
  const [phase, setPhase] = useState<"loading" | "error" | "closed" | "form" | "done">("loading");
  const [sectionIdx, setSectionIdx] = useState(0);
  const [allFields, setAllFields] = useState<JoinField[]>([]);
  const [centres, setCentres] = useState<Centre[]>([]);
  const [centreQuery, setCentreQuery] = useState("");
  const [centreId, setCentreId] = useState("");
  const [role, setRole] = useState(kind === "sanchalak" ? "संचालक" : "");
  const [values, setValues] = useState<Record<string, string>>({});
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoPreviewUri, setPhotoPreviewUri] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadForm = useCallback(async () => {
    setPhase("loading");
    try {
      const [s, f, centresRes] = await Promise.all([
        apiGet<{ registration_open: boolean }>(`/v1/join/settings?kind=${kind}`),
        apiGet<{ items: JoinField[] }>(`/v1/join/form-fields?kind=${kind}`),
        apiGet<{ items: Centre[] }>("/v1/public/centres"),
      ]);
      setAllFields(f.items);
      setCentres(centresRes.items.filter((x) => !!x.code));
      // 'closed' only when the server actually says so — a load failure used to
      // masquerade as "registration is closed" (GST-API-01).
      setPhase(s.registration_open ? "form" : "closed");
    } catch {
      setPhase("error");
    }
  }, [kind]);

  useEffect(() => {
    void loadForm();
  }, [loadForm]);

  const photo = useMemo(() => photoField(allFields), [allFields]);
  const section = STAFF_SECTIONS[sectionIdx]!;
  const sectionFields = useMemo(
    () => fieldsForSection(allFields, section).filter((f) => f.field_key !== "role"),
    [allFields, section],
  );
  // Server-side ?q= merge — beyond the clamped first page a centre was
  // unpickable however the applicant spelled it (GST-PRF-03).
  const centreQ = centreQuery.trim();
  const centreExtra = usePickerSearch<Centre>(
    centreQ.length >= 2 ? `/v1/public/centres?q=${encodeURIComponent(centreQ)}` : null,
  );

  const filteredCentres = useMemo(() => {
    const q = centreQ.toLowerCase();
    const pool = mergeById(centres, centreExtra.filter((x) => !!x.code));
    if (!q) return pool;
    return pool.filter(
      (centre) =>
        centre.name.toLowerCase().includes(q) ||
        (centre.code ?? "").toLowerCase().includes(q) ||
        (centre.city_name ?? "").toLowerCase().includes(q),
    );
  }, [centres, centreExtra, centreQ]);

  // Collapse to the chosen centre once one is picked; the applicant reopens the
  // list by editing the search box.
  const selectedCentreLabel = useMemo(() => {
    const picked = filteredCentres.find((x) => x.id === centreId);
    return picked ? `${picked.name} (${picked.code})` : null;
  }, [filteredCentres, centreId]);
  const visibleCentres = useMemo(
    () =>
      selectedCentreLabel && centreQuery === selectedCentreLabel
        ? filteredCentres.filter((x) => x.id === centreId)
        : filteredCentres.slice(0, 12),
    [filteredCentres, centreId, centreQuery, selectedCentreLabel],
  );

  const inputStyle = {
    borderWidth: 1,
    borderColor: c.input,
    borderRadius: c.radius,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 6,
    fontFamily: fonts.body,
    color: c.foreground,
    backgroundColor: c.card,
  } as const;

  const chip = (active: boolean) => ({
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: active ? c.primary : c.border,
    backgroundColor: active ? c.primary : c.card,
    marginRight: 8,
    marginTop: 8,
  });

  const setValue = (key: string, v: string) => setValues((prev) => ({ ...prev, [key]: v }));

  const pickPhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    if (res.canceled || !res.assets[0]) return;
    const asset = res.assets[0];
    setPhotoPreviewUri(asset.uri);
    setBusy(true);
    setError(null);
    try {
      const up = await joinUpload({
        uri: asset.uri,
        name: safeImageUploadName(asset.fileName, asset.uri),
        type: safeImageMime(asset.mimeType),
      });
      setPhotoUrl(up.url);
    } catch (e) {
      setPhotoPreviewUri(null);
      setPhotoUrl(null);
      // Bilingual copy keyed off error.code (GST-API-05).
      setError(apiErrorMessage(e, hi, {
        ERR_VALIDATION_FAILED: {
          en: "Upload failed — choose a clear image and try again.",
          hi: "अपलोड विफल रहा — साफ़ छवि चुनकर पुनः प्रयास करें।",
        },
      }));
    } finally {
      setBusy(false);
    }
  };

  const validateSection = (): string | null => {
    if (section.includeCentre && !centreId) {
      return hi ? "केंद्र चुनें" : "Choose a centre";
    }
    if (section.includeRole && kind === "shikshak" && !role) {
      return hi ? "भूमिका चुनें" : "Choose a role";
    }
    for (const f of sectionFields) {
      if (!f.is_required) continue;
      if (!values[f.field_key]?.trim()) {
        return hi
          ? `${fieldLabel(f, true)} आवश्यक है`
          : `${fieldLabel(f, false)} is required`;
      }
    }
    if (section.includePhoto && photo?.is_required && !photoUrl) {
      return hi ? "फ़ोटो अपलोड करें" : "Please upload a photo";
    }
    // The staff form never validated age at all; the DOB it replaces is what
    // the whole registration is dated from, so check it here.
    if (sectionFields.some((f) => f.field_key === "date_of_birth")) {
      const problem = dobProblem(values.date_of_birth, STAFF_MIN_AGE, STAFF_MAX_AGE, hi);
      if (problem) return problem;
    }
    if (sectionFields.some((f) => f.field_key === "whatsapp_contact")) {
      const wa = values.whatsapp_contact ?? "";
      if (wa && !/^\d{10}$/.test(wa)) {
        return hi
          ? "10 अंकों का WhatsApp नंबर दर्ज करें"
          : "Enter a valid 10-digit WhatsApp number";
      }
    }
    return null;
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await apiPost<{ display_code: string }>("/v1/join/registrations", {
        kind,
        centre_id: centreId,
        name: values.name,
        whatsapp_contact: values.whatsapp_contact,
        s_o: values.s_o || null,
        date_of_birth: values.date_of_birth || null,
        sex: values.sex || null,
        school_qualification: values.school_qualification || null,
        address: values.address || null,
        religious_education: values.religious_education || null,
        years_at_pathshala: values.years_at_pathshala
          ? Number(values.years_at_pathshala)
          : null,
        current_pathshala: values.current_pathshala || null,
        vision: values.vision || null,
        pathshala_timing: values.pathshala_timing || null,
        pathshala_name: values.pathshala_name || null,
        role: role || "संचालक",
        photo_url: photoUrl,
      });
      setCode(created.display_code);
      setPhase("done");
    } catch (e) {
      // Bilingual copy keyed off error.code (GST-API-05).
      setError(apiErrorMessage(e, hi));
    } finally {
      setBusy(false);
    }
  };

  const goNext = () => {
    const v = validateSection();
    if (v) {
      setError(v);
      return;
    }
    setError(null);
    if (sectionIdx < STAFF_SECTIONS.length - 1) {
      setSectionIdx((i) => i + 1);
      return;
    }
    void submit();
  };

  const renderField = (f: JoinField) => (
    <View key={f.id} style={{ marginBottom: 14 }}>
      <Body>
        {fieldLabel(f, hi)}
        {f.is_required ? " *" : ""}
      </Body>
      {f.field_type === "date" ? (
        <DateOfBirthField
          value={values[f.field_key]}
          onChange={(iso) => setValue(f.field_key, iso)}
          hi={hi}
          minAge={STAFF_MIN_AGE}
          maxAge={STAFF_MAX_AGE}
        />
      ) : f.field_type === "yesno" ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          {(["yes", "no"] as const).map((v) => {
            const active = values[f.field_key] === v;
            return (
              <Pressable key={v} onPress={() => setValue(f.field_key, v)} style={chip(active)}>
                <Body style={{ color: active ? c.primaryForeground : c.foreground, fontSize: 14 }}>
                  {optionLabel(v, hi)}
                </Body>
              </Pressable>
            );
          })}
        </View>
      ) : f.field_type === "dropdown" ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          {(f.options ?? []).map((o) => {
            const active = values[f.field_key] === o;
            return (
              <Pressable key={o} onPress={() => setValue(f.field_key, o)} style={chip(active)}>
                <Body style={{ color: active ? c.primaryForeground : c.foreground, fontSize: 14 }}>
                  {optionLabel(o, hi)}
                </Body>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <TextInput
          value={values[f.field_key] ?? ""}
          onChangeText={(t) => setValue(f.field_key, t)}
          placeholder={fieldPlaceholder(f, hi)}
          placeholderTextColor={c.inkDim}
          keyboardType={f.field_type === "number" ? "number-pad" : "default"}
          multiline={f.field_type === "textarea"}
          style={[inputStyle, f.field_type === "textarea" ? { minHeight: 88, textAlignVertical: "top" } : null]}
        />
      )}
    </View>
  );

  if (phase === "loading") {
    return (
      <Screen>
        <Body muted>{hi ? "लोड हो रहा है…" : "Loading…"}</Body>
      </Screen>
    );
  }

  if (phase === "error") {
    return (
      <Screen>
        <Title>{hi ? "फ़ॉर्म लोड नहीं हो सका" : "Couldn't load the form"}</Title>
        <Body muted style={{ marginTop: 8 }}>
          {hi
            ? "अपना कनेक्शन जाँचें और पुनः प्रयास करें — पंजीकरण अभी भी खुला हो सकता है।"
            : "Check your connection and try again — registration may well still be open."}
        </Body>
        <Button
          label={hi ? "पुनः प्रयास करें" : "Try again"}
          style={{ marginTop: 16 }}
          onPress={() => void loadForm()}
        />
        <Button
          label={hi ? "मार्ग चुनें" : "Choose path"}
          variant="outline"
          style={{ marginTop: 10 }}
          onPress={() => router.replace("/join")}
        />
      </Screen>
    );
  }

  if (phase === "closed") {
    return (
      <Screen>
        <Title>{hi ? "पंजीकरण बंद है" : "Registration is closed"}</Title>
        <Body muted style={{ marginTop: 8 }}>
          {hi ? "कृपया बाद में पुनः प्रयास करें।" : "Please check back later."}
        </Body>
        <Button
          label={hi ? "मार्ग चुनें" : "Choose path"}
          variant="outline"
          style={{ marginTop: 16 }}
          onPress={() => router.replace("/join")}
        />
      </Screen>
    );
  }

  if (phase === "done" && code) {
    return (
      <Screen>
        <Title>{hi ? "पंजीकरण पूर्ण" : "Registration complete"}</Title>
        <Title style={{ marginTop: 12, fontFamily: fonts.mono, color: c.primary }}>{code}</Title>
        <Body muted style={{ marginTop: 8 }}>
          {hi ? "इस कोड को सुरक्षित रखें" : "Keep this code safe"}
        </Body>
        {/* No payment step: seva as a Guruji or Sanchalak carries no fee. */}
        <Button
          label={hi ? "होम" : "Done"}
          style={{ marginTop: 20 }}
          onPress={() => router.replace("/guest/home")}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <View style={{ flexDirection: "row", gap: 6, marginBottom: 12 }}>
        {STAFF_SECTIONS.map((s, i) => (
          <View
            key={s.id}
            style={{
              flex: 1,
              height: 6,
              borderRadius: 999,
              backgroundColor: i <= sectionIdx ? c.primary : c.muted,
            }}
          />
        ))}
      </View>
      <Body muted style={{ fontSize: 12, marginBottom: 8 }}>
        {hi
          ? `चरण ${sectionIdx + 1} / ${STAFF_SECTIONS.length}`
          : `Step ${sectionIdx + 1} of ${STAFF_SECTIONS.length}`}
      </Body>
      <Title style={{ fontSize: 20 }}>{hi ? section.title_hi : section.title_en}</Title>
      <Body muted style={{ marginTop: 4, marginBottom: 16 }}>
        {hi ? section.sub_hi : section.sub_en}
      </Body>

      <Card style={{ padding: 16 }}>
        {section.includeRole && kind === "shikshak" ? (
          <View style={{ marginBottom: 14 }}>
            <Body>{hi ? "भूमिका *" : "Role *"}</Body>
            <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
              {["गुरुजी", "दीदी"].map((r) => {
                const active = role === r;
                return (
                  <Pressable key={r} onPress={() => setRole(r)} style={chip(active)}>
                    <Body style={{ color: active ? c.primaryForeground : c.foreground, fontSize: 14 }}>
                      {r}
                    </Body>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {section.includeCentre ? (
          <View style={{ marginBottom: 14 }}>
            <Body>{hi ? "पाठशाला केंद्र *" : "Pathshala centre *"}</Body>
            <TextInput
              value={centreQuery}
              onChangeText={setCentreQuery}
              placeholder={hi ? "केंद्र खोजें…" : "Search centre…"}
              placeholderTextColor={c.inkDim}
              style={inputStyle}
            />
            {/* A bare View with maxHeight does not scroll: twelve rows painted
                straight over the fields below on iOS and were unreachable on
                Android. Same ScrollView pattern as CourseAdmin / HomeworkAdmin.
                Once a centre is picked the list collapses to that one row, so
                the default state of this step is a choice, not a wall. */}
            <ScrollView
              style={{ maxHeight: 180, marginTop: 8, overflow: "hidden" }}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
            >
              {visibleCentres.map((centre) => {
                const active = centreId === centre.id;
                return (
                  <Pressable
                    key={centre.id}
                    onPress={() => {
                      setCentreId(centre.id);
                      setCentreQuery(`${centre.name} (${centre.code})`);
                    }}
                    style={{
                      paddingVertical: 10,
                      paddingHorizontal: 12,
                      borderRadius: c.radius,
                      backgroundColor: active ? c.accent : "transparent",
                      marginBottom: 4,
                    }}
                  >
                    <Body style={{ color: active ? c.primary : c.foreground }}>
                      {centre.name} ({centre.code})
                    </Body>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        {sectionFields.map(renderField)}

        {section.includePhoto ? (
          <View style={{ marginBottom: 8 }}>
            <Body>
              {photo ? fieldLabel(photo, hi) : hi ? "फ़ोटो" : "Photo"}
              {photo?.is_required ? " *" : ""}
            </Body>
            <Button
              label={hi ? "फ़ोटो चुनें" : "Choose photo"}
              variant="outline"
              style={{ marginTop: 8 }}
              disabled={busy}
              onPress={() => void pickPhoto()}
            />
            {photoPreviewUri || photoUrl ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 12 }}>
                <Image
                  source={{ uri: photoPreviewUri ?? photoUrl! }}
                  style={{ width: 96, height: 96, borderRadius: 8 }}
                />
                <Body muted>
                  {photoUrl
                    ? hi
                      ? "अपलोड हो गया"
                      : "Uploaded"
                    : hi
                      ? "अपलोड हो रहा है…"
                      : "Uploading…"}
                </Body>
              </View>
            ) : null}
          </View>
        ) : null}
      </Card>

      {error ? <Body style={{ color: c.destructive, marginTop: 12 }}>{error}</Body> : null}

      <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
        {sectionIdx > 0 ? (
          <Button
            label={hi ? "पीछे" : "Back"}
            variant="outline"
            style={{ flex: 1 }}
            onPress={() => {
              setError(null);
              setSectionIdx((i) => i - 1);
            }}
          />
        ) : null}
        <Button
          label={
            busy
              ? hi
                ? "जमा हो रहा है…"
                : "Submitting…"
              : sectionIdx < STAFF_SECTIONS.length - 1
                ? hi
                  ? "आगे"
                  : "Next"
                : hi
                  ? "जमा करें"
                  : "Submit"
          }
          style={{ flex: 1 }}
          loading={busy}
          onPress={goNext}
        />
      </View>
    </Screen>
  );
}
