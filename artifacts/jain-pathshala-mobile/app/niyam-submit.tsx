import { useState } from "react";
import { Alert, TextInput, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { useNiyamCatalog, useSubmitNiyam } from "@/lib/queries";
import { ApiError } from "@/lib/api";
import { bodyFamily } from "@/constants/typography";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";
import type { NiyamCatalogRow } from "@/lib/types";

export default function NiyamSubmit() {
  const c = useColors();
  const { hi } = useLocale();
  const { activeStudentId, activeChild, loading, refetch } = useSessionView();

  const catalog = useNiyamCatalog(!!activeStudentId);
  const submit = useSubmitNiyam();

  const catalogRows = catalog.data?.items ?? [];

  const [selected, setSelected] = useState<NiyamCatalogRow | null>(null);
  const [proofUrl, setProofUrl] = useState("");
  const [notes, setNotes] = useState("");

  function resetForm() {
    setSelected(null);
    setProofUrl("");
    setNotes("");
  }

  function onSubmit() {
    if (!selected || !activeStudentId) return;
    const trimmedProof = proofUrl.trim();
    const trimmedNotes = notes.trim();
    submit.mutate(
      {
        studentId: activeStudentId,
        niyam_id: selected.id,
        student_id: activeStudentId,
        proof_url: trimmedProof ? trimmedProof : undefined,
        notes: trimmedNotes ? trimmedNotes : undefined,
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
        },
        onError: (err) => {
          const code = err instanceof ApiError ? err.code : "";
          const status = err instanceof ApiError ? err.statusCode : 0;
          let message: string;
          if (status === 409 || code === "ERR_DUPLICATE" || code === "ERR_CONFLICT") {
            message = hi
              ? "आप इस नियम को आज पहले ही प्रस्तुत कर चुके हैं।"
              : "You have already submitted this niyam for today.";
          } else if (status === 422 || code === "ERR_VALIDATION_FAILED") {
            message = hi
              ? "इस नियम के लिए प्रमाण लिंक आवश्यक है। कृपया एक वैध प्रमाण URL जोड़ें।"
              : "This niyam requires a proof link. Please add a valid proof URL.";
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
            <Body muted style={{ marginLeft: 2 }}>
              {activeChild.full_name}
            </Body>

            {/* --- Selected niyam form --- */}
            {selected ? (
              <Card>
                <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <Title style={{ fontSize: 17 }}>
                      {hi ? selected.title_hi : selected.title_en}
                    </Title>
                  </View>
                  <Pill label={`+${selected.points}`} tone="primary" />
                </Row>
                <Row style={{ marginTop: 8 }}>
                  <Pill label={selected.niyam_type} />
                </Row>

                <Body style={{ marginTop: 16, marginBottom: 6, fontSize: 13 }}>
                  {hi ? "प्रमाण लिंक (वैकल्पिक)" : "Proof URL (optional)"}
                </Body>
                <TextInput
                  value={proofUrl}
                  onChangeText={setProofUrl}
                  placeholder="https://"
                  placeholderTextColor={c.mutedForeground}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
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
                  }}
                />

                <Body style={{ marginTop: 14, marginBottom: 6, fontSize: 13 }}>
                  {hi ? "टिप्पणी (वैकल्पिक)" : "Notes (optional)"}
                </Body>
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
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
                    label={hi ? "प्रस्तुत करें" : "Submit"}
                    icon="checkmark"
                    onPress={onSubmit}
                    loading={submit.isPending}
                    style={{ flex: 1 }}
                  />
                </Row>
              </Card>
            ) : (
              <>
                <Title style={{ fontSize: 17, marginLeft: 2 }}>
                  {hi ? "एक नियम चुनें" : "Pick a niyam"}
                </Title>
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
                  catalogRows.map((row) => {
                    const title = hi ? row.title_hi : row.title_en;
                    const desc = hi ? row.description_hi : row.description_en;
                    return (
                      <Card key={row.id}>
                        <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                          <View style={{ flex: 1, paddingRight: 10 }}>
                            <Title style={{ fontSize: 16 }}>{title}</Title>
                          </View>
                          <Pill label={`+${row.points}`} tone="primary" />
                        </Row>
                        {desc ? (
                          <Body muted style={{ marginTop: 8 }}>
                            {desc}
                          </Body>
                        ) : null}
                        <Row style={{ marginTop: 12, justifyContent: "space-between", alignItems: "center" }}>
                          <Pill label={row.niyam_type} />
                          <Button
                            label={hi ? "चुनें" : "Select"}
                            variant="outline"
                            icon="chevron-forward"
                            onPress={() => setSelected(row)}
                          />
                        </Row>
                      </Card>
                    );
                  })
                )}
              </>
            )}
          </>
        )}
      </Screen>
    </View>
  );
}
