import { useEffect, useState } from "react";
import { Alert, TextInput, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { useNiyamCatalog, useSubmitNiyam } from "@/lib/queries";
import { ApiError } from "@/lib/api";
import { bodyFamily } from "@/constants/typography";
import { ChildSwitcher } from "@/components/ChildSwitcher";
import { NiyamListRow } from "@/components/NiyamListRow";
import {
  NiyamProofPicker,
  mediaReady,
  toSubmitMedia,
  type ProofMediaItem,
} from "@/components/NiyamProofPicker";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";
import type { NiyamCatalogRow } from "@/lib/types";

function periodDupMessage(niyamType: string, hi: boolean): string {
  if (niyamType === "weekly") {
    return hi
      ? "आप इस नियम को इस सप्ताह पहले ही प्रस्तुत कर चुके हैं।"
      : "You have already submitted this niyam for this week.";
  }
  if (niyamType === "monthly") {
    return hi
      ? "आप इस नियम को इस माह पहले ही प्रस्तुत कर चुके हैं।"
      : "You have already submitted this niyam for this month.";
  }
  return hi
    ? "आप इस नियम को आज पहले ही प्रस्तुत कर चुके हैं।"
    : "You have already submitted this niyam for today.";
}

export default function NiyamSubmit() {
  const c = useColors();
  const { hi } = useLocale();
  const { activeStudentId, activeChild, loading, refetch } = useSessionView();

  const catalog = useNiyamCatalog(!!activeStudentId, activeStudentId);
  const submit = useSubmitNiyam();

  const catalogRows = catalog.data?.items ?? [];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [media, setMedia] = useState<ProofMediaItem[]>([]);
  const [notes, setNotes] = useState("");

  // Per-child period status — never reuse another child's selection / form.
  useEffect(() => {
    setSelectedId(null);
    setMedia([]);
    setNotes("");
  }, [activeStudentId]);

  function resetForm() {
    setSelectedId(null);
    setMedia([]);
    setNotes("");
  }

  const selected: NiyamCatalogRow | null = selectedId
    ? (catalogRows.find((r) => r.id === selectedId) ?? null)
    : null;

  function onSubmit() {
    if (!selected || !activeStudentId) return;
    if (selected.submitted_this_period) return;

    const proofRequired = !!selected.proof_required;
    const maxUploads = selected.max_uploads ?? 3;
    const readyMedia = toSubmitMedia(media);

    if (proofRequired && readyMedia.length === 0) {
      Alert.alert(
        hi ? "प्रमाण आवश्यक" : "Proof required",
        hi ? "कृपया कम से कम एक प्रमाण मीडिया जोड़ें।" : "Please add at least one proof media file.",
      );
      return;
    }
    if (!mediaReady(media)) {
      Alert.alert(
        hi ? "अपलोड जारी" : "Uploads in progress",
        hi
          ? "सभी फाइलें अपलोड होने तक प्रतीक्षा करें।"
          : "Wait until all files finish uploading.",
      );
      return;
    }

    submit.mutate(
      {
        studentId: activeStudentId,
        niyam_id: selected.id,
        student_id: activeStudentId,
        media: readyMedia.length ? readyMedia : undefined,
        notes: notes.trim() ? notes.trim() : undefined,
      },
      {
        onSuccess: (res) => {
          const approved = res.status === "auto_approved" || res.status === "approved";
          Alert.alert(
            approved
              ? hi
                ? "स्वीकृत"
                : "Approved"
              : hi
                ? "प्रस्तुत किया गया"
                : "Submitted",
            approved
              ? hi
                ? "आपका नियम स्वतः स्वीकृत हो गया है।"
                : "Your niyam was auto-approved."
              : hi
                ? "आपका नियम समीक्षा के लिए भेज दिया गया है।"
                : "Your niyam was submitted for review.",
          );
          resetForm();
          catalog.refetch();
        },
        onError: (err) => {
          const code = err instanceof ApiError ? err.code : "";
          const status = err instanceof ApiError ? err.statusCode : 0;
          let message: string;
          if (
            status === 409 ||
            code === "ERR_NIYAM_PERIOD_DUPLICATE" ||
            code === "ERR_DUPLICATE" ||
            code === "ERR_CONFLICT"
          ) {
            message = periodDupMessage(selected.niyam_type, hi);
          } else if (status === 422 || code === "ERR_VALIDATION_FAILED") {
            message =
              err instanceof ApiError
                ? err.message
                : hi
                  ? "प्रमाण अमान्य है। कृपया पुनः प्रयास करें।"
                  : "Proof is invalid. Please try again.";
          } else {
            message =
              err instanceof ApiError
                ? err.message
                : hi
                  ? "नियम प्रस्तुत नहीं किया जा सका।"
                  : "Could not submit your niyam.";
          }
          Alert.alert(hi ? "प्रस्तुत नहीं हुआ" : "Submission failed", message);
        },
      },
    );
  }

  const selectedDesc = selected
    ? hi
      ? selected.description_hi
      : selected.description_en
    : null;
  const uploadsBusy = !mediaReady(media);
  const alreadySubmitted = !!selected?.submitted_this_period;

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Screen
        refreshing={catalog.isRefetching}
        onRefresh={() => {
          refetch();
          catalog.refetch();
        }}
      >
        {loading ? (
          <StateView status="loading" emptyText="" />
        ) : !activeStudentId || !activeChild ? (
          <StateView
            status="empty"
            emptyText={
              hi
                ? "आपकी विद्यार्थी प्रोफ़ाइल अभी तैयार नहीं है।"
                : "Your student profile isn't ready yet."
            }
          />
        ) : (
          <>
            <ChildSwitcher />

            {selectedId && !selected && catalog.isFetching ? (
              <StateView status="loading" emptyText="" />
            ) : selected ? (
              <Card>
                <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <Title style={{ fontSize: 17 }}>
                      {hi ? selected.title_hi : selected.title_en}
                    </Title>
                  </View>
                  <Pill label={`+${selected.points}`} tone="primary" />
                </Row>
                <Row style={{ marginTop: 8, gap: 6, flexWrap: "wrap" }}>
                  <Pill label={selected.niyam_type} />
                  {(hi ? selected.period_label_hi : selected.period_label_en) ? (
                    <Pill label={(hi ? selected.period_label_hi : selected.period_label_en) ?? ""} />
                  ) : null}
                  {alreadySubmitted ? (
                    <Pill
                      label={
                        (hi ? selected.period_status_tag_hi : selected.period_status_tag_en) ??
                        (hi ? "प्रस्तुत" : "Submitted")
                      }
                      tone="primary"
                    />
                  ) : null}
                </Row>
                {selectedDesc ? (
                  <Body muted style={{ marginTop: 12 }}>
                    {selectedDesc}
                  </Body>
                ) : null}

                {(selected.max_uploads ?? 3) > 0 ? (
                  <NiyamProofPicker
                    proofType={selected.proof_type}
                    proofRequired={!!selected.proof_required}
                    maxUploads={selected.max_uploads ?? 3}
                    value={media}
                    onChange={setMedia}
                    disabled={alreadySubmitted}
                  />
                ) : null}

                <Body style={{ marginTop: 14, marginBottom: 6, fontSize: 13 }}>
                  {hi ? "टिप्पणी (वैकल्पिक)" : "Notes (optional)"}
                </Body>
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  editable={!alreadySubmitted}
                  placeholder={hi ? "कुछ लिखें…" : "Add a note…"}
                  placeholderTextColor={c.mutedForeground}
                  multiline
                  numberOfLines={3}
                  style={{
                    fontFamily: bodyFamily(hi),
                    fontSize: 15,
                    color: c.foreground,
                    backgroundColor: c.background,
                    borderWidth: 1,
                    borderColor: c.border,
                    borderRadius: c.radius,
                    paddingHorizontal: 12,
                    paddingVertical: 11,
                    minHeight: 76,
                    textAlignVertical: "top",
                  }}
                />

                <Row style={{ marginTop: 16, gap: 10 }}>
                  <Button
                    label={hi ? "रद्द करें" : "Cancel"}
                    variant="outline"
                    onPress={resetForm}
                    style={{ flex: 1 }}
                  />
                  <Button
                    label={
                      alreadySubmitted
                        ? hi
                          ? "पहले से प्रस्तुत"
                          : "Already submitted"
                        : hi
                          ? "प्रस्तुत करें"
                          : "Submit"
                    }
                    icon="checkmark"
                    onPress={onSubmit}
                    loading={submit.isPending}
                    disabled={alreadySubmitted || uploadsBusy || submit.isPending}
                    style={{ flex: 1 }}
                  />
                </Row>
              </Card>
            ) : (
              <>
                <Body style={{ fontSize: 13, fontWeight: "700", marginBottom: 8, marginLeft: 2, color: c.mutedForeground }}>
                  {hi ? "एक नियम चुनें" : "Pick a niyam"}
                </Body>
                {catalog.isLoading ? (
                  <StateView status="loading" emptyText="" />
                ) : catalog.isError ? (
                  <StateView
                    status="error"
                    emptyText=""
                    errorText={hi ? "नियम सूची लोड नहीं हुई।" : "Could not load the niyam catalog."}
                    onRetry={catalog.refetch}
                    retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
                  />
                ) : catalogRows.length === 0 ? (
                  <StateView
                    status="empty"
                    emptyText={hi ? "अभी कोई नियम उपलब्ध नहीं है।" : "No niyams available yet."}
                  />
                ) : (
                  <View style={{ gap: 8 }}>
                    {catalogRows.map((row) => {
                      const title = hi ? row.title_hi : row.title_en;
                      const submitted = !!row.submitted_this_period;
                      const tag = hi ? row.period_status_tag_hi : row.period_status_tag_en;
                      const period = hi ? row.period_label_hi : row.period_label_en;
                      const meta = [row.niyam_type, period, submitted ? tag : null]
                        .filter(Boolean)
                        .join(" · ");
                      return (
                        <NiyamListRow
                          key={row.id}
                          title={title}
                          meta={meta}
                          points={row.points}
                          niyamType={row.niyam_type}
                          emphasizedMeta={submitted}
                          onPress={() => {
                            setSelectedId(row.id);
                            setMedia([]);
                            setNotes("");
                          }}
                        />
                      );
                    })}
                  </View>
                )}
              </>
            )}
          </>
        )}
      </Screen>
    </View>
  );
}
