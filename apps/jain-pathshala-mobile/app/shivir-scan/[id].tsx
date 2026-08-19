/**
 * Volunteer QR attendance scanner for a shivir.
 *
 * Flow: pick a session for this shivir, then open the camera and scan each
 * student's signed digital ID-card QR. Every successful scan POSTs to the
 * existing shivir scan endpoint, which verifies the HMAC signature, re-checks
 * the card hasn't been revoked/version-bumped, and idempotently records the
 * attendance row. The screen surfaces distinct success / duplicate / revoked /
 * invalid feedback and keeps a running live count for the chosen session+kind.
 *
 * Authorization is enforced server-side (registered volunteer for this shivir
 * OR an in-scope admin); out-of-scope callers get a 404, which we render as a
 * friendly "not available" state.
 */
import { useCallback, useRef, useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { bodyFamily } from "@/constants/typography";
import { Body, Button, Card, Numeric, Pill, Row, Screen, StateView, Title } from "@/components/ui";
import { SyncOpStatus } from "@/components/SyncOpStatus";
import { useQueueSyncOps } from "@/hooks/useQueueSyncOps";
import { QUEUE_KEYS } from "@/lib/offline/queue-keys";
import { retryOp } from "@/lib/offline/sync-engine";
import type { PendingShivirScanOp } from "@/lib/offline/types";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";

type ScanKind = "check_in" | "check_out" | "present";
type AttendanceMode = "in_out" | "present_only";

interface ScanSession {
  id: string;
  title: string;
  session_date: string;
  attendance_mode: AttendanceMode;
  present: number;
  checked_in: number;
  checked_out: number;
}
interface ScanContext {
  shivir: { id: string; name_en: string; name_hi: string | null };
  sessions: ScanSession[];
}
interface ScanResult {
  student: { id: string; full_name: string | null; student_code: string };
  /** The leg the SERVER chose — in in_out mode the client does not decide. */
  scan_kind: ScanKind;
  duplicate: boolean;
  /** False when this student has no registration — recorded, not refused. */
  was_registered: boolean;
  count: number;
}

/**
 * A QR encodes the combined card token: `{ qr_payload, qr_signature }`, or the
 * short `{ p, s }` form.
 *
 * There is deliberately NO bare-payload branch. An earlier version of this
 * comment promised one "for forward-compat", but the body never implemented it
 * and could not: the scan endpoint requires a signature, so a payload-only QR
 * would be rejected server-side anyway. Claiming support the code does not have
 * sends the next reader hunting for a bug in the wrong place.
 */
function extractCardToken(raw: string): { qr_payload: string; qr_signature: string } | null {
  const text = raw.trim();
  try {
    const obj = JSON.parse(text) as Record<string, unknown>;
    const payload = obj.qr_payload ?? obj.p;
    const signature = obj.qr_signature ?? obj.s;
    if (typeof payload === "string" && typeof signature === "string") {
      return { qr_payload: payload, qr_signature: signature };
    }
  } catch {
    // Not JSON — a poster QR, a URL, somebody's UPI code. Not a card.
  }
  return null;
}

/**
 * Should this failure fall back to the offline queue?
 *
 * Gating on `code === "ERR_NETWORK"` alone was too narrow: lib/api mints that
 * code only when fetch itself throws with a recognised message, so a captive
 * portal's 502, a 503, a 429, or the ERR_CONFIG path (statusCode 0) all fell
 * through to "Scan failed" and the scan was DISCARDED. Per AT28 these scans are
 * the only record that the child was there, so a discarded one is unrecoverable.
 *
 * 401/403 are excluded on purpose: they are the server refusing this caller, and
 * queuing them would hide a real authorization problem behind a sync spinner.
 */
function isTransportFailure(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.code === "ERR_NETWORK") return true;
  const status = err.statusCode;
  return status === 0 || status === 429 || status >= 500;
}

/** Per-kind running count for the selected session. */
function countFor(session: ScanSession, kind: ScanKind): number {
  if (kind === "check_in") return session.checked_in;
  if (kind === "check_out") return session.checked_out;
  return session.present;
}

/**
 * Sentinel: the scan could not reach the server and has been queued for sync.
 * Modelled as an error so it flows through the mutation's existing onError path,
 * but it means "safely saved", not "failed".
 */
class OfflineQueuedScan extends Error {
  constructor() {
    super("Scan queued offline");
    this.name = "OfflineQueuedScan";
  }
}

export default function ShivirScanScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [permission, requestPermission] = useCameraPermissions();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [scanKind, setScanKind] = useState<ScanKind>("present");
  /** What the server recorded for the most recent scan — display only. */
  const [lastScanKind, setLastScanKind] = useState<ScanKind | null>(null);
  const [liveCount, setLiveCount] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "warning" | "error" | "info";
    title: string;
    detail: string;
  } | null>(null);
  // Debounce: ignore repeat frames of the same code while a scan is in flight.
  const lockRef = useRef(false);

  const ctx = useQuery({
    queryKey: ["shivir-scan", "context", id],
    queryFn: () => apiGet<ScanContext>(`/v1/shivir-scanner/shivirs/${id}/scan-context`),
    enabled: !!id,
  });

  const selectedSession = ctx.data?.sessions.find((s) => s.id === sessionId) ?? null;

  /**
   * Queued / failed scans for this session.
   *
   * jp.queue.shivir_scans had NO reader anywhere in the app, so a scan that
   * went terminal (a revoked card scanned offline, say) sat in storage
   * invisible and unretryable — a direct violation of the six-state failure
   * table in CLAUDE.md's offline sync §8.
   */
  const { ops: syncOps, refresh: refreshSync } = useQueueSyncOps(
    [QUEUE_KEYS.shivir_scans],
    (payload) => (payload as PendingShivirScanOp).shivir_session_id === sessionId,
  );
  const pendingScans = syncOps.filter((o) => o.state === "queued" || o.state === "syncing").length;
  const blockedSyncOp = syncOps.find((o) => o.state === "failed" || o.state === "conflict") ?? null;

  const scan = useMutation({
    mutationFn: async (vars: { qr_payload: string; qr_signature: string }): Promise<ScanResult> => {
      const scannedAt = new Date().toISOString();
      /**
       * In in_out mode the kind is the SERVER's decision (SPEC 8.6): it reads
       * the student's last scan and alternates. The on-screen toggle is a
       * display of what will happen next, not an instruction — a volunteer who
       * forgot to flip it used to silently drop a child's exit.
       */
      const sendKind = selectedSession?.attendance_mode === "in_out" ? undefined : "present";
      try {
        return await apiPost<ScanResult>(`/v1/shivir-scanner/sessions/${sessionId}/scan`, {
          qr_payload: vars.qr_payload,
          qr_signature: vars.qr_signature,
          scan_kind: sendKind,
          scanned_at: scannedAt,
        });
      } catch (err) {
        // Only a transport failure falls back to the queue. A domain rejection
        // (revoked QR, closed session, wrong scan kind) would fail identically on
        // replay, so queuing it would just defer a certain failure and lie to the
        // volunteer in the meantime.
        if (!isTransportFailure(err)) throw err;

        const { enqueueShivirScan } = await import("@/lib/offline/sync-engine");
        await enqueueShivirScan({
          shivir_session_id: sessionId!,
          qr_payload: vars.qr_payload,
          qr_signature: vars.qr_signature,
          // Omitted in in_out mode so the SERVER derives the next leg from this
          // student's last scan by the time the queue drains — which may be
          // hours later, after other scans have landed.
          scan_kind: sendKind,
          // The moment the card was held to the camera, not the moment the
          // queue drained: a scan at 23:55 synced after midnight belongs to the
          // day it happened.
          scanned_at: scannedAt,
        });
        // Deliberately NOT drained here: the sync loop owns delivery, so there is
        // exactly one retry mechanism (CLAUDE.md offline sync §4).
        throw new OfflineQueuedScan();
      }
    },
    onSuccess: (res) => {
      setLiveCount(res.count);
      // The server chose the leg; reflect its decision rather than our guess.
      setScanKind(res.scan_kind);
      setLastScanKind(res.scan_kind);
      const name = res.student.full_name || res.student.student_code;
      const legEn = res.scan_kind === "check_out" ? "Checked out" : res.scan_kind === "check_in" ? "Checked in" : "Recorded";
      const legHi = res.scan_kind === "check_out" ? "निकास दर्ज" : res.scan_kind === "check_in" ? "प्रवेश दर्ज" : "दर्ज किया गया";
      if (res.duplicate) {
        if (Platform.OS !== "web") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setFeedback({
          tone: "warning",
          title: hi ? "पहले से दर्ज" : "Already scanned",
          detail: hi ? `${name} अभी-अभी दर्ज हुए हैं।` : `${name} was scanned a moment ago.`,
        });
      } else {
        if (Platform.OS !== "web") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setFeedback({
          tone: "success",
          // Naming the leg matters now that the server picks it: the volunteer
          // must be able to see that a child was checked OUT, not in.
          title: hi ? legHi : legEn,
          detail: res.was_registered === false ? (hi ? `${name} — बिना पंजीकरण` : `${name} — walk-in`) : name,
        });
      }
    },
    onError: (err) => {
      // Queued offline: the scan is safe, we just cannot name the student or
      // detect a duplicate until it syncs. Say exactly that rather than
      // reporting a failure the volunteer would try to "fix" by rescanning.
      if (err instanceof OfflineQueuedScan) {
        if (Platform.OS !== "web") {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        setLiveCount((n) => (typeof n === "number" ? n + 1 : n));
        setFeedback({
          tone: "warning",
          title: hi ? "ऑफ़लाइन सहेजा गया" : "Saved offline",
          detail: hi
            ? "नेटवर्क आने पर यह स्कैन अपने आप भेज दिया जाएगा।"
            : "This scan will be sent automatically when the network returns.",
        });
        return;
      }
      if (Platform.OS !== "web") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const code = err instanceof ApiError ? err.code : "";
      const status = err instanceof ApiError ? err.statusCode : 0;
      if (code === "ERR_SIGNATURE_INVALID" || status === 401) {
        setFeedback({
          tone: "error",
          title: hi ? "अमान्य या रद्द QR" : "Invalid or revoked QR",
          detail: hi
            ? "यह पहचान पत्र अमान्य है या रद्द कर दिया गया है। एक नया कार्ड बनवाएं।"
            : "This ID card is invalid or has been revoked. Ask for a fresh card.",
        });
      } else if (status === 404) {
        // Sessions are never deleted, so "no longer available" was always the
        // wrong story — the real cause is that this account may not act on this
        // shivir. Say the thing that is true, and what to do about it.
        setFeedback({
          tone: "error",
          title: hi ? "अनुमति नहीं" : "Not available to you",
          detail: hi
            ? "इस शिविर के लिए आपकी स्वयंसेवक अनुमति नहीं है। संचालक से कहें कि वे आपको जोड़ें।"
            : "You are not a volunteer for this shivir. Ask the Sanchalak to assign you.",
        });
      } else if (status === 422) {
        setFeedback({
          tone: "error",
          title: hi ? "मान्य नहीं" : "Not valid here",
          detail: hi
            ? "यह स्कैन प्रकार इस सत्र के लिए मान्य नहीं है।"
            : "That scan type is not valid for this session.",
        });
      } else {
        setFeedback({
          tone: "error",
          title: hi ? "स्कैन विफल" : "Scan failed",
          detail: err instanceof ApiError ? err.message : hi ? "पुनः प्रयास करें।" : "Please try again.",
        });
      }
    },
    onSettled: () => {
      // Release the lock shortly after so the same card isn't read twice from
      // back-to-back frames, but a new card scans immediately.
      setTimeout(() => {
        lockRef.current = false;
      }, 900);
    },
  });

  const onBarcode = useCallback(
    (result: BarcodeScanningResult) => {
      if (lockRef.current || scan.isPending || !sessionId) return;
      const token = extractCardToken(result.data);
      if (!token) {
        if (Platform.OS !== "web") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setFeedback({
          tone: "error",
          title: hi ? "QR पढ़ा नहीं गया" : "Unrecognised QR",
          detail: hi ? "यह एक वैध पहचान पत्र QR नहीं है।" : "That isn't a valid ID-card QR.",
        });
        return;
      }
      lockRef.current = true;
      scan.mutate(token);
    },
    [hi, scan, sessionId],
  );

  function pickSession(s: ScanSession) {
    setSessionId(s.id);
    // present_only sessions only ever record "present"; in_out defaults to check_in.
    const nextKind: ScanKind = s.attendance_mode === "present_only" ? "present" : "check_in";
    setScanKind(nextKind);
    setLiveCount(countFor(s, nextKind));
    setFeedback(null);
  }


  // ---- Loading / error / empty (scan context) ----
  if (ctx.isLoading) {
    return (
      <Screen scroll={false}>
        <StateView status="loading" emptyText="" />
      </Screen>
    );
  }
  if (ctx.isError || !ctx.data) {
    const status = ctx.error instanceof ApiError ? ctx.error.statusCode : 0;
    // 401 = not signed in; 404 = signed in but not a volunteer / in-scope admin
    // for this shivir; anything else is an unexpected load failure.
    if (status === 401) {
      return (
        <Screen scroll={false}>
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16, paddingHorizontal: 8 }}>
            <Ionicons name="log-in-outline" size={44} color={c.inkDim} />
            <Body muted style={{ textAlign: "center", maxWidth: 300 }}>
              {hi
                ? "स्कैनर का उपयोग करने के लिए कृपया स्वयंसेवक या व्यवस्थापक के रूप में साइन इन करें।"
                : "Please sign in as a volunteer or admin to use the scanner."}
            </Body>
            <Button label={hi ? "साइन इन करें" : "Sign in"} icon="log-in" onPress={() => router.push("/auth/sign-in")} />
            <Button label={hi ? "वापस जाएँ" : "Go back"} variant="ghost" onPress={() => router.back()} />
          </View>
        </Screen>
      );
    }
    const notAllowed = status === 404;
    return (
      <Screen scroll={false}>
        <StateView
          status={notAllowed ? "empty" : "error"}
          emptyText={
            hi
              ? "यह स्कैनर आपके लिए उपलब्ध नहीं है। केवल इस शिविर के स्वयंसेवक या व्यवस्थापक स्कैन कर सकते हैं।"
              : "This scanner isn't available to you. Only this shivir's volunteers or admins can scan."
          }
          errorText={hi ? "स्कैनर लोड नहीं हो सका।" : "Could not load the scanner."}
          onRetry={notAllowed ? undefined : ctx.refetch}
          retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
        />
      </Screen>
    );
  }

  const sessions = ctx.data.sessions;

  // ---- No sessions yet ----
  if (sessions.length === 0) {
    return (
      <Screen scroll={false}>
        <StateView
          status="empty"
          emptyText={
            hi
              ? "इस शिविर के लिए अभी कोई सत्र नहीं है। एक व्यवस्थापक को सत्र जोड़ना होगा।"
              : "This shivir has no sessions yet. An admin needs to add one before scanning."
          }
        />
      </Screen>
    );
  }

  // ---- Session picker (no session chosen yet) ----
  if (!selectedSession) {
    return (
      <Screen refreshing={ctx.isRefetching} onRefresh={ctx.refetch}>
        <Title style={{ fontSize: 19, marginLeft: 2 }}>{(hi ? ctx.data.shivir.name_hi : null) ?? ctx.data.shivir.name_en}</Title>
        <Body muted style={{ marginLeft: 2, marginTop: -6 }}>
          {hi ? "स्कैन करने के लिए एक सत्र चुनें" : "Pick a session to scan"}
        </Body>
        {sessions.map((s) => (
          <Pressable key={s.id} onPress={() => pickSession(s)}>
            <Card>
              <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Title style={{ fontSize: 16 }}>{s.title}</Title>
                  <Body muted style={{ marginTop: 4 }}>
                    {s.session_date}
                  </Body>
                </View>
                <Ionicons name="chevron-forward" size={20} color={c.mutedForeground} />
              </Row>
              <Row style={{ marginTop: 12, gap: 8 }}>
                {s.attendance_mode === "present_only" ? (
                  <Pill label={`${hi ? "उपस्थित" : "Present"} · ${s.present}`} tone="success" />
                ) : (
                  <>
                    <Pill label={`${hi ? "प्रवेश" : "In"} · ${s.checked_in}`} tone="info" />
                    <Pill label={`${hi ? "निकास" : "Out"} · ${s.checked_out}`} tone="neutral" />
                  </>
                )}
              </Row>
            </Card>
          </Pressable>
        ))}
      </Screen>
    );
  }

  // ---- Camera permission gate ----
  if (!permission) {
    return (
      <Screen scroll={false}>
        <StateView status="loading" emptyText="" />
      </Screen>
    );
  }
  if (!permission.granted) {
    const blocked = permission.status === "denied" && !permission.canAskAgain;
    return (
      <Screen scroll={false}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16, paddingHorizontal: 8 }}>
          <Ionicons name="camera-outline" size={44} color={c.inkDim} />
          <Body muted style={{ textAlign: "center", maxWidth: 300 }}>
            {blocked
              ? hi
                ? "कैमरा अनुमति अवरुद्ध है। QR स्कैन करने के लिए सेटिंग्स में अनुमति दें।"
                : "Camera access is blocked. Enable it in Settings to scan QR codes."
              : hi
                ? "उपस्थिति QR स्कैन करने के लिए कैमरा अनुमति चाहिए।"
                : "We need camera access to scan attendance QR codes."}
          </Body>
          {Platform.OS === "web" ? (
            <Body muted style={{ textAlign: "center" }}>
              {hi ? "कैमरा स्कैनिंग के लिए कृपया फ़ोन ऐप का उपयोग करें।" : "Please use the phone app for camera scanning."}
            </Body>
          ) : (
            <Button
              label={hi ? "कैमरा अनुमति दें" : "Allow camera"}
              icon="camera"
              onPress={() => void requestPermission()}
            />
          )}
          <Button
            label={hi ? "सत्र बदलें" : "Change session"}
            variant="ghost"
            onPress={() => setSessionId(null)}
          />
        </View>
      </Screen>
    );
  }

  // ---- Active scanner ----
  const fbTone = feedback?.tone ?? "info";
  const fbColor =
    fbTone === "success" ? c.successText : fbTone === "warning" ? c.warningText : fbTone === "error" ? c.errorText : c.mutedForeground;
  const displayCount = liveCount ?? countFor(selectedSession, scanKind);

  return (
    // Same shivir accent the browse and detail screens carry; the scanner was
    // the only screen in the flow that dropped it.
    <ActivityThemed accent="shivirs">
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <View style={{ paddingHorizontal: 18, paddingTop: 10, paddingBottom: 8, gap: 4 }}>
        <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
          <Title style={{ fontSize: 18 }}>{selectedSession.title}</Title>
          <Button label={hi ? "सत्र" : "Session"} variant="ghost" icon="swap-horizontal" onPress={() => setSessionId(null)} />
        </Row>

        {/*
          in_out mode: a STATUS LINE, not a control.
          The server decides each scan's leg from the student's last scan
          (SPEC 8.6), so there is nothing here for a volunteer to get wrong —
          and re-entry after a check-out now works, which a manual toggle could
          never express. What is shown is what the server did last.
        */}
        {selectedSession.attendance_mode === "in_out" ? (
          <Row style={{ gap: 8, marginTop: 6, alignItems: "center" }}>
            <Ionicons name="swap-vertical-outline" size={15} color={c.mutedForeground} />
            <Body muted style={{ fontSize: 13, flex: 1 }}>
              {hi
                ? "प्रवेश और निकास अपने आप तय होते हैं — बस कार्ड स्कैन करें।"
                : "Check in and check out alternate automatically — just scan the card."}
            </Body>
            {lastScanKind ? (
              <Pill
                tone={lastScanKind === "check_in" ? "success" : "info"}
                label={
                  lastScanKind === "check_in"
                    ? hi
                      ? "अंतिम: प्रवेश"
                      : "Last: in"
                    : hi
                      ? "अंतिम: निकास"
                      : "Last: out"
                }
              />
            ) : null}
          </Row>
        ) : null}

        {/* Offline queue for THIS session — queued/failed scans were invisible. */}
        {pendingScans > 0 ? (
          <Row style={{ gap: 8, marginTop: 6, alignItems: "center" }}>
            <Ionicons name="cloud-upload-outline" size={15} color={c.warningText} />
            <Body style={{ fontSize: 13, color: c.warningText }}>
              {hi
                ? `${pendingScans} स्कैन सिंक होने बाकी हैं`
                : `${pendingScans} scan${pendingScans === 1 ? "" : "s"} waiting to sync`}
            </Body>
          </Row>
        ) : null}
      </View>

      {blockedSyncOp ? (
        <View style={{ paddingHorizontal: 18, paddingBottom: 8 }}>
          <SyncOpStatus
            state={blockedSyncOp.state}
            error={blockedSyncOp.error}
            onRetry={() => {
              void retryOp(blockedSyncOp.queue, blockedSyncOp.submission_op_id).then(refreshSync);
            }}
          />
        </View>
      ) : null}

      {/* Camera viewport */}
      <View style={{ marginHorizontal: 18, borderRadius: c.radius, overflow: "hidden", aspectRatio: 1, backgroundColor: "#000" }}>
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={scan.isPending ? undefined : onBarcode}
        />
        {/* Reticle */}
        <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
          <View
            style={{
              width: "62%",
              aspectRatio: 1,
              borderWidth: 3,
              borderColor: fbTone === "success" ? c.successText : fbTone === "error" ? c.errorText : c.primaryForeground,
              borderRadius: 18,
            }}
          />
        </View>
      </View>

      {/* Live count + feedback */}
      <View style={{ paddingHorizontal: 18, paddingTop: 14, gap: 12 }}>
        <Card>
          <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
            <Body muted>
              {selectedSession.attendance_mode === "present_only"
                ? hi
                  ? "उपस्थित"
                  : "Present"
                : scanKind === "check_in"
                  ? hi
                    ? "प्रवेश किए गए"
                    : "Checked in"
                  : hi
                    ? "निकास किए गए"
                    : "Checked out"}
            </Body>
            <Numeric medium style={{ fontSize: 30, color: c.secondary }}>
              {displayCount}
            </Numeric>
          </Row>
        </Card>

        {feedback ? (
          <Card style={{ borderColor: fbColor }}>
            <Row style={{ gap: 10, alignItems: "flex-start" }}>
              <Ionicons
                name={
                  fbTone === "success"
                    ? "checkmark-circle"
                    : fbTone === "warning"
                      ? "alert-circle"
                      : fbTone === "error"
                        ? "close-circle"
                        : "information-circle"
                }
                size={22}
                color={fbColor}
              />
              <View style={{ flex: 1 }}>
                <Body style={{ color: fbColor, fontFamily: bodyFamily(hi, "semibold") }}>{feedback.title}</Body>
                <Body muted style={{ marginTop: 2 }}>
                  {feedback.detail}
                </Body>
              </View>
            </Row>
          </Card>
        ) : (
          <Body muted style={{ textAlign: "center" }}>
            {hi ? "विद्यार्थी का पहचान पत्र QR कैमरे के सामने रखें।" : "Point the camera at a student's ID-card QR."}
          </Body>
        )}
      </View>
    </View>
    </ActivityThemed>
  );
}
