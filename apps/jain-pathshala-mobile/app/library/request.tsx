/**
 * Library content request form — Section 17 v3 §17.10.
 *
 * One form, three entry points (library home, a section detail, the empty
 * search state). The caller prefills through route params rather than through
 * three near-identical screens.
 *
 * Open to guests: there is no sign-in gate and no `requires_login` check here
 * by design (Q13). A signed-out visitor gets the same form, and supplies the
 * name and phone a member's profile already carries.
 */
import { useMemo, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { t, type Locale } from "@workspace/i18n";
import type { LibrarySectionDto } from "@workspace/api-zod";

import { useColors } from "@/hooks/useColors";
import { useIsOnline } from "@/hooks/useIsOnline";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/contexts/AuthContext";
import { apiGet, ApiError } from "@/lib/api";
import { bodyFamily } from "@/constants/typography";
import { pickLocalized, type LibraryTreePayload } from "@/lib/library/helpers";
import {
  OTHER_SECTION as OTHER,
  submitLibraryRequest,
  validateLibraryRequest,
} from "@/lib/library/requests";
import { Body, Button, Card, Row, Title } from "@/components/ui";

function tr(locale: Locale, key: string, vars?: Record<string, string>): string {
  return t(`libraryRequests.${key}`, locale, vars);
}

export default function LibraryRequestScreen() {
  const c = useColors();
  const { locale } = useLocale();
  const hi = locale === "hi";
  const { user } = useAuth();
  const online = useIsOnline();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ sectionId?: string; title?: string }>();

  const [sectionChoice, setSectionChoice] = useState<string | null>(params.sectionId ?? null);
  const [suggestedSection, setSuggestedSection] = useState("");
  const [title, setTitle] = useState(params.title ?? "");
  const [details, setDetails] = useState("");
  const [referenceUrl, setReferenceUrl] = useState("");
  const [name, setName] = useState(user?.full_name ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const authed = !!user;

  // The picker lists published sections only — the same tree the reader just
  // browsed, so a section they cannot see is never offered.
  const { data: tree } = useQuery({
    queryKey: ["library", authed ? "member" : "public"],
    queryFn: () =>
      authed
        ? apiGet<LibraryTreePayload>("/v1/library")
        : apiGet<LibraryTreePayload>("/v1/public/library"),
  });
  const sections = useMemo(
    () => (tree?.sections ?? []).filter((s: LibrarySectionDto) => s.type !== "deeplink"),
    [tree],
  );

  const create = useMutation({
    mutationFn: submitLibraryRequest,
    onSuccess: () => {
      setSent(true);
      void qc.invalidateQueries({ queryKey: ["library-requests"] });
    },
    onError: (err: unknown) => setSubmitError(submitErrorCopy(err, locale)),
  });

  const inputStyle = {
    fontFamily: bodyFamily(hi),
    fontSize: 15,
    lineHeight: 22,
    color: c.foreground,
    backgroundColor: c.background,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: c.radius,
    paddingHorizontal: 12,
    paddingVertical: 11,
  } as const;

  function submit() {
    const key = validateLibraryRequest({
      sectionChoice,
      suggestedSection,
      title,
      details,
      referenceUrl,
      name,
      phone,
    });
    const problem = key ? tr(locale, key) : null;
    setFieldError(problem);
    setSubmitError(null);
    if (problem) return;
    const other = sectionChoice === OTHER;
    create.mutate({
      section_id: other ? null : sectionChoice,
      suggested_section: other ? suggestedSection.trim() : null,
      title: title.trim(),
      details: details.trim(),
      reference_url: referenceUrl.trim() || null,
      requester_name: name.trim(),
      requester_phone: phone.trim(),
    });
  }

  /* Offline: an explanatory state, never a dead submit button (§17.4). */
  if (!online) {
    return (
      <ScrollView contentContainerStyle={{ padding: 16 }} style={{ backgroundColor: c.background }}>
        <Card>
          <Row style={{ gap: 10, alignItems: "flex-start" }}>
            <Ionicons name="cloud-offline-outline" size={22} color={c.mutedForeground} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Title style={{ fontSize: 17 }}>{tr(locale, "offlineTitle")}</Title>
              <Body muted style={{ marginTop: 6 }}>
                {tr(locale, "offlineBody")}
              </Body>
            </View>
          </Row>
          <View style={{ marginTop: 16 }}>
            <Button label={tr(locale, "cancel")} variant="outline" onPress={() => router.back()} />
          </View>
        </Card>
      </ScrollView>
    );
  }

  if (sent) {
    return (
      <ScrollView contentContainerStyle={{ padding: 16 }} style={{ backgroundColor: c.background }}>
        <Card>
          <Row style={{ gap: 10, alignItems: "flex-start" }}>
            <Ionicons name="checkmark-circle-outline" size={22} color={c.primary} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Title style={{ fontSize: 17 }}>{tr(locale, "successTitle")}</Title>
              <Body muted style={{ marginTop: 6 }}>
                {tr(locale, "successBody")}
              </Body>
            </View>
          </Row>
          <Row style={{ marginTop: 16, gap: 10 }}>
            <Button
              label={tr(locale, "cancel")}
              variant="outline"
              onPress={() => router.back()}
              style={{ flex: 1 }}
            />
            <Button
              label={tr(locale, "viewMine")}
              icon="list-outline"
              onPress={() => router.replace("/library/my-requests")}
              style={{ flex: 1 }}
            />
          </Row>
        </Card>
      </ScrollView>
    );
  }

  const problem = fieldError ?? submitError;

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
      style={{ backgroundColor: c.background }}
      keyboardShouldPersistTaps="handled"
    >
      <Card>
        <Title style={{ fontSize: 18 }}>{tr(locale, "formTitle")}</Title>
        <Body muted style={{ marginTop: 4 }}>
          {tr(locale, "formIntro")}
        </Body>

        <Body style={{ marginTop: 16, marginBottom: 6, fontSize: 13 }}>
          {tr(locale, "sectionLabel")}
        </Body>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {sections.map((s: LibrarySectionDto) => {
            const active = sectionChoice === s.id;
            return (
              <Pressable
                key={s.id}
                onPress={() => setSectionChoice(active ? null : s.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: c.radius,
                  borderWidth: 1,
                  borderColor: active ? c.primary : c.border,
                  backgroundColor: active ? c.primary : "transparent",
                }}
              >
                <Body style={{ fontSize: 13, color: active ? c.primaryForeground : c.foreground }}>
                  {pickLocalized(hi, s.name_en, s.name_hi, s.name_gu)}
                </Body>
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => setSectionChoice(sectionChoice === OTHER ? null : OTHER)}
            accessibilityRole="button"
            accessibilityState={{ selected: sectionChoice === OTHER }}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: c.radius,
              borderWidth: 1,
              borderStyle: "dashed",
              borderColor: sectionChoice === OTHER ? c.primary : c.border,
              backgroundColor: sectionChoice === OTHER ? c.primary : "transparent",
            }}
          >
            <Body
              style={{
                fontSize: 13,
                color: sectionChoice === OTHER ? c.primaryForeground : c.foreground,
              }}
            >
              {tr(locale, "sectionOther")}
            </Body>
          </Pressable>
        </View>

        {sectionChoice === OTHER ? (
          <>
            <Body style={{ marginTop: 14, marginBottom: 6, fontSize: 13 }}>
              {tr(locale, "suggestedSectionLabel")}
            </Body>
            <TextInput
              value={suggestedSection}
              onChangeText={setSuggestedSection}
              placeholder={tr(locale, "suggestedSectionPlaceholder")}
              placeholderTextColor={c.mutedForeground}
              maxLength={200}
              style={inputStyle}
            />
          </>
        ) : null}

        <Body style={{ marginTop: 16, marginBottom: 6, fontSize: 13 }}>
          {tr(locale, "titleLabel")}
        </Body>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder={tr(locale, "titlePlaceholder")}
          placeholderTextColor={c.mutedForeground}
          maxLength={200}
          style={inputStyle}
        />

        <Body style={{ marginTop: 14, marginBottom: 6, fontSize: 13 }}>
          {tr(locale, "detailsLabel")}
        </Body>
        <TextInput
          value={details}
          onChangeText={setDetails}
          placeholder={tr(locale, "detailsPlaceholder")}
          placeholderTextColor={c.mutedForeground}
          multiline
          numberOfLines={4}
          maxLength={2000}
          style={{ ...inputStyle, minHeight: 108, textAlignVertical: "top" }}
        />
        <Body muted style={{ marginTop: 6, fontSize: 12 }}>
          {tr(locale, "detailsHint")}
        </Body>

        <Body style={{ marginTop: 14, marginBottom: 6, fontSize: 13 }}>
          {tr(locale, "referenceLabel")}
        </Body>
        <TextInput
          value={referenceUrl}
          onChangeText={setReferenceUrl}
          placeholder={tr(locale, "referencePlaceholder")}
          placeholderTextColor={c.mutedForeground}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          maxLength={500}
          style={inputStyle}
        />
        <Body muted style={{ marginTop: 6, fontSize: 12 }}>
          {tr(locale, "referenceHint")}
        </Body>

        <Body style={{ marginTop: 16, marginBottom: 6, fontSize: 13 }}>
          {tr(locale, "nameLabel")}
        </Body>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder={tr(locale, "namePlaceholder")}
          placeholderTextColor={c.mutedForeground}
          maxLength={200}
          style={inputStyle}
        />

        <Body style={{ marginTop: 14, marginBottom: 6, fontSize: 13 }}>
          {tr(locale, "phoneLabel")}
        </Body>
        <TextInput
          value={phone}
          onChangeText={setPhone}
          placeholder={tr(locale, "phonePlaceholder")}
          placeholderTextColor={c.mutedForeground}
          keyboardType="phone-pad"
          maxLength={20}
          style={inputStyle}
        />
        <Body muted style={{ marginTop: 6, fontSize: 12 }}>
          {tr(locale, "contactHint")}
        </Body>

        {problem ? (
          <View
            style={{
              marginTop: 16,
              padding: 12,
              borderRadius: c.radius,
              borderWidth: 1,
              borderColor: c.destructive,
              backgroundColor: c.muted,
            }}
          >
            <Body style={{ fontSize: 13, color: c.destructive }}>{problem}</Body>
          </View>
        ) : null}

        <Row style={{ marginTop: 16, gap: 10 }}>
          <Button
            label={tr(locale, "cancel")}
            variant="outline"
            onPress={() => router.back()}
            disabled={create.isPending}
            style={{ flex: 1 }}
          />
          <Button
            label={create.isPending ? tr(locale, "submitting") : tr(locale, "submit")}
            icon="paper-plane-outline"
            onPress={submit}
            loading={create.isPending}
            style={{ flex: 1 }}
          />
        </Row>
      </Card>
    </ScrollView>
  );
}

/**
 * Server errors the reader can act on. The 429 and 409 caps are ordinary
 * outcomes of using the form, not faults — they get copy that says what
 * happened and what to do, never a raw code.
 */
function submitErrorCopy(err: unknown, locale: Locale): string {
  if (err instanceof ApiError) {
    if (err.code === "ERR_LIBRARY_REQUEST_RATE_LIMITED") return tr(locale, "errRateLimited");
    if (err.code === "ERR_LIBRARY_REQUEST_PENDING_LIMIT") return tr(locale, "errPendingLimit");
    if (err.code === "ERR_NOT_FOUND") return tr(locale, "errSectionGone");
  }
  return tr(locale, "errGeneric");
}
