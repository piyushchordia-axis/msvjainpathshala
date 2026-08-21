/**
 * Guruji Progress — learner-style outline with three statuses + section Certify.
 * CU11 status, CU12 freeze, CU17 honorific, CU18 confirm, CU13 bulk in header overflow.
 */
import { useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { bodyFamily } from "@/constants/typography";
import { Body, Button, StateView } from "@/components/ui";
import { CourseLearnerRow } from "@/components/CourseLearnerRow";
import { CertifyConfirmModal } from "@/components/CertifyConfirmModal";
import { SyncOpStatus } from "@/components/SyncOpStatus";
import {
  certifiedFrozenExplanation,
  divergenceNote,
  type CourseProgressStatus,
} from "@/lib/course-labels";
import {
  useBulkCourseNodeProgress,
  useCertifyCourseNode,
  useCourseTree,
  useSetCourseNodeProgress,
  type CourseTreeSection,
  type CourseTreeSubsection,
} from "@/lib/queries";
import { useCourseSyncOps } from "@/hooks/useCourseSyncOps";
import { retryOp } from "@/lib/offline";
import { ApiError } from "@/lib/api";

export function CourseTreeView(props: {
  courseId: string;
  studentId: string;
  studentName: string;
  mode: "admin" | "learner";
  /** When set, enables CU13 bulk behind header overflow. */
  batchId?: string | null;
  /** C4/CU16 — sanchalak gets an extra divergence summary panel. */
  persona?: "shikshak" | "sanchalak";
}) {
  const c = useColors();
  const { hi } = useLocale();
  const treeQ = useCourseTree(props.courseId, props.studentId);
  const setProgress = useSetCourseNodeProgress({ offline: props.mode === "admin" });
  const bulk = useBulkCourseNodeProgress();
  const certify = useCertifyCourseNode();

  const [certifyTarget, setCertifyTarget] = useState<{
    nodeId: string;
    title: string;
    punyaPoints: number;
  } | null>(null);
  const [busyNode, setBusyNode] = useState<string | null>(null);
  const [lastBulkMsg, setLastBulkMsg] = useState<string | null>(null);
  const [readyOnly, setReadyOnly] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [openSectionId, setOpenSectionId] = useState<string | null>(null);

  const { ops: syncOps, refresh: refreshSync } = useCourseSyncOps({
    studentId: props.studentId,
  });

  const tree = treeQ.data;

  const readyCount = useMemo(
    () =>
      (tree?.sections ?? []).filter((s) => s.status === "completed" && !s.certified_at)
        .length,
    [tree?.sections],
  );

  const visibleSections = useMemo(() => {
    const sections = tree?.sections ?? [];
    if (!readyOnly) return sections;
    return sections.filter((s) => s.status === "completed" && !s.certified_at);
  }, [tree?.sections, readyOnly]);

  // C4/CU16 — declared-vs-derived divergence is information, never an error;
  // the Sanchalak gets a standing summary panel over it.
  const divergentSections = useMemo(
    () => (tree?.sections ?? []).filter((s) => s.status_diverges),
    [tree?.sections],
  );

  async function changeSectionStatus(
    section: CourseTreeSection,
    status: CourseProgressStatus,
  ) {
    if (section.certified_at) {
      Alert.alert(
        hi ? "प्रमाणित नोड" : "Certified node",
        certifiedFrozenExplanation(hi),
      );
      return;
    }
    setBusyNode(section.id);
    try {
      // C4 — a single declared write, never a client-side fan-out onto
      // sub-sections (CU15/CU16). onMutate already patches the row
      // optimistically (H21), so no immediate refetch is needed here.
      await setProgress.mutateAsync({
        nodeId: section.id,
        nodeKind: "section",
        student_id: props.studentId,
        status,
      });
      await refreshSync();
    } catch (err) {
      const msg =
        err instanceof ApiError && err.code === "ERR_COURSE_NODE_CERTIFIED"
          ? certifiedFrozenExplanation(hi)
          : err instanceof ApiError
            ? err.message
            : hi
              ? "प्रगति सहेजी नहीं जा सकी — फिर कोशिश करें।"
              : "Could not save progress — try again.";
      Alert.alert(hi ? "त्रुटि" : "Error", msg);
      await treeQ.refetch();
    } finally {
      setBusyNode(null);
    }
  }

  async function changeSubsectionStatus(
    section: CourseTreeSection,
    subsection: CourseTreeSubsection,
    status: CourseProgressStatus,
  ) {
    if (subsection.certified_at) {
      Alert.alert(
        hi ? "प्रमाणित नोड" : "Certified node",
        certifiedFrozenExplanation(hi),
      );
      return;
    }
    setBusyNode(subsection.id);
    try {
      // C4 — a single declared write, never a client-side fan-out onto the
      // parent section (CU15/CU16). onMutate already patches the row
      // optimistically (H21), so no immediate refetch is needed here.
      await setProgress.mutateAsync({
        nodeId: subsection.id,
        nodeKind: "subsection",
        student_id: props.studentId,
        status,
      });
      await refreshSync();
    } catch (err) {
      const msg =
        err instanceof ApiError && err.code === "ERR_COURSE_NODE_CERTIFIED"
          ? certifiedFrozenExplanation(hi)
          : err instanceof ApiError
            ? err.message
            : hi
              ? "प्रगति सहेजी नहीं जा सकी — फिर कोशिश करें।"
              : "Could not save progress — try again.";
      Alert.alert(hi ? "त्रुटि" : "Error", msg);
      await treeQ.refetch();
    } finally {
      setBusyNode(null);
    }
  }

  async function bulkSetSection(
    section: CourseTreeSection,
    status: "in_progress" | "completed",
  ) {
    if (!props.batchId) return;
    setBusyNode(section.id);
    setLastBulkMsg(null);
    const verbHi = status === "completed" ? "सामूहिक बंद" : "सामूहिक शुरू";
    const verbEn = status === "completed" ? "Bulk close" : "Bulk start";
    try {
      const res = await bulk.mutateAsync({
        nodeId: section.id,
        batch_id: props.batchId,
        status,
      });
      const applied = res.applied ?? 0;
      const skipped = res.skipped ?? 0;
      setLastBulkMsg(
        hi
          ? `${verbHi}: ${applied} विद्यार्थी प्रभावित, ${skipped} छोड़े गए।`
          : `${verbEn}: ${applied} student${applied === 1 ? "" : "s"} affected, ${skipped} skipped.`,
      );
      // H17 — bulk now routes offline too; the hook's onSuccess already
      // invalidates the tree query, so an immediate refetch here would just
      // throw (and mis-report this as failed) on a genuinely offline device.
    } catch (err) {
      Alert.alert(
        hi ? "त्रुटि" : "Error",
        err instanceof ApiError
          ? err.message
          : hi
            ? `${verbHi} असफल — फिर कोशिश करें।`
            : `${verbEn} failed — try again.`,
      );
    } finally {
      setBusyNode(null);
    }
  }

  async function confirmCertify() {
    if (!certifyTarget) return;
    setBusyNode(certifyTarget.nodeId);
    try {
      await certify.mutateAsync({
        nodeId: certifyTarget.nodeId,
        nodeKind: "section",
        student_id: props.studentId,
        offline: props.mode === "admin",
      });
      setCertifyTarget(null);
      // The hook's onSuccess already invalidates the tree query; an
      // immediate refetch here would throw (and mis-report this as failed)
      // on a genuinely offline device even though the certify was queued.
      await refreshSync();
    } catch (err) {
      Alert.alert(
        hi ? "प्रमाणन असफल" : "Certification failed",
        err instanceof ApiError
          ? err.message
          : hi
            ? "प्रमाणित नहीं हो सका — स्थिति जाँचें और फिर कोशिश करें।"
            : "Could not certify — check status and try again.",
      );
    } finally {
      setBusyNode(null);
    }
  }

  if (treeQ.isLoading) {
    return (
      <StateView
        status="loading"
        emptyText={hi ? "पाठ्यक्रम लोड…" : "Loading course…"}
      />
    );
  }
  if (treeQ.isError || !tree) {
    return (
      <StateView
        status="error"
        emptyText=""
        errorText={
          hi
            ? "पाठ्यक्रम नहीं खुल सका — रीफ़्रेश करें।"
            : "Could not load this course — pull to refresh."
        }
        onRetry={() => void treeQ.refetch()}
        retryLabel={hi ? "फिर कोशिश करें" : "Try again"}
      />
    );
  }

  const courseTitle = hi
    ? tree.course.name_hi || tree.course.name_en
    : tree.course.name_en;

  return (
    <View style={{ gap: 10 }}>
      <View style={{ gap: 2 }}>
        <Text
          style={{
            fontSize: 18,
            lineHeight: 26,
            fontFamily: bodyFamily(hi, "semibold"),
            color: c.secondary,
          }}
          numberOfLines={2}
        >
          {courseTitle}
        </Text>
        <Body muted style={{ lineHeight: 20, fontSize: 13 }} numberOfLines={1}>
          {props.studentName}
          {readyCount > 0
            ? ` · ${readyCount} ${hi ? "प्रमाणन योग्य" : "ready"}`
            : ""}
        </Body>
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <Pressable
          onPress={() => setReadyOnly((v) => !v)}
          style={{
            paddingVertical: 6,
            paddingHorizontal: 12,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: readyOnly ? c.primary : c.border,
            backgroundColor: readyOnly ? c.primary : c.card,
          }}
        >
          <Text
            style={{
              fontSize: 13,
              lineHeight: 20,
              color: readyOnly ? c.primaryForeground : c.foreground,
              fontFamily: bodyFamily(hi, readyOnly ? "semibold" : "regular"),
            }}
          >
            {hi ? "प्रमाणन योग्य" : "Ready"}
          </Text>
        </Pressable>
        {props.batchId ? (
          <Pressable
            onPress={() => setBatchOpen((v) => !v)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              paddingVertical: 6,
              paddingHorizontal: 10,
            }}
          >
            <Ionicons
              name={batchOpen ? "chevron-up" : "ellipsis-horizontal"}
              size={16}
              color={c.mutedForeground}
            />
            <Body muted style={{ fontSize: 13, lineHeight: 20 }}>
              {hi ? "बैच" : "Batch"}
            </Body>
          </Pressable>
        ) : null}
      </View>

      {batchOpen && props.batchId ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: c.border,
            borderRadius: c.radius,
            backgroundColor: c.card,
            overflow: "hidden",
          }}
        >
          {(tree.sections ?? []).map((section) => {
            const title = hi ? section.title_hi || section.title_en : section.title_en;
            const busy = busyNode === section.id;
            return (
              <View
                key={section.id}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderBottomWidth: 1,
                  borderBottomColor: c.border,
                }}
              >
                <Text
                  style={{
                    flex: 1,
                    fontSize: 13,
                    lineHeight: 18,
                    fontFamily: bodyFamily(hi),
                    color: c.foreground,
                  }}
                  numberOfLines={1}
                >
                  {title}
                </Text>
                <Pressable
                  disabled={busy || !!section.certified_at}
                  onPress={() => void bulkSetSection(section, "in_progress")}
                  style={{ opacity: busy || section.certified_at ? 0.4 : 1 }}
                >
                  <Body muted style={{ fontSize: 12, lineHeight: 18 }}>
                    {hi ? "शुरू" : "Start"}
                  </Body>
                </Pressable>
                <Pressable
                  disabled={busy || !!section.certified_at}
                  onPress={() => void bulkSetSection(section, "completed")}
                  style={{ opacity: busy || section.certified_at ? 0.4 : 1 }}
                >
                  <Body muted style={{ fontSize: 12, lineHeight: 18 }}>
                    {hi ? "बंद" : "Close"}
                  </Body>
                </Pressable>
              </View>
            );
          })}
        </View>
      ) : null}

      {lastBulkMsg ? (
        <View
          style={{
            backgroundColor: c.infoSoft,
            borderRadius: c.radius,
            padding: 10,
            borderWidth: 1,
            borderColor: c.border,
          }}
        >
          <Body style={{ color: c.infoText, lineHeight: 20, fontSize: 13 }}>
            {lastBulkMsg}
          </Body>
        </View>
      ) : null}

      {props.persona === "sanchalak" && divergentSections.length > 0 ? (
        <View
          style={{
            backgroundColor: c.warningSoft,
            borderRadius: c.radius,
            padding: 10,
            borderWidth: 1,
            borderColor: c.border,
            gap: 6,
          }}
        >
          <Body style={{ color: c.warningText, fontWeight: "600", fontSize: 13, lineHeight: 20 }}>
            {hi
              ? `${divergentSections.length} अनुभाग — घोषित बनाम वास्तविक प्रगति में अंतर`
              : `${divergentSections.length} section${divergentSections.length === 1 ? "" : "s"} where declared and actual progress differ`}
          </Body>
          {divergentSections.map((s) => {
            const note = divergenceNote(s, hi);
            const sTitle = hi ? s.title_hi || s.title_en : s.title_en;
            return (
              <Body
                key={s.id}
                muted
                style={{ fontSize: 12, lineHeight: 18 }}
                numberOfLines={2}
              >
                {note ? `${sTitle} — ${note}` : sTitle}
              </Body>
            );
          })}
        </View>
      ) : null}

      {syncOps.map((op) => (
        <SyncOpStatus
          key={op.submission_op_id}
          state={op.state}
          error={op.error}
          title={
            op.kind === "certification"
              ? hi
                ? "प्रमाणन ऑफ़लाइन"
                : "Certification offline"
              : undefined
          }
          onRetry={
            op.state === "failed"
              ? () => {
                  void retryOp(op.queue, op.submission_op_id).then(() => refreshSync());
                }
              : undefined
          }
        />
      ))}

      <View
        style={{
          backgroundColor: c.card,
          borderRadius: c.radius,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: c.border,
          overflow: "visible",
        }}
      >
        {visibleSections.length === 0 ? (
          <StateView
            status="empty"
            emptyText={
              readyOnly
                ? hi
                  ? "कोई अनुभाग प्रमाणन के लिए तैयार नहीं।"
                  : "No sections ready to certify."
                : hi
                  ? "इस पाठ्यक्रम में अभी कोई अनुभाग नहीं।"
                  : "No sections in this course yet."
            }
          />
        ) : (
          visibleSections.map((section, i) => {
            const title = hi ? section.title_hi || section.title_en : section.title_en;
            const expanded = openSectionId === section.id;
            const canCertify =
              !section.certified_at && section.status === "completed";
            return (
              <View key={section.id}>
                <CourseLearnerRow
                  index={i + 1}
                  title={title}
                  status={section.status}
                  certifiedAt={section.certified_at}
                  certifiedByGender={section.certified_by_gender}
                  busy={busyNode === section.id}
                  showChevron={section.subsections.length > 0}
                  subtitle={
                    section.subsections.length > 0
                      ? `(${section.subsections.length})`
                      : null
                  }
                  // C4/CU16 — declared-vs-derived divergence, rendered for the
                  // shikshak too (not sanchalak-only), never auto-corrected.
                  caption={divergenceNote(section, hi)}
                  onPress={
                    section.subsections.length > 0
                      ? () =>
                          setOpenSectionId((cur) =>
                            cur === section.id ? null : section.id,
                          )
                      : undefined
                  }
                  onChangeStatus={(status) => void changeSectionStatus(section, status)}
                />
                {canCertify ? (
                  <View style={{ paddingHorizontal: 12, paddingBottom: 10 }}>
                    <Button
                      label={hi ? "प्रमाणित करें" : "Certify"}
                      onPress={() =>
                        setCertifyTarget({
                          nodeId: section.id,
                          title,
                          punyaPoints: section.punya_points,
                        })
                      }
                      disabled={busyNode === section.id}
                    />
                  </View>
                ) : null}
                {expanded
                  ? section.subsections.map((sub, j) => {
                      const subTitle = hi
                        ? sub.title_hi || sub.title_en
                        : sub.title_en;
                      return (
                        <View
                          key={sub.id}
                          style={{ paddingLeft: 12, backgroundColor: c.background }}
                        >
                          <CourseLearnerRow
                            index={j + 1}
                            title={subTitle}
                            status={sub.status}
                            certifiedAt={sub.certified_at}
                            certifiedByGender={sub.certified_by_gender}
                            busy={busyNode === sub.id}
                            onChangeStatus={(status) =>
                              void changeSubsectionStatus(section, sub, status)
                            }
                          />
                        </View>
                      );
                    })
                  : null}
              </View>
            );
          })
        )}
      </View>

      <CertifyConfirmModal
        visible={!!certifyTarget}
        studentName={props.studentName}
        nodeTitle={certifyTarget?.title ?? ""}
        punyaPoints={certifyTarget?.punyaPoints ?? 0}
        nodeKind="section"
        busy={!!certifyTarget && busyNode === certifyTarget.nodeId}
        onCancel={() => setCertifyTarget(null)}
        onConfirm={() => void confirmCertify()}
      />
    </View>
  );
}
