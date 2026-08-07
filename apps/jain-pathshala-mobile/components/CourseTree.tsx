/**
 * Shared course tree — CU11 bidirectional status, CU12 freeze, CU16 divergence,
 * CU17 honorific, CU18 certify entry (admin), offline SyncOpStatus.
 */
import { useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { bodyFamily } from "@/constants/typography";
import { Body, Button, Card, Pill, Row, StateView } from "@/components/ui";
import { CertifyConfirmModal } from "@/components/CertifyConfirmModal";
import { SyncOpStatus } from "@/components/SyncOpStatus";
import {
  certifiedFrozenExplanation,
  certifiedLabel,
  courseStatusLabel,
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

const STATUSES: CourseProgressStatus[] = ["not_started", "in_progress", "completed"];

export function CourseTreeView(props: {
  courseId: string;
  studentId: string;
  studentName: string;
  mode: "admin" | "learner";
  /** When set, enables CU13 bulk close for the batch. */
  batchId?: string | null;
}) {
  const c = useColors();
  const { hi } = useLocale();
  const treeQ = useCourseTree(props.courseId, props.studentId);
  const setProgress = useSetCourseNodeProgress({ offline: props.mode === "admin" });
  const bulk = useBulkCourseNodeProgress();
  const certify = useCertifyCourseNode();

  const [certifyTarget, setCertifyTarget] = useState<{
    nodeId: string;
    nodeKind: "section" | "subsection";
    title: string;
    punyaPoints: number;
  } | null>(null);
  const [busyNode, setBusyNode] = useState<string | null>(null);
  const [lastBulkMsg, setLastBulkMsg] = useState<string | null>(null);

  const { ops: syncOps, refresh: refreshSync } = useCourseSyncOps({
    studentId: props.studentId,
  });

  const tree = treeQ.data;

  async function changeStatus(
    nodeId: string,
    nodeKind: "section" | "subsection",
    status: CourseProgressStatus,
    certifiedAt: string | null,
  ) {
    if (certifiedAt) {
      Alert.alert(
        hi ? "प्रमाणित नोड" : "Certified node",
        certifiedFrozenExplanation(hi),
      );
      return;
    }
    setBusyNode(nodeId);
    try {
      await setProgress.mutateAsync({
        nodeId,
        nodeKind,
        student_id: props.studentId,
        status,
      });
      await treeQ.refetch();
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
    if (!props.batchId) {
      Alert.alert(
        hi ? "बैच चुनें" : "Pick a batch",
        hi
          ? "बैच चुनने के बाद ही सामूहिक परिवर्तन संभव है।"
          : "Choose a batch before bulk-updating a section.",
      );
      return;
    }
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
      await treeQ.refetch();
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
        nodeKind: certifyTarget.nodeKind,
        student_id: props.studentId,
        offline: props.mode === "admin",
      });
      setCertifyTarget(null);
      await treeQ.refetch();
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

  return (
    <View style={{ gap: 14 }}>
      <Card style={{ gap: 6 }}>
        <Text
          style={{
            fontSize: 18,
            lineHeight: 26,
            fontFamily: bodyFamily(hi, "semibold"),
            color: c.secondary,
          }}
        >
          {hi ? tree.course.name_hi || tree.course.name_en : tree.course.name_en}
        </Text>
        {tree.course.academic_year ? (
          <Body muted style={{ lineHeight: 22 }}>
            {tree.course.academic_year}
          </Body>
        ) : null}
        <Body muted style={{ lineHeight: 22 }}>
          {hi ? "कवरेज" : "Coverage"}:{" "}
          {tree.progress.coverage == null
            ? "—"
            : `${Math.round(tree.progress.coverage * 100)}%`}
          {" · "}
          {hi ? "निपुणता" : "Mastery"}:{" "}
          {tree.progress.mastery == null
            ? "—"
            : `${Math.round(tree.progress.mastery * 100)}%`}
        </Body>
      </Card>

      {lastBulkMsg ? (
        <View
          style={{
            backgroundColor: c.infoSoft,
            borderRadius: c.radius,
            padding: 12,
            borderWidth: 1,
            borderColor: c.border,
          }}
        >
          <Body style={{ color: c.infoText, lineHeight: 22 }}>{lastBulkMsg}</Body>
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

      {tree.sections.map((section) => (
        <SectionCard
          key={section.id}
          section={section}
          hi={hi}
          mode={props.mode}
          busy={busyNode === section.id}
          onStatus={(status) =>
            void changeStatus(section.id, "section", status, section.certified_at)
          }
          onCertify={() =>
            setCertifyTarget({
              nodeId: section.id,
              nodeKind: "section",
              title: hi ? section.title_hi || section.title_en : section.title_en,
              punyaPoints: section.punya_points,
            })
          }
          onBulkStart={
            props.mode === "admin" && props.batchId
              ? () => void bulkSetSection(section, "in_progress")
              : undefined
          }
          onBulkClose={
            props.mode === "admin" && props.batchId
              ? () => void bulkSetSection(section, "completed")
              : undefined
          }
          onSubStatus={(sub, status) =>
            void changeStatus(sub.id, "subsection", status, sub.certified_at)
          }
          onSubCertify={(sub) =>
            setCertifyTarget({
              nodeId: sub.id,
              nodeKind: "subsection",
              title: hi ? sub.title_hi || sub.title_en : sub.title_en,
              punyaPoints: 0,
            })
          }
        />
      ))}

      <CertifyConfirmModal
        visible={!!certifyTarget}
        studentName={props.studentName}
        nodeTitle={certifyTarget?.title ?? ""}
        punyaPoints={certifyTarget?.punyaPoints ?? 0}
        nodeKind={certifyTarget?.nodeKind ?? "section"}
        busy={!!certifyTarget && busyNode === certifyTarget.nodeId}
        onCancel={() => setCertifyTarget(null)}
        onConfirm={() => void confirmCertify()}
      />
    </View>
  );
}

function SectionCard(props: {
  section: CourseTreeSection;
  hi: boolean;
  mode: "admin" | "learner";
  busy: boolean;
  onStatus: (s: CourseProgressStatus) => void;
  onCertify: () => void;
  onBulkStart?: () => void;
  onBulkClose?: () => void;
  onSubStatus: (sub: CourseTreeSubsection, s: CourseProgressStatus) => void;
  onSubCertify: (sub: CourseTreeSubsection) => void;
}) {
  const c = useColors();
  const { section, hi } = props;
  const certified = !!section.certified_at;
  const title = hi ? section.title_hi || section.title_en : section.title_en;

  return (
    <Card style={{ gap: 10, padding: 14 }}>
      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
          {certified ? (
            <Ionicons
              name="star"
              size={20}
              color={c.gold}
              style={{ marginTop: 2 }}
              accessibilityLabel={hi ? "प्रमाणित" : "Certified"}
            />
          ) : null}
          <Text
            style={{
              flex: 1,
              fontSize: 16,
              lineHeight: 24,
              fontFamily: bodyFamily(hi, "semibold"),
              color: c.foreground,
            }}
          >
            {title}
          </Text>
        </View>
        <Row style={{ flexWrap: "wrap", gap: 6 }}>
          <Pill label={`${section.punya_points} ${hi ? "पुण्य" : "Punya"}`} />
          {certified ? (
            <Pill
              label={certifiedLabel(section.certified_by_gender, hi)}
              tone="primary"
            />
          ) : null}
        </Row>
      </View>

      <Body muted style={{ lineHeight: 22, fontSize: 13 }}>
        {hi ? "घोषित" : "Declared"}: {courseStatusLabel(section.status, hi)}
        {" · "}
        {hi ? "व्युत्पन्न" : "Derived"}:{" "}
        {section.derived_status == null
          ? hi
            ? "कोई उप-अनुभाग नहीं"
            : "none (no subsections)"
          : `${courseStatusLabel(section.derived_status, hi)} (${section.derived_leaf_reached}/${section.derived_leaf_total})`}
      </Body>
      {section.status_diverges ? (
        <View
          style={{
            backgroundColor: c.muted,
            borderRadius: 10,
            padding: 10,
          }}
        >
          <Body style={{ lineHeight: 22, fontSize: 13 }}>
            {hi
              ? "घोषित स्थिति और व्युत्पन्न रोल-अप अलग हैं — यह जानकारी है, त्रुटि नहीं। स्वतः सुधार नहीं होता।"
              : "Declared status and derived roll-up differ — this is information, not an error. Neither side is auto-corrected."}
          </Body>
        </View>
      ) : null}

      {certified ? (
        <Body muted style={{ lineHeight: 22, fontSize: 13 }}>
          {certifiedFrozenExplanation(hi)}
        </Body>
      ) : (
        <StatusRow
          value={section.status}
          disabled={props.busy}
          hi={hi}
          onChange={props.onStatus}
        />
      )}

      {props.mode === "admin" && !certified && section.status === "completed" ? (
        <Button
          label={hi ? "प्रमाणित करें" : "Certify"}
          onPress={props.onCertify}
          disabled={props.busy}
        />
      ) : null}
      {props.onBulkStart && !certified ? (
        <Button
          variant="outline"
          label={hi ? "बैच के लिए सामूहिक शुरू" : "Bulk start for batch"}
          onPress={props.onBulkStart}
          disabled={props.busy}
        />
      ) : null}
      {props.onBulkClose && !certified ? (
        <Button
          variant="outline"
          label={hi ? "बैच के लिए सामूहिक बंद" : "Bulk close for batch"}
          onPress={props.onBulkClose}
          disabled={props.busy}
        />
      ) : null}

      {section.subsections.map((sub) => {
        const subTitle = hi ? sub.title_hi || sub.title_en : sub.title_en;
        const subCert = !!sub.certified_at;
        return (
          <View
            key={sub.id}
            style={{
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: c.border,
              paddingTop: 10,
              gap: 8,
            }}
          >
            <Text
              style={{
                fontSize: 14,
                lineHeight: 22,
                color: c.foreground,
                fontFamily: bodyFamily(hi),
              }}
            >
              {subTitle}
            </Text>
            {subCert ? (
              <>
                <Row style={{ flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                  <Ionicons name="star" size={16} color={c.gold} />
                  <Pill label={certifiedLabel(sub.certified_by_gender, hi)} tone="primary" />
                </Row>
                <Body muted style={{ lineHeight: 22, fontSize: 12 }}>
                  {certifiedFrozenExplanation(hi)}
                </Body>
              </>
            ) : (
              <StatusRow
                value={sub.status}
                disabled={props.busy}
                hi={hi}
                onChange={(s) => props.onSubStatus(sub, s)}
              />
            )}
            {props.mode === "admin" && !subCert && sub.status === "completed" ? (
              <Button
                variant="secondary"
                label={hi ? "प्रमाणित करें" : "Certify"}
                onPress={() => props.onSubCertify(sub)}
                disabled={props.busy}
              />
            ) : null}
          </View>
        );
      })}
    </Card>
  );
}

function StatusRow(props: {
  value: CourseProgressStatus;
  disabled?: boolean;
  hi: boolean;
  onChange: (s: CourseProgressStatus) => void;
}) {
  const c = useColors();
  const ordered = useMemo(() => STATUSES, []);
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {ordered.map((s) => {
        const active = props.value === s;
        return (
          <Pressable
            key={s}
            disabled={props.disabled}
            onPress={() => props.onChange(s)}
            style={{
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: active ? c.primary : c.border,
              backgroundColor: active ? c.primary : c.card,
              opacity: props.disabled ? 0.5 : 1,
              maxWidth: "100%",
            }}
          >
            <Text
              style={{
                fontSize: 13,
                lineHeight: 22,
                color: active ? c.primaryForeground : c.foreground,
                fontFamily: bodyFamily(props.hi, active ? "semibold" : "regular"),
              }}
            >
              {courseStatusLabel(s, props.hi)}
            </Text>
          </Pressable>
        );
      })}
      {/* Explicit reopen affordance for learner CU11 — in_progress → not_started */}
      {props.value === "completed" || props.value === "in_progress" ? (
        <Pressable
          disabled={props.disabled}
          onPress={() =>
            props.onChange(props.value === "completed" ? "in_progress" : "not_started")
          }
          style={{
            paddingVertical: 8,
            paddingHorizontal: 12,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.muted,
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            opacity: props.disabled ? 0.5 : 1,
          }}
        >
          <Ionicons name="arrow-undo-outline" size={14} color={c.mutedForeground} />
          <Text
            style={{
              fontSize: 13,
              lineHeight: 22,
              color: c.mutedForeground,
              fontFamily: bodyFamily(props.hi),
            }}
          >
            {props.hi ? "फिर खोलें" : "Reopen"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
