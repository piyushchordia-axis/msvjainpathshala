/**
 * Shikshak attendance-marking screen.
 *
 * Flow: load today's session roster (GET /v1/attendance/sessions/:id), toggle
 * each student present / absent / late / excused, then submit
 * (POST /v1/attendance/sessions/:id/mark). For a gps_required session the
 * device's GPS is captured via expo-location (permission flow + graceful
 * denial) and sent so the server can haversine-check it against the centre
 * geofence; the screen surfaces the success + the enforced method (gps vs
 * manual) and, on a geofence rejection, an "outside centre" message.
 *
 * Authorization + geofencing are enforced server-side (in-scope admin/shikshak
 * for the session's centre); an out-of-scope session 404s and renders as a
 * friendly "not available" state.
 */
import { useMemo, useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import {
  useAttendanceSession,
  useMarkAttendance,
  type AttendanceMark,
} from "@/lib/queries";
import { ApiError } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { bodyFamily } from "@/constants/typography";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

/** The four states a shikshak can set per student. present/late count toward
 * the present tally on the server's session list. */
const MARKS: { value: AttendanceMark; en: string; hi: string; tone: "success" | "error" | "warning" | "info" }[] = [
  { value: "present", en: "Present", hi: "उपस्थित", tone: "success" },
  { value: "absent", en: "Absent", hi: "अनुपस्थित", tone: "error" },
  { value: "late", en: "Late", hi: "विलंब", tone: "warning" },
  { value: "excused", en: "Excused", hi: "अनुमति", tone: "info" },
];

type Feedback =
  | { tone: "success"; title: string; detail: string }
  | { tone: "error"; title: string; detail: string }
  | null;

export default function AttendanceMarkScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { id } = useLocalSearchParams<{ id: string }>();

  const detail = useAttendanceSession(id);
  const mark = useMarkAttendance();

  // studentId -> chosen status. Seeded lazily from the roster once it loads so
  // a previously-marked session opens with its existing marks visible.
  const [marks, setMarks] = useState<Record<string, AttendanceMark>>({});
  const [seeded, setSeeded] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [locating, setLocating] = useState(false);

  const session = detail.data?.session ?? null;
  const roster = useMemo(() => detail.data?.roster ?? [], [detail.data]);

  // One-time seed of any pre-existing marks from the roster.
  if (!seeded && detail.data) {
    const initial: Record<string, AttendanceMark> = {};
    for (const r of roster) if (r.status) initial[r.student_id] = r.status;
    setMarks(initial);
    setSeeded(true);
  }

  const markedCount = Object.keys(marks).length;
  const allMarked = roster.length > 0 && markedCount === roster.length;
  const gpsNeeded = !!session?.gps_required;

  function setStudentMark(studentId: string, value: AttendanceMark) {
    setFeedback(null);
    setMarks((prev) => ({ ...prev, [studentId]: value }));
  }

  function setAll(value: AttendanceMark) {
    setFeedback(null);
    const next: Record<string, AttendanceMark> = {};
    for (const r of roster) next[r.student_id] = value;
    setMarks(next);
  }

  /** Capture device GPS for a geofenced session. Returns null on denial/failure
   * (with feedback already set) so the caller can abort the submit. */
  async function captureLocation(): Promise<{ lat: number; lng: number } | null> {
    if (Platform.OS === "web") {
      // expo-location web uses the browser geolocation API; still attempt it,
      // but surface a clear message if it's unavailable.
    }
    setLocating(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        const blocked = !perm.canAskAgain;
        setFeedback({
          tone: "error",
          title: hi ? "स्थान अनुमति चाहिए" : "Location needed",
          detail: blocked
            ? hi
              ? "स्थान अनुमति अवरुद्ध है। इस सत्र की उपस्थिति दर्ज करने के लिए सेटिंग्स में अनुमति दें।"
              : "Location access is blocked. Enable it in Settings to mark attendance for this session."
            : hi
              ? "इस सत्र के लिए स्थान अनुमति आवश्यक है।"
              : "This session requires your location to mark attendance.",
        });
        return null;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      return { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch {
      setFeedback({
        tone: "error",
        title: hi ? "स्थान नहीं मिला" : "Couldn't get location",
        detail: hi
          ? "आपका स्थान प्राप्त नहीं हो सका। GPS चालू करें और पुनः प्रयास करें।"
          : "We couldn't read your location. Turn on GPS and try again.",
      });
      return null;
    } finally {
      setLocating(false);
    }
  }

  async function submit() {
    if (!session || roster.length === 0 || markedCount === 0) return;
    setFeedback(null);

    let coords: { lat: number; lng: number } | undefined;
    if (gpsNeeded) {
      const got = await captureLocation();
      if (!got) return; // feedback already shown
      coords = got;
    }

    const records = Object.entries(marks).map(([student_id, status]) => ({
      student_id,
      status,
    }));

    mark.mutate(
      { sessionId: session.id, records, lat: coords?.lat, lng: coords?.lng },
      {
        onSuccess: (res) => {
          if (Platform.OS !== "web") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setFeedback({
            tone: "success",
            title: hi ? "उपस्थिति दर्ज हुई" : "Attendance saved",
            detail:
              res.method === "gps"
                ? hi
                  ? `${res.marked} विद्यार्थी दर्ज — केंद्र की सीमा के भीतर सत्यापित (GPS)।`
                  : `${res.marked} student(s) marked — verified inside the centre geofence (GPS).`
                : hi
                  ? `${res.marked} विद्यार्थी दर्ज (मैन्युअल)।`
                  : `${res.marked} student(s) marked (manual).`,
          });
        },
        onError: (err) => {
          if (Platform.OS !== "web") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          const code = err instanceof ApiError ? err.code : "";
          if (code === "ERR_FORBIDDEN" && gpsNeeded) {
            setFeedback({
              tone: "error",
              title: hi ? "केंद्र की सीमा के बाहर" : "Outside the centre",
              detail: hi
                ? "आप केंद्र की निर्धारित सीमा के बाहर हैं। उपस्थिति दर्ज करने के लिए केंद्र पर पहुँचें।"
                : "You're outside the centre's allowed radius. Move to the centre to mark attendance.",
            });
          } else {
            setFeedback({
              tone: "error",
              title: hi ? "दर्ज नहीं हो सका" : "Couldn't save",
              detail: err instanceof ApiError ? err.message : hi ? "पुनः प्रयास करें।" : "Please try again.",
            });
          }
        },
      },
    );
  }

  // ---- Loading / error / not-available ----
  if (detail.isLoading) {
    return (
      <Screen scroll={false}>
        <StateView status="loading" emptyText="" />
      </Screen>
    );
  }
  if (detail.isError || !session) {
    const notAllowed = detail.error instanceof ApiError && detail.error.statusCode === 404;
    return (
      <Screen scroll={false}>
        <StateView
          status={notAllowed ? "empty" : "error"}
          emptyText={
            hi
              ? "यह सत्र आपके लिए उपलब्ध नहीं है।"
              : "This session isn't available to you."
          }
          errorText={hi ? "सत्र लोड नहीं हो सका।" : "Could not load the session."}
          onRetry={notAllowed ? undefined : detail.refetch}
          retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
        />
      </Screen>
    );
  }

  const cancelled = session.status === "cancelled";
  const fbColor =
    feedback?.tone === "success" ? c.successText : feedback?.tone === "error" ? c.errorText : c.mutedForeground;

  return (
    <Screen refreshing={detail.isRefetching} onRefresh={detail.refetch}>
      {/* Session header */}
      <Card>
        <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Title style={{ fontSize: 18 }}>{session.batch_name ?? (hi ? "बैच" : "Batch")}</Title>
            {session.centre_name ? (
              <Body muted style={{ fontSize: 12, marginTop: 2 }}>{session.centre_name}</Body>
            ) : null}
          </View>
          <Pill label={session.status} tone={cancelled ? "error" : "neutral"} />
        </Row>
        <Body muted style={{ fontSize: 13, marginTop: 8 }}>{formatDate(session.session_date)}</Body>
        {session.topic ? <Body style={{ marginTop: 6 }}>{session.topic}</Body> : null}
        <Row style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
          <Pill
            label={`${markedCount} / ${roster.length} ${hi ? "चिह्नित" : "marked"}`}
            tone={allMarked ? "success" : "neutral"}
          />
          {gpsNeeded ? (
            <Pill
              label={
                session.has_gps
                  ? hi ? "GPS आवश्यक" : "GPS required"
                  : hi ? "GPS आवश्यक (केंद्र अकॉन्फ़िगर्ड)" : "GPS required (centre unconfigured)"
              }
              tone="info"
            />
          ) : null}
        </Row>
      </Card>

      {cancelled ? (
        <StateView
          status="empty"
          emptyText={hi ? "यह सत्र रद्द कर दिया गया है — उपस्थिति दर्ज नहीं की जा सकती।" : "This session is cancelled — attendance can't be marked."}
        />
      ) : roster.length === 0 ? (
        <StateView
          status="empty"
          emptyText={hi ? "इस बैच में कोई सक्रिय विद्यार्थी नहीं है।" : "This batch has no active students."}
        />
      ) : (
        <>
          {/* Bulk helpers */}
          <Row style={{ gap: 10, flexWrap: "wrap" }}>
            <Button
              label={hi ? "सभी उपस्थित" : "Mark all present"}
              icon="checkmark-done"
              variant="outline"
              onPress={() => setAll("present")}
              style={{ flex: 1, minWidth: 150 }}
            />
            <Button
              label={hi ? "सभी अनुपस्थित" : "Mark all absent"}
              icon="close"
              variant="ghost"
              onPress={() => setAll("absent")}
              style={{ flex: 1, minWidth: 150 }}
            />
          </Row>

          {/* Roster */}
          {roster.map((r) => {
            const current = marks[r.student_id];
            return (
              <Card key={r.student_id}>
                <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Title style={{ fontSize: 16 }}>{r.full_name ?? r.student_code}</Title>
                    <Body muted style={{ fontSize: 12, marginTop: 2 }}>{r.student_code}</Body>
                  </View>
                </Row>
                <Row style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                  {MARKS.map((m) => {
                    const on = current === m.value;
                    const onColor =
                      m.tone === "success" ? c.successText : m.tone === "error" ? c.errorText : m.tone === "warning" ? c.warningText : c.infoText;
                    return (
                      <Pressable
                        key={m.value}
                        onPress={() => setStudentMark(r.student_id, m.value)}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 6,
                          borderWidth: 1,
                          borderColor: on ? onColor : c.border,
                          backgroundColor: on ? c.accent : c.card,
                          borderRadius: 999,
                          paddingVertical: 8,
                          paddingHorizontal: 12,
                        }}
                      >
                        <Ionicons
                          name={on ? "radio-button-on" : "radio-button-off"}
                          size={16}
                          color={on ? onColor : c.inkDim}
                        />
                        <Body style={{ fontSize: 13, color: on ? onColor : c.foreground, fontFamily: bodyFamily(hi, "semibold") }}>
                          {hi ? m.hi : m.en}
                        </Body>
                      </Pressable>
                    );
                  })}
                </Row>
              </Card>
            );
          })}

          {/* Feedback */}
          {feedback ? (
            <Card style={{ borderColor: fbColor }}>
              <Row style={{ gap: 10, alignItems: "flex-start" }}>
                <Ionicons
                  name={feedback.tone === "success" ? "checkmark-circle" : "close-circle"}
                  size={22}
                  color={fbColor}
                />
                <View style={{ flex: 1 }}>
                  <Body style={{ color: fbColor, fontFamily: bodyFamily(hi, "semibold") }}>{feedback.title}</Body>
                  <Body muted style={{ marginTop: 2 }}>{feedback.detail}</Body>
                </View>
              </Row>
            </Card>
          ) : null}

          {gpsNeeded ? (
            <Body muted style={{ fontSize: 12, textAlign: "center" }}>
              {hi
                ? "जमा करने पर आपका स्थान कैप्चर किया जाएगा और केंद्र की सीमा से मिलान किया जाएगा।"
                : "Your location is captured on submit and checked against the centre geofence."}
            </Body>
          ) : null}

          <Button
            label={
              feedback?.tone === "success"
                ? hi ? "पुनः जमा करें" : "Save again"
                : gpsNeeded
                  ? hi ? "स्थान लें और जमा करें" : "Capture location & save"
                  : hi ? "उपस्थिति जमा करें" : "Save attendance"
            }
            icon={gpsNeeded ? "location" : "save"}
            loading={locating || mark.isPending}
            disabled={markedCount === 0}
            onPress={() => void submit()}
          />
          {feedback?.tone === "success" ? (
            <Button
              label={hi ? "आज के सत्र पर वापस जाएँ" : "Back to today's sessions"}
              icon="arrow-back"
              variant="ghost"
              onPress={() => router.back()}
            />
          ) : null}
        </>
      )}
    </Screen>
  );
}
