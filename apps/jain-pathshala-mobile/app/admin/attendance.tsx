/**
 * Sanchalak read-only centre attendance monitor — observe and phone; Guruji marks.
 */
import { useMemo, useState, type ReactNode } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";
import { bodyFamily } from "@/constants/typography";
import { formatDate, formatTimeRange } from "@/lib/format";
import {
  useAdminCentres,
  useAttendanceAlerts,
  useCentreSessionDetail,
  useCentreTodaySessions,
  type CentreTodaySession,
} from "@/lib/queries";
import { AppHeader } from "@/components/AppHeader";
import { CentreSwitcher, usePersistedCentreId } from "@/components/CentreSwitcher";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

const CENTRE_KEY = "jp.sanchalak.selectedCentreId";

function todayIst(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shiftDate(ymd: string, delta: number): string {
  const d = new Date(`${ymd}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T12:00:00.000Z`) - Date.parse(`${a}T12:00:00.000Z`);
  return Math.round(ms / 86_400_000);
}

function statusLabel(status: string, hi: boolean): string {
  switch (status) {
    case "scheduled":
      return hi ? "निर्धारित" : "Scheduled";
    case "in_progress":
      return hi ? "चल रहा है" : "In progress";
    case "completed":
      return hi ? "समाप्त" : "Completed";
    case "cancelled":
      return hi ? "रद्द" : "Cancelled";
    default:
      return status;
  }
}

function statusTone(status: string): "error" | "success" | "info" | "neutral" | "warning" {
  if (status === "cancelled") return "error";
  if (status === "completed") return "success";
  if (status === "in_progress") return "info";
  if (status === "scheduled") return "neutral";
  return "neutral";
}

function markLabel(status: string | null | undefined, hi: boolean): string {
  switch (status) {
    case "present":
      return hi ? "उपस्थित" : "Present";
    case "absent":
      return hi ? "अनुपस्थित" : "Absent";
    case "late":
      return hi ? "देर से" : "Late";
    case "excused":
      return hi ? "क्षमा" : "Excused";
    default:
      return hi ? "अचिह्नित" : "Not marked";
  }
}

function checkInBadge(
  s: { check_in_at?: string | null; gps_flagged?: boolean },
  hi: boolean,
): { label: string; tone: "success" | "warning" | "neutral" | "error" } {
  if (s.gps_flagged) {
    return { label: hi ? "GPS चेतावनी" : "GPS flagged", tone: "warning" };
  }
  if (s.check_in_at) {
    return { label: hi ? "चेक-इन" : "Checked in", tone: "success" };
  }
  return { label: hi ? "चेक-इन नहीं" : "Not checked in", tone: "neutral" };
}

function CollapsibleGroup({
  title,
  count,
  children,
  tone = "neutral",
}: {
  title: string;
  count: number;
  children: ReactNode;
  tone?: "warning" | "neutral" | "info";
}) {
  const c = useColors();
  const { hi } = useLocale();
  const [open, setOpen] = useState(false);
  if (count === 0) return null;
  const bg =
    tone === "warning" ? c.muted : tone === "info" ? c.muted : c.muted;
  return (
    <Card style={{ backgroundColor: bg }}>
      <Pressable onPress={() => setOpen((v) => !v)}>
        <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
          <Title style={{ fontSize: 15, lineHeight: 22, flex: 1, paddingRight: 8 }}>
            {title}
          </Title>
          <Pill label={String(count)} tone={tone === "warning" ? "warning" : "neutral"} />
          <Ionicons
            name={open ? "chevron-up" : "chevron-down"}
            size={18}
            color={c.mutedForeground}
            style={{ marginLeft: 8 }}
          />
        </Row>
      </Pressable>
      {open ? <View style={{ marginTop: 10, gap: 8 }}>{children}</View> : null}
      {!open ? (
        <Body muted style={{ fontSize: 12, lineHeight: 22, marginTop: 4 }}>
          {hi ? "विवरण के लिए टैप करें" : "Tap to expand"}
        </Body>
      ) : null}
    </Card>
  );
}

function SessionDetail({
  centreId,
  sessionId,
  date,
  onBack,
}: {
  centreId: string;
  sessionId: string;
  date: string;
  onBack: () => void;
}) {
  const c = useColors();
  const { hi } = useLocale();
  const detail = useCentreSessionDetail(centreId, sessionId, date);
  const session = detail.data?.items?.[0];

  return (
    <View style={{ flex: 1 }}>
      <AppHeader
        title={session?.batch_name ?? (hi ? "रोस्टर" : "Roster")}
        subtitle={hi ? "केवल पढ़ने योग्य" : "Read-only"}
        right={
          <Pressable onPress={onBack} hitSlop={12}>
            <Text
              style={{
                color: c.primary,
                fontFamily: bodyFamily(hi, "semibold"),
                fontSize: 15,
                lineHeight: 22,
              }}
            >
              {hi ? "वापस" : "Back"}
            </Text>
          </Pressable>
        }
      />
      <Screen refreshing={detail.isRefetching} onRefresh={() => void detail.refetch()}>
        {detail.isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : detail.isError || !session ? (
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "रोस्टर लोड नहीं हुआ।" : "Could not load the roster."}
            onRetry={() => void detail.refetch()}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : (
          <>
            <Card>
              <Row style={{ justifyContent: "space-between", gap: 8 }}>
                <Title style={{ fontSize: 17, lineHeight: 24, flex: 1 }}>
                  {session.batch_name}
                </Title>
                <Pill
                  label={statusLabel(session.status, hi)}
                  tone={statusTone(session.status)}
                />
              </Row>
              <Body muted style={{ marginTop: 6, lineHeight: 22 }}>
                {formatDate(session.session_date ?? session.scheduled_date ?? date)}
                {session.scheduled_start_time
                  ? ` · ${formatTimeRange(session.scheduled_start_time, session.scheduled_end_time ?? null)}`
                  : ""}
              </Body>
              <Body muted style={{ marginTop: 4, lineHeight: 22 }}>
                {hi
                  ? `${session.present_count}/${session.total_count} उपस्थित`
                  : `${session.present_count}/${session.total_count} present`}
              </Body>
            </Card>
            {(session.roster ?? []).length === 0 ? (
              <StateView
                status="empty"
                emptyText={hi ? "कोई विद्यार्थी नहीं।" : "No students in this roster."}
              />
            ) : (
              (session.roster ?? []).map((r) => (
                <Card key={r.student_id}>
                  <Row style={{ justifyContent: "space-between" }}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Title style={{ fontSize: 16, lineHeight: 24 }}>
                        {r.full_name ?? "—"}
                      </Title>
                      {r.student_code ? (
                        <Body muted style={{ fontSize: 12, lineHeight: 22 }}>
                          {r.student_code}
                        </Body>
                      ) : null}
                    </View>
                    <Pill
                      label={markLabel(r.status, hi)}
                      tone={
                        r.status === "present" || r.status === "late"
                          ? "success"
                          : r.status === "absent"
                            ? "error"
                            : "neutral"
                      }
                    />
                  </Row>
                </Card>
              ))
            )}
          </>
        )}
      </Screen>
    </View>
  );
}

export default function AdminAttendanceScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const centresQ = useAdminCentres();
  const centres = useMemo(
    () =>
      (centresQ.data?.items ?? []).map((x) => ({
        centre_id: x.id,
        centre_name: x.name,
      })),
    [centresQ.data?.items],
  );
  const [selectedCentreId, pickCentre] = usePersistedCentreId(centres, CENTRE_KEY);
  const today = todayIst();
  const [date, setDate] = useState(today);
  const daysBack = daysBetween(date, today);
  const canGoForward = daysBack > 0;
  const canGoBack = daysBack < 7;

  const alertsQ = useAttendanceAlerts(selectedCentreId, date);
  const sessionsQ = useCentreTodaySessions(selectedCentreId, date);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const alerts = alertsQ.data?.data;
  const meta = alertsQ.data?.meta as
    | {
        consecutive_absence_count?: number;
        unmarked_count?: number;
        gps_flagged_count?: number;
        not_checked_in_count?: number;
        alert_count?: number;
      }
    | undefined;

  if (selectedCentreId && selectedSessionId) {
    return (
      <ActivityThemed accent="attendance">
        <SessionDetail
          centreId={selectedCentreId}
          sessionId={selectedSessionId}
          date={date}
          onBack={() => setSelectedSessionId(null)}
        />
      </ActivityThemed>
    );
  }

  const sessions = sessionsQ.data?.items ?? [];
  const consecutive = alerts?.consecutive_absences ?? [];
  const hasAlertStrip =
    consecutive.length > 0 ||
    (meta?.unmarked_count ?? 0) > 0 ||
    (meta?.gps_flagged_count ?? 0) > 0 ||
    (meta?.not_checked_in_count ?? 0) > 0;

  return (
    <ActivityThemed accent="attendance">
      <AppHeader
        title={hi ? "उपस्थिति" : "Attendance"}
        subtitle={hi ? "केंद्र मॉनिटर — केवल अवलोकन" : "Centre monitor — observe only"}
      />
      <Screen
        refreshing={alertsQ.isRefetching || sessionsQ.isRefetching}
        onRefresh={() => {
          void alertsQ.refetch();
          void sessionsQ.refetch();
        }}
      >
        <CentreSwitcher
          centres={centres}
          storageKey={CENTRE_KEY}
          selectedId={selectedCentreId}
          onChange={pickCentre}
        />

        <Row style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <Pressable
            disabled={!canGoBack}
            onPress={() => setDate((d) => shiftDate(d, -1))}
            hitSlop={10}
            style={{ opacity: canGoBack ? 1 : 0.35, padding: 8 }}
          >
            <Ionicons name="chevron-back" size={22} color={c.primary} />
          </Pressable>
          <Title style={{ fontSize: 16, lineHeight: 24 }}>
            {date === today ? (hi ? "आज" : "Today") : formatDate(date)}
          </Title>
          <Pressable
            disabled={!canGoForward}
            onPress={() => setDate((d) => shiftDate(d, 1))}
            hitSlop={10}
            style={{ opacity: canGoForward ? 1 : 0.35, padding: 8 }}
          >
            <Ionicons name="chevron-forward" size={22} color={c.primary} />
          </Pressable>
        </Row>

        {!selectedCentreId ? (
          <StateView
            status="empty"
            emptyText={hi ? "कोई केंद्र नहीं मिला।" : "No centres found."}
          />
        ) : alertsQ.isLoading && sessionsQ.isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : alertsQ.isError && sessionsQ.isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "उपस्थिति लोड नहीं हुई।" : "Could not load attendance."}
            onRetry={() => {
              void alertsQ.refetch();
              void sessionsQ.refetch();
            }}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : (
          <>
            {hasAlertStrip ? (
              <View style={{ gap: 10, marginBottom: 8 }}>
                {consecutive.map((row) => (
                  <Card key={row.student_id}>
                    <Title style={{ fontSize: 16, lineHeight: 24 }}>{row.student_name}</Title>
                    <Body muted style={{ marginTop: 4, lineHeight: 22 }}>
                      {[row.batch_name, hi ? "लगातार 3 सत्र अनुपस्थित" : "Absent 3 sessions in a row"]
                        .filter(Boolean)
                        .join(" · ")}
                    </Body>
                    {row.last_attended_date ? (
                      <Body muted style={{ marginTop: 2, fontSize: 12, lineHeight: 22 }}>
                        {hi ? "अंतिम उपस्थिति: " : "Last attended: "}
                        {formatDate(row.last_attended_date)}
                      </Body>
                    ) : null}
                    {row.parent_phone ? (
                      <Button
                        label={hi ? "अभिभावक को कॉल करें" : "Call parent"}
                        icon="call-outline"
                        style={{ marginTop: 12 }}
                        onPress={() => {
                          const tel = row.parent_phone!.startsWith("+")
                            ? row.parent_phone!
                            : `+${row.parent_phone!.replace(/\D/g, "")}`;
                          void Linking.openURL(`tel:${tel}`);
                        }}
                      />
                    ) : (
                      <Body muted style={{ marginTop: 8, lineHeight: 22 }}>
                        {hi ? "अभिभावक का फ़ोन उपलब्ध नहीं।" : "Parent phone not available."}
                      </Body>
                    )}
                  </Card>
                ))}

                <CollapsibleGroup
                  title={hi ? "अचिह्नित सत्र" : "Not marked"}
                  count={meta?.unmarked_count ?? alerts?.unmarked_sessions.length ?? 0}
                  tone="warning"
                >
                  {(alerts?.unmarked_sessions ?? []).map((s) => (
                    <Body key={s.id} style={{ lineHeight: 22 }}>
                      {s.batch_name}
                      {s.scheduled_end_time ? ` · ${String(s.scheduled_end_time).slice(0, 5)}` : ""}
                    </Body>
                  ))}
                </CollapsibleGroup>

                <CollapsibleGroup
                  title={hi ? "GPS चेतावनी" : "GPS flagged"}
                  count={meta?.gps_flagged_count ?? alerts?.gps_flagged_sessions.length ?? 0}
                  tone="warning"
                >
                  {(alerts?.gps_flagged_sessions ?? []).map((s) => (
                    <Body key={s.id} style={{ lineHeight: 22 }}>
                      {s.batch_name}
                    </Body>
                  ))}
                </CollapsibleGroup>

                <CollapsibleGroup
                  title={hi ? "चेक-इन नहीं" : "Not checked in"}
                  count={
                    meta?.not_checked_in_count ?? alerts?.not_checked_in_sessions.length ?? 0
                  }
                  tone="neutral"
                >
                  {(alerts?.not_checked_in_sessions ?? []).map((s) => (
                    <Body key={s.id} muted style={{ lineHeight: 22 }}>
                      {s.batch_name}
                    </Body>
                  ))}
                </CollapsibleGroup>
              </View>
            ) : null}

            <Title style={{ fontSize: 16, marginBottom: 8, lineHeight: 24 }}>
              {hi ? "आज के सत्र" : "Sessions"}
            </Title>
            {sessionsQ.isLoading ? (
              <StateView status="loading" emptyText="" />
            ) : sessions.length === 0 ? (
              <StateView
                status="empty"
                emptyText={hi ? "इस दिन कोई सत्र नहीं।" : "No sessions on this day."}
              />
            ) : (
              sessions.map((s: CentreTodaySession) => {
                const badge = checkInBadge(s, hi);
                return (
                  <Pressable key={s.id} onPress={() => setSelectedSessionId(s.id)}>
                    <Card>
                      <Row style={{ justifyContent: "space-between", gap: 8 }}>
                        <View style={{ flex: 1, paddingRight: 8 }}>
                          <Title style={{ fontSize: 16, lineHeight: 24 }}>
                            {s.batch_name ?? (hi ? "बैच" : "Batch")}
                          </Title>
                          <Body muted style={{ marginTop: 4, fontSize: 13, lineHeight: 22 }}>
                            {s.scheduled_start_time
                              ? formatTimeRange(
                                  s.scheduled_start_time,
                                  s.scheduled_end_time ?? null,
                                )
                              : formatDate(s.session_date)}
                            {s.conducted_by_name
                              ? ` · ${s.conducted_by_name}`
                              : ""}
                          </Body>
                        </View>
                        <Pill
                          label={statusLabel(s.status, hi)}
                          tone={statusTone(s.status)}
                        />
                      </Row>
                      <Row style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
                        <Pill
                          tone="info"
                          label={
                            hi
                              ? `${s.present_count}/${s.total_count} उपस्थित`
                              : `${s.present_count}/${s.total_count} present`
                          }
                        />
                        <Pill label={badge.label} tone={badge.tone} />
                      </Row>
                    </Card>
                  </Pressable>
                );
              })
            )}
          </>
        )}
      </Screen>
    </ActivityThemed>
  );
}
