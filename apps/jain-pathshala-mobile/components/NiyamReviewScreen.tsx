/**
 * Shikshak Niyam review — compact rows, bulk approve, written reject reasons.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Image as ExpoImage } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { ApiError } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { bodyFamily } from "@/constants/typography";
import { AppHeader } from "@/components/AppHeader";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import {
  firstProofPreview,
  ImageViewerModal,
  openProofExternally,
  ProofThumb,
  type NiyamProofKind,
} from "@/components/NiyamProof";
import {
  useAdminBatches,
  useApproveNiyam,
  useBulkApproveNiyams,
  usePendingNiyamInfinite,
  useRejectNiyam,
  type PendingNiyamRow,
} from "@/lib/queries";
import {
  REJECT_REASON_MAX,
  REJECT_REASON_MIN,
  REJECT_REASON_PRESETS,
  isRejectReasonValid,
  rejectReasonCharCount,
} from "@/lib/niyam-reject-reason";
import { Body, Button, Row, StateView, Title } from "@/components/ui";

const FILTERS_KEY = "jp.shikshak.niyamReview.filters";

type StoredFilters = { batchId: string | null; niyamType: string | null };

const NIYAM_TYPES: Array<{ key: string | null; en: string; hi: string }> = [
  { key: null, en: "All types", hi: "सभी प्रकार" },
  { key: "daily", en: "Daily", hi: "दैनिक" },
  { key: "weekly", en: "Weekly", hi: "साप्ताहिक" },
  { key: "monthly", en: "Monthly", hi: "मासिक" },
];

function RejectSheet({
  open,
  onClose,
  onSubmit,
  busy,
  windowExpired,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
  busy: boolean;
  windowExpired: boolean;
}) {
  const c = useColors();
  const { hi } = useLocale();
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  const count = rejectReasonCharCount(reason);
  const valid = isRejectReasonValid(reason);

  const fieldStyle = {
    fontFamily: bodyFamily(hi),
    fontSize: 15,
    lineHeight: 22,
    color: c.foreground,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: c.radius,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: c.card,
    minHeight: 100,
    textAlignVertical: "top" as const,
  };

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
          <Title style={{ fontSize: 20, lineHeight: 28, flex: 1, paddingRight: 12 }}>
            {hi ? "अस्वीकृत करें" : "Reject Niyam"}
          </Title>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={{ color: c.primary, fontFamily: bodyFamily(hi, "semibold") }}>
              {hi ? "बंद करें" : "Close"}
            </Text>
          </Pressable>
        </View>
        <KeyboardAwareScrollViewCompat
          contentContainerStyle={{ padding: 18, gap: 14, paddingBottom: 40 }}
          bottomOffset={20}
          keyboardShouldPersistTaps="handled"
        >
          {windowExpired ? (
            <Body style={{ color: c.destructive, lineHeight: 22 }}>
              {hi
                ? "अस्वीकृति की 30-दिन की अवधि समाप्त हो चुकी है।"
                : "The 30-day rejection window has expired for this submission."}
            </Body>
          ) : (
            <>
              <Body muted style={{ fontSize: 12, lineHeight: 22 }}>
                {hi ? "कारण * (कम से कम 20 अक्षर)" : "Reason * (at least 20 characters)"}
              </Body>
              <Row style={{ flexWrap: "wrap", gap: 8 }}>
                {REJECT_REASON_PRESETS.map((p) => {
                  const label = hi ? p.hi ?? p.en : p.en;
                  return (
                    <Pressable
                      key={p.en}
                      onPress={() => setReason(label)}
                      disabled={busy}
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        borderRadius: c.radius,
                        borderWidth: 1,
                        borderColor: c.border,
                        backgroundColor: c.card,
                        maxWidth: "100%",
                      }}
                    >
                      <Body style={{ fontSize: 13, lineHeight: 22 }}>{label}</Body>
                    </Pressable>
                  );
                })}
              </Row>
              <TextInput
                value={reason}
                onChangeText={setReason}
                multiline
                editable={!busy}
                maxLength={REJECT_REASON_MAX}
                placeholder={hi ? "अभिभावक को स्पष्ट बताएँ कि क्या ठीक करें।" : "Tell the parent what to fix."}
                placeholderTextColor={c.mutedForeground}
                style={fieldStyle}
              />
              <Body
                muted
                style={{
                  fontSize: 12,
                  lineHeight: 22,
                  color: count < REJECT_REASON_MIN ? c.destructive : c.mutedForeground,
                }}
              >
                {count}/{REJECT_REASON_MIN}
                {hi ? " न्यूनतम" : " minimum"}
              </Body>
              <Button
                label={hi ? "अस्वीकृत करें" : "Reject"}
                onPress={() => onSubmit(reason.trim())}
                loading={busy}
                disabled={!valid || busy}
              />
            </>
          )}
        </KeyboardAwareScrollViewCompat>
      </View>
    </Modal>
  );
}

function ReviewRow({
  row,
  expanded,
  selected,
  selectionMode,
  busy,
  onToggleExpand,
  onToggleSelect,
  onLongPress,
  onApprove,
  onReject,
  onOpenImage,
}: {
  row: PendingNiyamRow;
  expanded: boolean;
  selected: boolean;
  selectionMode: boolean;
  busy: boolean;
  onToggleExpand: () => void;
  onToggleSelect: () => void;
  onLongPress: () => void;
  onApprove: () => void;
  onReject: () => void;
  onOpenImage: (uri: string) => void;
}) {
  const c = useColors();
  const { hi } = useLocale();
  const title = hi ? row.niyam_title_hi || row.niyam_title_en : row.niyam_title_en;
  const preview = firstProofPreview(row);
  const canReject = row.can_reject !== false;
  const canDecide = row.can_decide !== false;

  function openProof(uri: string | null, kind: NiyamProofKind | null) {
    if (!uri) return;
    if (kind === "photo") onOpenImage(uri);
    else void openProofExternally(uri);
  }

  return (
    <Pressable
      onPress={() => (selectionMode ? onToggleSelect() : onToggleExpand())}
      onLongPress={canDecide ? onLongPress : undefined}
      style={{
        minHeight: 72,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderBottomWidth: 1,
        borderBottomColor: c.border,
        backgroundColor: selected ? c.primary + "12" : c.background,
        opacity: canDecide ? 1 : 0.85,
      }}
    >
      <Row style={{ alignItems: "center", gap: 10 }}>
        <ProofThumb
          uri={preview.uri}
          kind={preview.kind}
          onPress={() => openProof(preview.uri, preview.kind)}
        />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Body
            numberOfLines={2}
            style={{ fontFamily: bodyFamily(hi, "semibold"), lineHeight: 22, fontSize: 14 }}
          >
            {row.student_name}
            <Text style={{ fontFamily: bodyFamily(hi), color: c.mutedForeground }}> · {title}</Text>
          </Body>
          <Body muted style={{ fontSize: 11, lineHeight: 22, marginTop: 2 }}>
            {formatDate(row.submission_date)}
            {row.batch_name ? ` · ${row.batch_name}` : ""}
          </Body>
        </View>
        <Pressable
          onPress={() => {
            if (canDecide) onToggleSelect();
          }}
          disabled={!canDecide}
          hitSlop={10}
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            borderWidth: 2,
            borderColor: selected ? c.primary : c.border,
            backgroundColor: selected ? c.primary : "transparent",
            alignItems: "center",
            justifyContent: "center",
            opacity: canDecide ? 1 : 0.4,
          }}
        >
          {selected ? <Ionicons name="checkmark" size={18} color={c.primaryForeground} /> : null}
        </Pressable>
      </Row>

      {!canDecide ? (
        <Body muted style={{ fontSize: 12, lineHeight: 22, marginTop: 6, paddingLeft: 66 }}>
          {hi
            ? "यह विद्यार्थी दूसरे गुरुजी के बैच में है"
            : "This student is in another Guruji's batch"}
        </Body>
      ) : null}

      {expanded && !selectionMode ? (
        <View style={{ marginTop: 10, gap: 8, paddingLeft: 66 }}>
          {row.notes ? (
            <Body style={{ fontSize: 13, lineHeight: 22 }}>{row.notes}</Body>
          ) : null}
          {row.period_key ? (
            <Body muted style={{ fontSize: 12, lineHeight: 22 }}>
              {hi ? "अवधि" : "Period"}: {row.period_key}
            </Body>
          ) : null}
          {row.media?.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 4 }}>
              <Row style={{ gap: 8 }}>
                {row.media.map((m) => {
                  const kind = (m.kind === "video" || m.kind === "audio" || m.kind === "photo"
                    ? m.kind
                    : "photo") as NiyamProofKind;
                  if (kind === "photo" && m.url) {
                    return (
                      <Pressable key={m.id} onPress={() => onOpenImage(m.url!)}>
                        <ExpoImage
                          source={{ uri: m.url }}
                          style={{ width: 72, height: 72, borderRadius: c.radius }}
                          contentFit="cover"
                        />
                      </Pressable>
                    );
                  }
                  return (
                    <ProofThumb
                      key={m.id}
                      uri={m.url ?? null}
                      kind={kind}
                      size={72}
                      onPress={() => openProof(m.url ?? null, kind)}
                    />
                  );
                })}
              </Row>
            </ScrollView>
          ) : null}
          <Row style={{ gap: 8, flexWrap: "wrap" }}>
            <Button
              label={hi ? "स्वीकृत" : "Approve"}
              variant="secondary"
              disabled={busy || !canDecide}
              onPress={onApprove}
              style={{ paddingVertical: 8, paddingHorizontal: 12 } as never}
            />
            <Button
              label={hi ? "अस्वीकृत" : "Reject"}
              variant="outline"
              disabled={busy || !canReject || !canDecide}
              onPress={onReject}
              style={{ paddingVertical: 8, paddingHorizontal: 12 } as never}
            />
          </Row>
          {canDecide && !canReject ? (
            <Body muted style={{ fontSize: 12, lineHeight: 22 }}>
              {hi
                ? "अस्वीकृति की अवधि समाप्त — अस्वीकृत अक्षम।"
                : "Rejection window expired — Reject is disabled."}
            </Body>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

export default function NiyamReviewScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const batches = useAdminBatches(true);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [niyamType, setNiyamType] = useState<string | null>(null);
  const [filtersReady, setFiltersReady] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    void AsyncStorage.getItem(FILTERS_KEY).then((raw) => {
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as StoredFilters;
          setBatchId(parsed.batchId ?? null);
          setNiyamType(parsed.niyamType ?? null);
        } catch {
          /* ignore */
        }
      }
      setFiltersReady(true);
    });
  }, []);

  useEffect(() => {
    if (!filtersReady) return;
    void AsyncStorage.setItem(
      FILTERS_KEY,
      JSON.stringify({ batchId, niyamType } satisfies StoredFilters),
    );
  }, [batchId, niyamType, filtersReady]);

  const list = usePendingNiyamInfinite({
    batchId,
    niyamType,
    enabled: filtersReady,
  });
  const approve = useApproveNiyam();
  const reject = useRejectNiyam();
  const bulk = useBulkApproveNiyams();

  const items = useMemo(
    () => list.data?.pages.flatMap((p) => p.items) ?? [],
    [list.data?.pages],
  );
  const batchItems = batches.data?.items ?? [];

  const rejectRow = rejectId ? items.find((r) => r.id === rejectId) : null;

  function clearSelection() {
    setSelected(new Set());
    setSelectionMode(false);
  }

  function toggleSelect(id: string) {
    const row = items.find((r) => r.id === id);
    if (row && row.can_decide === false) return;
    setSelectionMode(true);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (next.size === 0) setSelectionMode(false);
      return next;
    });
  }

  function confirmBulkApprove() {
    const ids = Array.from(selected).filter((id) => {
      const row = items.find((r) => r.id === id);
      return row?.can_decide !== false;
    });
    if (ids.length === 0) return;
    Alert.alert(
      hi ? "स्वीकृत करें?" : "Approve selected?",
      hi ? `${ids.length} प्रस्तुतियाँ स्वीकृत होंगी।` : `${ids.length} submission(s) will be approved.`,
      [
        { text: hi ? "रद्द" : "Cancel", style: "cancel" },
        {
          text: hi ? "स्वीकृत" : "Approve",
          onPress: () => {
            bulk.mutate(ids, {
              onSuccess: (res) => {
                const approved = res.results.filter((r) => r.status === "approved").length;
                const skipped = res.results.filter((r) => r.status === "skipped");
                const failed = res.results.filter((r) => r.status === "failed");
                const skippedIds = skipped.map((r) => r.id).join(", ");
                const msg = hi
                  ? `${approved} स्वीकृत, ${skipped.length} छोड़ी गईं${failed.length ? `, ${failed.length} विफल` : ""}${
                      skippedIds ? `\n\nछोड़ी गईं: ${skippedIds}` : ""
                    }`
                  : `${approved} approved, ${skipped.length} skipped${failed.length ? `, ${failed.length} failed` : ""}${
                      skippedIds ? `\n\nSkipped: ${skippedIds}` : ""
                    }`;
                Alert.alert(hi ? "पूर्ण" : "Done", msg);
                clearSelection();
              },
              onError: (e) => {
                Alert.alert(
                  hi ? "त्रुटि" : "Could not approve",
                  e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed",
                );
              },
            });
          },
        },
      ],
    );
  }

  function onApproveOne(id: string) {
    Alert.alert(hi ? "स्वीकृत करें?" : "Approve this Niyam?", undefined, [
      { text: hi ? "रद्द" : "Cancel", style: "cancel" },
      {
        text: hi ? "स्वीकृत" : "Approve",
        onPress: () => {
          setBusyId(id);
          approve.mutate(id, {
            onError: (e) => {
              Alert.alert(
                hi ? "त्रुटि" : "Could not approve",
                e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed",
              );
            },
            onSettled: () => setBusyId(null),
          });
        },
      },
    ]);
  }

  function onRejectSubmit(reason: string) {
    if (!rejectId) return;
    setBusyId(rejectId);
    reject.mutate(
      { id: rejectId, reason },
      {
        onSuccess: () => setRejectId(null),
        onError: (e) => {
          if (e instanceof ApiError && e.code === "ERR_NIYAM_REVERSAL_WINDOW_EXPIRED") {
            Alert.alert(hi ? "अवधि समाप्त" : "Window expired", e.message);
            setRejectId(null);
            void list.refetch();
            return;
          }
          Alert.alert(
            hi ? "त्रुटि" : "Could not reject",
            e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed",
          );
        },
        onSettled: () => setBusyId(null),
      },
    );
  }

  const renderItem = useCallback(
    ({ item }: { item: PendingNiyamRow }) => (
      <ReviewRow
        row={item}
        expanded={expandedId === item.id}
        selected={selected.has(item.id)}
        selectionMode={selectionMode}
        busy={busyId === item.id || bulk.isPending}
        onToggleExpand={() => setExpandedId((cur) => (cur === item.id ? null : item.id))}
        onToggleSelect={() => toggleSelect(item.id)}
        onLongPress={() => toggleSelect(item.id)}
        onApprove={() => onApproveOne(item.id)}
        onReject={() => setRejectId(item.id)}
        onOpenImage={setViewerUri}
      />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expandedId, selected, selectionMode, busyId, bulk.isPending, hi],
  );

  const selectedCount = selected.size;

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader
        title={hi ? "नियम समीक्षा" : "Niyam review"}
        subtitle={hi ? "लंबित प्रस्तुतियों की जाँच करें" : "Review pending submissions"}
      />

      <View
        style={{
          borderBottomWidth: 1,
          borderBottomColor: c.border,
          paddingVertical: 8,
          paddingHorizontal: 12,
          gap: 8,
          backgroundColor: c.background,
        }}
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Row style={{ gap: 8 }}>
            <FilterChip
              label={hi ? "सभी बैच" : "All batches"}
              active={!batchId}
              onPress={() => setBatchId(null)}
            />
            {batchItems.map((b) => (
              <FilterChip
                key={b.id}
                label={b.name ?? (hi ? "बैच" : "Batch")}
                active={batchId === b.id}
                onPress={() => setBatchId(b.id)}
              />
            ))}
          </Row>
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Row style={{ gap: 8 }}>
            {NIYAM_TYPES.map((t) => (
              <FilterChip
                key={t.key ?? "all"}
                label={hi ? t.hi : t.en}
                active={niyamType === t.key}
                onPress={() => setNiyamType(t.key)}
              />
            ))}
          </Row>
        </ScrollView>
      </View>

      {!filtersReady || list.isLoading ? (
        <StateView status="loading" emptyText="" />
      ) : list.isError ? (
        <StateView
          status="error"
          emptyText=""
          errorText={hi ? "नियम लोड नहीं हुए।" : "Could not load submissions."}
          onRetry={list.refetch}
          retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
        />
      ) : items.length === 0 ? (
        <StateView
          status="empty"
          emptyText={hi ? "कोई लंबित नियम नहीं।" : "No pending Niyams to review."}
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          onEndReached={() => {
            if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
          }}
          onEndReachedThreshold={0.4}
          refreshing={list.isRefetching}
          onRefresh={() => void list.refetch()}
          ListFooterComponent={
            list.isFetchingNextPage ? (
              <View style={{ padding: 16 }}>
                <StateView status="loading" emptyText="" />
              </View>
            ) : null
          }
          contentContainerStyle={{ paddingBottom: selectionMode ? 88 : 24 }}
        />
      )}

      {selectionMode && selectedCount > 0 ? (
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            padding: 14,
            borderTopWidth: 1,
            borderTopColor: c.border,
            backgroundColor: c.card,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Button
            label={hi ? `${selectedCount} स्वीकृत करें` : `Approve ${selectedCount}`}
            onPress={confirmBulkApprove}
            loading={bulk.isPending}
            disabled={bulk.isPending}
            style={{ flex: 1 }}
          />
          <Button label={hi ? "साफ़" : "Clear"} variant="ghost" onPress={clearSelection} />
        </View>
      ) : null}

      <ImageViewerModal uri={viewerUri} open={!!viewerUri} onClose={() => setViewerUri(null)} />
      <RejectSheet
        open={!!rejectId}
        onClose={() => setRejectId(null)}
        onSubmit={onRejectSubmit}
        busy={busyId === rejectId && reject.isPending}
        windowExpired={rejectRow ? rejectRow.can_reject === false : false}
      />
    </View>
  );
}

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  const { hi } = useLocale();
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: c.radius,
        borderWidth: 1,
        borderColor: active ? c.primary : c.border,
        backgroundColor: active ? c.primary + "14" : c.card,
      }}
    >
      <Body
        style={{
          fontSize: 13,
          lineHeight: 22,
          fontFamily: bodyFamily(hi, active ? "semibold" : undefined),
          color: active ? c.primary : c.foreground,
        }}
      >
        {label}
      </Body>
    </Pressable>
  );
}
