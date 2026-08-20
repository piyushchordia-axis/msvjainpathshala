import { useEffect, useState } from "react";
import { Alert, Pressable, TextInput, View } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useColors, withAlpha } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { useNiyamCatalog, useSubmitNiyam } from "@/lib/queries";
import { ApiError } from "@/lib/api";
import { apiErrorMessage } from "@/lib/api-error-copy";
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
import { NiyamBadgeRow } from "@/components/NiyamBadgeRow";
import { badgeLabel, moreToNextBadge } from "@/lib/niyam-badges";
import { useCelebration } from "@/hooks/useCelebration";
import type { NiyamCatalogRow } from "@/lib/types";

const ALERT_AFTER_CELEBRATE_MS = 400;

/** Mirrors createSubmissionSchema's `notes: z.string().max(500)` on the API. */
const NOTES_MAX = 500;

/** Yesterday's IST calendar date — the only backdate the API accepts. */
function yesterdayIst(): string {
  const todayIst = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const d = new Date(`${todayIst}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function niyamsTabHref(role: string | undefined): "/student/niyams" | "/parent/niyams" {
  return role === "parent" ? "/parent/niyams" : "/student/niyams";
}

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
  const router = useRouter();
  const { user } = useAuth();
  const { activeStudentId, activeChild, loading, refetch } = useSessionView();

  const catalog = useNiyamCatalog(!!activeStudentId, activeStudentId);
  const submit = useSubmitNiyam();
  const { fire: celebrate, Celebration } = useCelebration();

  const catalogRows = catalog.data?.items ?? [];

  // Preselect the niyam the child tapped in the catalog (M10). Falls back to
  // the picker when the screen is opened from the generic "Submit Niyam" button.
  const { niyam_id: niyamIdParam } = useLocalSearchParams<{ niyam_id?: string }>();
  const initialSelectedId = typeof niyamIdParam === "string" ? niyamIdParam : null;

  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [media, setMedia] = useState<ProofMediaItem[]>([]);
  const [notes, setNotes] = useState("");
  /**
   * H6 — the API has always accepted `submission_date` and allowed one day of
   * backdating, but no client ever sent it, so the documented late-evening
   * catch-up across midnight was unreachable and a niyam kept yesterday was
   * simply lost.
   */
  const [forYesterday, setForYesterday] = useState(false);

  // Per-child period status — never reuse another child's selection / form.
  // The deep-linked niyam is dropped too: it was chosen for the previous child.
  useEffect(() => {
    setSelectedId(null);
    setMedia([]);
    setNotes("");
    setForYesterday(false);
  }, [activeStudentId]);

  function resetForm() {
    setSelectedId(null);
    setMedia([]);
    setNotes("");
    setForYesterday(false);
  }

  /**
   * Cancel discards proof the parent has already uploaded, and nothing reaps
   * the orphaned objects (media.cleanup_unfinalized is a tick stub). Confirm
   * first when there is something to lose — every other decisive action in this
   * module confirms.
   */
  function onCancel() {
    if (media.length === 0) {
      resetForm();
      return;
    }
    Alert.alert(
      hi ? "प्रमाण हटाएँ?" : "Discard proof?",
      hi
        ? "आपने जो फ़ाइलें जोड़ी हैं वे हट जाएँगी। फिर से जोड़नी होंगी।"
        : "The files you added will be removed. You would need to attach them again.",
      [
        { text: hi ? "रहने दें" : "Keep editing", style: "cancel" },
        {
          text: hi ? "हटाएँ" : "Discard",
          style: "destructive",
          onPress: resetForm,
        },
      ],
    );
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
        submission_date: forYesterday ? yesterdayIst() : undefined,
      },
      {
        onSuccess: (res) => {
          const approved = res.status === "auto_approved" || res.status === "approved";
          const badges = res.new_badges ?? [];

          // A queued op has not reached the server — do not claim it was
          // accepted, and do not celebrate points that may never be awarded.
          if (res.queued) {
            const terminal = res.sync_state === "conflict" || res.sync_state === "failed";
            Alert.alert(
              terminal
                ? hi
                  ? "प्रस्तुत नहीं हो सका"
                  : "Could not submit"
                : hi
                  ? "ऑफ़लाइन सहेजा गया"
                  : "Saved offline",
              terminal
                ? (res.sync_error?.message ??
                  (hi
                    ? "यह नियम प्रस्तुत नहीं हो सका। कृपया फिर से प्रयास करें।"
                    : "This niyam could not be submitted — please try again."))
                : hi
                  ? "नेटवर्क आने पर यह अपने आप भेज दिया जाएगा।"
                  : "It will sync automatically when you are back online.",
            );
            resetForm();
            catalog.refetch();
            return;
          }

          celebrate({
            message: badges.length > 0
              ? hi
                ? "बैज मिला!"
                : "Badge earned!"
              : hi
                ? "बहुत अच्छा"
                : "Well done",
          });
          const showAlert = () => {
            if (badges.length > 0) {
              const names = badges.map((b) => badgeLabel(b.badge_key, hi)).join(", ");
              Alert.alert(
                hi ? "बैज मिला!" : "Badge earned!",
                hi
                  ? `बधाई हो — आपने अर्जित किया: ${names}`
                  : `Congratulations — you earned: ${names}`,
              );
            } else {
              const points = res.points_awarded ?? 0;
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
                    ? `आपका नियम स्वतः स्वीकृत हो गया है। +${points} पुण्य`
                    : `Your niyam was auto-approved. +${points} Punya`
                  : hi
                    ? "आपका नियम समीक्षा के लिए भेज दिया गया है।"
                    : "Your niyam was submitted for review.",
              );
            }
          };
          setTimeout(showAlert, ALERT_AFTER_CELEBRATE_MS);
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
          } else {
            // Shared bilingual mapping: the old code fell back to err.message,
            // which is English-only, so a Hindi parent saw an English sentence.
            message = apiErrorMessage(err, hi, {
              ERR_VALIDATION_FAILED: {
                en: "That proof couldn't be accepted — check the photo or video and try again.",
                hi: "यह प्रमाण स्वीकार नहीं हुआ — फ़ोटो या वीडियो जाँचकर पुनः प्रयास करें।",
              },
            });
          }
          Alert.alert(hi ? "प्रस्तुत नहीं हुआ" : "Submission failed", message);
        },
      },
    );
  }

  const selectedDesc = selected
    ? hi
      ? selected.description_hi ?? selected.description_en
      : selected.description_en
    : null;
  const uploadsBusy = !mediaReady(media);
  const alreadySubmitted = !!selected?.submitted_this_period;

  return (
    <ActivityThemed accent="niyam">
      {Celebration}
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

            <Row style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <Title style={{ fontSize: 17 }}>{hi ? "नियम प्रस्तुत करें" : "Submit Niyam"}</Title>
              <Button
                label={hi ? "प्रस्तुत नियम देखें" : "View submitted Niyams"}
                icon="list-outline"
                variant="outline"
                onPress={() => router.push(niyamsTabHref(user?.role))}
              />
            </Row>

            {selectedId && !selected && catalog.isFetching ? (
              <StateView status="loading" emptyText="" />
            ) : selected ? (
              <Card>
                <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <Title style={{ fontSize: 17 }}>
                      {hi ? selected.title_hi ?? selected.title_en : selected.title_en}
                    </Title>
                  </View>
                  {/* Resolved award, not the authored points: a punya_configs
                      override re-prices niyams and this pill promised the old
                      number (H11). Review-mode qualifies it rather than
                      implying the child already has the Punya. */}
                  <Pill
                    label={`+${selected.award_points ?? selected.points}${
                      selected.awards_on_approval ? (hi ? " स्वीकृति पर" : " on approval") : ""
                    }`}
                    tone="primary"
                  />
                </Row>
                <Row style={{ marginTop: 8, gap: 6, flexWrap: "wrap" }}>
                  <Pill label={selected.niyam_type} />
                  {(hi ? selected.period_label_hi ?? selected.period_label_en : selected.period_label_en) ? (
                    <Pill label={(hi ? selected.period_label_hi ?? selected.period_label_en : selected.period_label_en) ?? ""} />
                  ) : null}
                  {alreadySubmitted ? (
                    <Pill
                      label={
                        (hi ? selected.period_status_tag_hi ?? selected.period_status_tag_en : selected.period_status_tag_en) ??
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

                {/* Daily niyams only: a weekly/monthly period_key would be the
                    same either way, so the toggle would do nothing visible. */}
                {selected.niyam_type === "daily" && !alreadySubmitted ? (
                  <Pressable
                    onPress={() => setForYesterday((v) => !v)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: forYesterday }}
                    accessibilityLabel={hi ? "कल के लिए" : "For yesterday"}
                    style={{
                      marginTop: 14,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                      paddingVertical: 10,
                      paddingHorizontal: 12,
                      borderWidth: 1,
                      borderColor: forYesterday ? c.primary : c.border,
                      backgroundColor: forYesterday ? withAlpha(c.primary, 0.07) : c.background,
                      borderRadius: c.radius,
                    }}
                  >
                    <View
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 4,
                        borderWidth: 2,
                        borderColor: forYesterday ? c.primary : c.border,
                        backgroundColor: forYesterday ? c.primary : "transparent",
                      }}
                    />
                    <Body style={{ fontSize: 13, flex: 1 }}>
                      {hi
                        ? "यह नियम कल का है"
                        : "This was kept yesterday"}
                    </Body>
                  </Pressable>
                ) : null}

                <Row style={{ marginTop: 14, marginBottom: 6, justifyContent: "space-between" }}>
                  <Body style={{ fontSize: 13 }}>
                    {hi ? "टिप्पणी (वैकल्पिक)" : "Notes (optional)"}
                  </Body>
                  {notes.length > NOTES_MAX - 100 ? (
                    <Body style={{ fontSize: 12, color: c.mutedForeground }}>
                      {notes.length}/{NOTES_MAX}
                    </Body>
                  ) : null}
                </Row>
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  editable={!alreadySubmitted}
                  placeholder={hi ? "कुछ लिखें…" : "Add a note…"}
                  placeholderTextColor={c.mutedForeground}
                  multiline
                  numberOfLines={3}
                  // Server caps notes at 500 (createSubmissionSchema). Without
                  // this the parent typed past it and got the generic
                  // "Invalid submission data." after the upload had completed.
                  maxLength={NOTES_MAX}
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

                <NiyamBadgeRow
                  niyamType={selected.niyam_type}
                  earnedBadges={selected.earned_badges}
                  hi={hi}
                />

                {(() => {
                  const streak = selected.current_streak ?? 0;
                  const next = moreToNextBadge(selected.niyam_type, streak);
                  const unit =
                    selected.niyam_type === "weekly"
                      ? hi
                        ? "सप्ताह"
                        : "weeks"
                      : selected.niyam_type === "monthly"
                        ? hi
                          ? "माह"
                          : "months"
                        : hi
                          ? "दिन"
                          : "days";
                  return (
                    <View style={{ marginTop: 12, marginBottom: 4 }}>
                      <Body style={{ fontSize: 13, fontWeight: "700" }}>
                        {hi
                          ? `वर्तमान लकीर: ${streak}`
                          : `Current streak: ${streak}`}
                      </Body>
                      {next ? (
                        <Body muted style={{ fontSize: 12, marginTop: 4 }}>
                          {hi
                            ? `${next.remaining} और ${unit} — ${badgeLabel(next.milestone.key, true)} तक`
                            : `${next.remaining} more ${unit} to your ${badgeLabel(next.milestone.key, false)}`}
                        </Body>
                      ) : (
                        <Body muted style={{ fontSize: 12, marginTop: 4 }}>
                          {hi
                            ? "इस Niyam के सभी लकीर बैज अर्जित!"
                            : "All streak badges earned for this Niyam!"}
                        </Body>
                      )}
                    </View>
                  );
                })()}

                <Row style={{ marginTop: 16, gap: 10 }}>
                  <Button
                    label={hi ? "रद्द करें" : "Cancel"}
                    variant="outline"
                    onPress={onCancel}
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
                      const title = hi ? row.title_hi ?? row.title_en : row.title_en;
                      const submitted = !!row.submitted_this_period;
                      const tag = hi ? row.period_status_tag_hi ?? row.period_status_tag_en : row.period_status_tag_en;
                      const period = hi ? row.period_label_hi ?? row.period_label_en : row.period_label_en;
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
    </ActivityThemed>
  );
}
