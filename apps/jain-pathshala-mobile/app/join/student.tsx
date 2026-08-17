import { useCallback, useEffect, useMemo, useState } from "react";
import { Image, Pressable, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { apiGet, apiPost } from "@/lib/api";
import { apiErrorMessage } from "@/lib/api-error-copy";
import { mergeById, usePickerSearch } from "@/lib/picker-search";
import { joinUpload, safeImageMime, safeImageUploadName } from "@/lib/join-upload";
import {
  STUDENT_SECTIONS,
  fieldLabel,
  fieldPlaceholder,
  fieldsForSection,
  optionLabel,
  photoField,
  type JoinField,
} from "@/lib/join";
import { fonts } from "@/constants/typography";
import { Body, Button, Card, Screen, Title } from "@/components/ui";

type City = { id: string; name: string; code: string; state_name?: string };
type Centre = { id: string; name: string; code: string | null; city_id: string };
// 'error' is distinct from 'closed': a dead network must never read as
// "registration has closed" (GST-API-01).
type Phase = "loading" | "error" | "closed" | "form" | "done";

export default function JoinStudentScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [sectionIdx, setSectionIdx] = useState(0);
  const [allFields, setAllFields] = useState<JoinField[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [centres, setCentres] = useState<Centre[]>([]);
  const [cityQuery, setCityQuery] = useState("");
  const [centreQuery, setCentreQuery] = useState("");
  const [cityId, setCityId] = useState("");
  const [centreId, setCentreId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoPreviewUri, setPhotoPreviewUri] = useState<string | null>(null);
  const [reg, setReg] = useState<{ id: string; display_code: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadForm = useCallback(async () => {
    setPhase("loading");
    try {
      const [s, f, citiesRes, centresRes] = await Promise.all([
        apiGet<{ registration_open: boolean }>("/v1/join/settings?kind=student"),
        apiGet<{ items: JoinField[] }>("/v1/join/form-fields?kind=student"),
        apiGet<{ items: City[] }>("/v1/public/cities"),
        apiGet<{ items: Centre[] }>("/v1/public/centres"),
      ]);
      setAllFields(f.items);
      setCities(citiesRes.items);
      setCentres(centresRes.items.filter((x) => !!x.code));
      // 'closed' only when the server actually says so — a load failure used to
      // masquerade as "registration is closed" (GST-API-01).
      setPhase(s.registration_open ? "form" : "closed");
    } catch {
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    void loadForm();
  }, [loadForm]);

  const photo = useMemo(() => photoField(allFields), [allFields]);
  const section = STUDENT_SECTIONS[sectionIdx]!;
  const sectionFields = useMemo(
    () => fieldsForSection(allFields, section),
    [allFields, section],
  );
  // Server-side ?q= merge — beyond the clamped first page a centre was
  // unpickable however the guest spelled it (GST-PRF-03).
  const cityQ = cityQuery.trim();
  const cityExtra = usePickerSearch<City>(
    cityQ.length >= 2 ? `/v1/public/cities?q=${encodeURIComponent(cityQ)}` : null,
  );
  const centreQ = centreQuery.trim();
  const centreExtra = usePickerSearch<Centre>(
    cityId && centreQ.length >= 2
      ? `/v1/public/centres?city_id=${encodeURIComponent(cityId)}&q=${encodeURIComponent(centreQ)}`
      : null,
  );

  const filteredCities = useMemo(() => {
    const q = cityQ.toLowerCase();
    const pool = mergeById(cities, cityExtra);
    if (!q) return pool;
    return pool.filter(
      (city) =>
        city.name.toLowerCase().includes(q) ||
        city.code.toLowerCase().includes(q) ||
        (city.state_name ?? "").toLowerCase().includes(q),
    );
  }, [cities, cityExtra, cityQ]);

  const centresInCity = useMemo(() => {
    if (!cityId) return [];
    const pool = mergeById(centres, centreExtra.filter((x) => !!x.code));
    return pool.filter((c) => c.city_id === cityId);
  }, [centres, centreExtra, cityId]);

  const filteredCentres = useMemo(() => {
    const q = centreQ.toLowerCase();
    if (!q) return centresInCity;
    return centresInCity.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.code ?? "").toLowerCase().includes(q),
    );
  }, [centresInCity, centreQ]);

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

  const pickImage = async () => {
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
    if (section.includeCity && !cityId) {
      return hi ? "शहर चुनें" : "Choose a city";
    }
    if (section.includeCentre && !centreId) {
      return hi ? "केंद्र चुनें" : "Choose a centre";
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
    if (sectionFields.some((f) => f.field_key === "parent_mobile")) {
      const parentMobile = values.parent_mobile ?? "";
      if (!/^\d{10}$/.test(parentMobile)) {
        return hi
          ? "अभिभावक का 10 अंकों का मोबाइल दर्ज करें"
          : "Enter a valid 10-digit parent mobile";
      }
    }
    if (sectionFields.some((f) => f.field_key === "mobile")) {
      const mobile = values.mobile ?? "";
      if (mobile && !/^\d{10}$/.test(mobile)) {
        return hi ? "10 अंकों का मोबाइल दर्ज करें" : "Enter a valid 10-digit mobile";
      }
    }
    if (sectionFields.some((f) => f.field_key === "age") && values.age) {
      const age = Number(values.age);
      if (!Number.isFinite(age) || age < 3 || age > 35) {
        return hi ? "आयु 3 से 35 के बीच होनी चाहिए" : "Age must be between 3 and 35";
      }
    }
    return null;
  };

  const submitForm = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await apiPost<{ id: string; display_code: string }>("/v1/join/registrations", {
        kind: "student",
        city_id: cityId,
        centre_id: centreId,
        name: values.name,
        parent_mobile: values.parent_mobile,
        mobile: values.mobile || null,
        email: values.email || null,
        father_name: values.father_name || null,
        age: values.age ? Number(values.age) : null,
        sex: values.sex || null,
        education: values.education || null,
        address: values.address || null,
        family_members: 1,
        will_attend: "yes",
        special_note: values.special_note || null,
        photo_url: photoUrl,
      });
      setReg(created);
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
    if (sectionIdx < STUDENT_SECTIONS.length - 1) {
      setSectionIdx((i) => i + 1);
      return;
    }
    void submitForm();
  };

  const renderField = (f: JoinField) => (
    <View key={f.id} style={{ marginBottom: 14 }}>
      <Body>
        {fieldLabel(f, hi)}
        {f.is_required ? " *" : ""}
      </Body>
      {f.field_type === "yesno" ? (
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

  if (phase === "done" && reg) {
    return (
      <Screen>
        <Title>{hi ? "अनुरोध भेज दिया गया" : "Request sent for approval"}</Title>
        <Body muted style={{ marginTop: 8 }}>
          {hi
            ? "आपका पंजीकरण स्वीकृति के लिए भेज दिया गया है। अनुमोदन के बाद अभिभावक मोबाइल से लॉगिन कर सकते हैं।"
            : "Your registration has been sent for approval. After approval, the parent can log in with the parent mobile."}
        </Body>
        <Title style={{ marginTop: 16, fontFamily: fonts.mono, color: c.primary }}>
          {reg.display_code}
        </Title>
        <Body muted style={{ marginTop: 8 }}>
          {hi ? "इस कोड को सुरक्षित रखें" : "Keep this code safe"}
        </Body>
        {/* Carry the code + mobile the family just typed (GST-API-02) — and
            push, not replace, so the code screen stays reachable. */}
        <Button
          label={hi ? "शुल्क भुगतान करें" : "Complete payment"}
          style={{ marginTop: 20 }}
          onPress={() =>
            router.push({
              pathname: "/join/complete-payment",
              params: {
                kind: "student",
                code: reg.display_code,
                mobile: values.parent_mobile ?? "",
              },
            })
          }
        />
        <Button
          label={hi ? "होम" : "Done"}
          variant="outline"
          style={{ marginTop: 10 }}
          onPress={() => router.replace("/guest/home")}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <View style={{ flexDirection: "row", gap: 6, marginBottom: 12 }}>
        {STUDENT_SECTIONS.map((s, i) => (
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
          ? `चरण ${sectionIdx + 1} / ${STUDENT_SECTIONS.length}`
          : `Step ${sectionIdx + 1} of ${STUDENT_SECTIONS.length}`}
      </Body>
      <Title style={{ fontSize: 20 }}>{hi ? section.title_hi : section.title_en}</Title>
      <Body muted style={{ marginTop: 4, marginBottom: 16 }}>
        {hi ? section.sub_hi : section.sub_en}
      </Body>

      <Card style={{ padding: 16 }}>
        {section.includeCity ? (
          <View style={{ marginBottom: 14 }}>
            <Body>{hi ? "शहर *" : "City *"}</Body>
            <TextInput
              value={cityQuery}
              onChangeText={setCityQuery}
              placeholder={hi ? "शहर खोजें…" : "Search city…"}
              placeholderTextColor={c.inkDim}
              style={inputStyle}
            />
            <View style={{ maxHeight: 180, marginTop: 8 }}>
              {filteredCities.slice(0, 12).map((city) => {
                const active = cityId === city.id;
                return (
                  <Pressable
                    key={city.id}
                    onPress={() => {
                      setCityId(city.id);
                      setCityQuery(city.name);
                      setCentreId("");
                      setCentreQuery("");
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
                      {city.name} ({city.code})
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
              editable={!!cityId}
              placeholder={
                !cityId
                  ? hi
                    ? "पहले शहर चुनें"
                    : "Choose a city first"
                  : hi
                    ? "केंद्र खोजें…"
                    : "Search centre…"
              }
              placeholderTextColor={c.inkDim}
              style={inputStyle}
            />
            <View style={{ maxHeight: 180, marginTop: 8 }}>
              {filteredCentres.slice(0, 12).map((centre) => {
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
            </View>
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
              onPress={() => void pickImage()}
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
              : sectionIdx < STUDENT_SECTIONS.length - 1
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
