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
  shivir: { id: string; name: string };
  sessions: ScanSession[];
}
interface ScanResult {
  student: { id: string; full_name: string | null; student_code: string };
  scan_kind: ScanKind;
  duplicate: boolean;
  count: number;
}

/** A QR may encode the combined card token (payload + signature) or — for
 * forward-compat with a bare-payload QR — just the payload JSON. We pull both
 * fields out of whatever shape we can parse; the endpoint rejects anything that
 * doesn't carry a valid signature, so we never send a guess. */
function extractCardToken(raw: string): { qr_payload: string; qr_signature: string } | null {
  const text = raw.trim();
  try {
    const obj = JSON.parse(text) as Record<string, unknown>;
    // Combined token: { qr_payload, qr_signature } (or short {p,s}).
    const payload = obj.qr_payload ?? obj.p;
    const signature = obj.qr_signature ?? obj.s;
    if (typeof payload === "string" && typeof signature === "string") {
      return { qr_payload: payload, qr_signature: signature };
    }
  } catch {
    // not JSON — fall through
  }
  return null;
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

  const scan = useMutation({
    mutationFn: async (vars: { qr_payload: string; qr_signature: string }): Promise<ScanResult> => {
      try {
        return await apiPost<ScanResult>(`/v1/shivir-scanner/sessions/${sessionId}/scan`, {
          qr_payload: vars.qr_payload,
          qr_signature: vars.qr_signature,
          scan_kind: scanKind,
        });
      } catch (err) {
        // Only a transport failure falls back to the queue. A domain rejection
        // (revoked QR, closed session, wrong scan kind) would fail identically on
        // replay, so queuing it would just defer a certain failure and lie to the
        // volunteer in the meantime.
        const isNetwork = err instanceof ApiError && err.code === "ERR_NETWORK";
        if (!isNetwork) throw err;

        const { enqueueShivirScan } = await import("@/lib/offline/sync-engine");
        await enqueueShivirScan({
          shivir_session_id: sessionId!,
          qr_payload: vars.qr_payload,
          qr_signature: vars.qr_signature,
          scan_kind: scanKind,
        });
        // Deliberately NOT drained here: the sync loop owns delivery, so there is
        // exactly one retry mechanism (CLAUDE.md offline sync §4).
        throw new OfflineQueuedScan();
      }
    },
    onSuccess: (res) => {
      setLiveCount(res.count);
      const name = res.student.full_name || res.student.student_code;
      if (res.duplicate) {
        if (Platform.OS !== "web") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setFeedback({
          tone: "warning",
          title: hi ? "पहले से दर्ज" : "Already scanned",
          detail: hi ? `${name} इस सत्र में पहले ही दर्ज है।` : `${name} was already recorded for this session.`,
        });
      } else {
        if (Platform.OS !== "web") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setFeedback({
          tone: "success",
          title: hi ? "दर्ज किया गया" : "Recorded",
          detail: name,
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
        setFeedback({
          tone: "error",
          title: hi ? "उपलब्ध नहीं" : "Not available",
          detail: hi
            ? "यह सत्र अब उपलब्ध नहीं है। कृपया पुनः खोलें।"
            : "This session is no longer available. Please reopen the scanner.",
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

  function switchKind(kind: ScanKind) {
    setScanKind(kind);
    if (selectedSession) setLiveCount(countFor(selectedSession, kind));
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
        <Title style={{ fontSize: 19, marginLeft: 2 }}>{ctx.data.shivir.name}</Title>
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
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <View style={{ paddingHorizontal: 18, paddingTop: 10, paddingBottom: 8, gap: 4 }}>
        <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
          <Title style={{ fontSize: 18 }}>{selectedSession.title}</Title>
          <Button label={hi ? "सत्र" : "Session"} variant="ghost" icon="swap-horizontal" onPress={() => setSessionId(null)} />
        </Row>

        {/* Scan-kind toggle (in_out sessions only) */}
        {selectedSession.attendance_mode === "in_out" ? (
          <Row style={{ gap: 10, marginTop: 4 }}>
            {(["check_in", "check_out"] as const).map((k) => {
              const active = scanKind === k;
              return (
                <Pressable
                  key={k}
                  onPress={() => switchKind(k)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    borderRadius: 999,
                    backgroundColor: active ? c.primary : c.muted,
                  }}
                >
                  <Ionicons
                    name={k === "check_in" ? "log-in-outline" : "log-out-outline"}
                    size={16}
                    color={active ? c.primaryForeground : c.mutedForeground}
                  />
                  <Body style={{ color: active ? c.primaryForeground : c.mutedForeground, fontFamily: bodyFamily(hi, "semibold"), fontSize: 13 }}>
                    {k === "check_in" ? (hi ? "प्रवेश" : "Check in") : hi ? "निकास" : "Check out"}
                  </Body>
                </Pressable>
              );
            })}
          </Row>
        ) : null}
      </View>

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
              borderColor: fbTone === "success" ? c.successText : fbTone === "error" ? c.errorText : "rgba(255,255,255,0.85)",
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
  );
}
