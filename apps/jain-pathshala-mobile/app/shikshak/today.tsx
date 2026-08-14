import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/contexts/AuthContext";
import { useToday } from "@/lib/queries";
import type { ShikshakSessionRow } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { AppHeader, HeaderHomeActions } from "@/components/AppHeader";
import { GalleryCarousel } from "@/components/GalleryCarousel";
import { AnimatedMount } from "@/components/AnimatedMount";
import { BrowseQuickActions, ShikshakQuickActions } from "@/components/QuickActions";
import { SessionCheckIn, type SessionCheckInMode } from "@/components/SessionCheckIn";
import { SyncOpStatus } from "@/components/SyncOpStatus";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";
import { QUEUE_KEYS } from "@/lib/offline/queue-keys";
import { sessionKey } from "@/lib/offline/drain";
import { readQueue } from "@/lib/offline/storage";
import { retryOp } from "@/lib/offline/sync-engine";
import type { QueuedOp, SyncUiState } from "@/lib/offline/types";

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

function statusTone(status: string): "error" | "success" | "info" | "neutral" {
  if (status === "cancelled") return "error";
  if (status === "completed") return "success";
  if (status === "in_progress") return "info";
  return "neutral";
}

function formatCheckInTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function SessionCard({
  s,
  hi,
  onOpenCheckIn,
  onOpenCheckOut,
  syncOp,
  onRetrySync,
}: {
  s: ShikshakSessionRow & {
    batch_id?: string;
    check_in_at?: string | null;
    gps_flagged?: boolean;
    unscheduled?: boolean;
  };
  hi: boolean;
  onOpenCheckIn: () => void;
  onOpenCheckOut: () => void;
  syncOp: QueuedOp | null;
  onRetrySync: () => void;
}) {
  const c = useColors();
  const cancelled = s.status === "cancelled";
  const checkedIn = !!s.check_in_at;
  const checkInTime = formatCheckInTime(s.check_in_at);
  const batchId = s.batch_id ?? "";
  const sessionDate = s.session_date;

  const primary =
    s.status === "scheduled" && !checkedIn
      ? { kind: "start" as const }
      : s.status === "in_progress"
        ? { kind: "mark" as const }
        : s.status === "completed"
          ? { kind: "edit" as const }
          : null;

  const metaParts = [
    s.centre_name,
    formatDate(sessionDate),
    hi
      ? `${s.present_count}/${s.total_count} उपस्थित`
      : `${s.present_count}/${s.total_count} present`,
    checkInTime ? (hi ? `शुरू ${checkInTime}` : `Started ${checkInTime}`) : null,
    s.topic,
  ].filter(Boolean);

  return (
    <Card style={[{ padding: 10 }, cancelled ? { opacity: 0.7 } : undefined]}>
      <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
        <View style={{ flex: 1, paddingRight: 8 }}>
          <Title style={{ fontSize: 15, lineHeight: 20 }}>{s.batch_name ?? (hi ? "बैच" : "Batch")}</Title>
        </View>
        <Pill label={statusLabel(s.status, hi)} tone={statusTone(s.status)} />
      </Row>

      <Body muted style={{ fontSize: 11, marginTop: 4, lineHeight: 16 }} numberOfLines={2}>
        {metaParts.join(" · ")}
      </Body>

      {(s.unscheduled || s.gps_flagged) ? (
        <Row style={{ marginTop: 4, gap: 6, flexWrap: "wrap" }}>
          {s.unscheduled ? (
            <Pill label={hi ? "अनिर्धारित" : "Unscheduled"} tone="warning" />
          ) : null}
          {s.gps_flagged ? (
            <Pill label={hi ? "GPS" : "GPS"} tone="warning" />
          ) : null}
        </Row>
      ) : null}

      {syncOp && syncOp.state !== "synced" && syncOp.state !== "duplicate" ? (
        <View style={{ marginTop: 6 }}>
          <SyncOpStatus
            state={syncOp.state as SyncUiState}
            error={syncOp.last_error}
            onRetry={syncOp.state === "failed" ? onRetrySync : undefined}
            title={
              syncOp.state === "queued"
                ? hi
                  ? "कक्षा शुरू — सिंक होगी"
                  : "Class started — will sync"
                : syncOp.state === "conflict"
                  ? hi
                    ? "सत्र पहले से शुरू"
                    : "Session already started"
                  : undefined
            }
            detail={
              syncOp.state === "conflict" || syncOp.last_error?.code === "ERR_ALREADY_CHECKED_IN_BY_OTHER"
                ? hi
                  ? "किसी अन्य गुरुजी ने यह सत्र पहले ही शुरू कर दिया है। संचालक से संपर्क करें।"
                  : "Another Guruji already started this session. Contact the Sanchalak."
                : undefined
            }
          />
        </View>
      ) : null}

      {cancelled || !primary ? null : (
        <Row style={{ marginTop: 6, gap: 6 }}>
          {primary.kind === "start" ? (
            <Button
              label={hi ? "शुरू" : "Start"}
              icon="play"
              onPress={onOpenCheckIn}
              style={{ flex: 1, minWidth: 0 }}
            />
          ) : null}
          {primary.kind === "mark" || primary.kind === "edit" ? (
            <Button
              label={hi ? "उपस्थिति" : "Mark"}
              icon="checkmark-done"
              variant={primary.kind === "edit" ? "outline" : "primary"}
              onPress={() => router.push(`/attendance/${s.id}` as never)}
              style={{ flex: 1, minWidth: 0 }}
            />
          ) : null}
          {s.status === "in_progress" ? (
            <Button
              label={hi ? "समाप्त" : "End"}
              icon="stop"
              variant="outline"
              onPress={onOpenCheckOut}
              style={{ flexShrink: 0, minWidth: 0, paddingHorizontal: 12 }}
            />
          ) : null}
        </Row>
      )}

      {!cancelled && primary?.kind === "start" && batchId ? (
        <Pressable
          onPress={() => router.push(`/attendance/${s.id}` as never)}
          style={{ marginTop: 6 }}
        >
          <Row style={{ gap: 4, alignItems: "center" }}>
            <Body style={{ fontSize: 11, color: c.primary }}>
              {hi ? "बिना चेक-इन मार्क करें" : "Mark without check-in"}
            </Body>
            <Ionicons name="chevron-forward" size={12} color={c.primary} />
          </Row>
        </Pressable>
      ) : null}
    </Card>
  );
}

export default function TodayScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { user } = useAuth();
  const { data, isLoading, isError, refetch, isRefetching } = useToday();
  const items = data?.items ?? [];
  const firstName = user?.full_name?.split(" ")[0] ?? "";

  const [sheet, setSheet] = useState<{
    mode: SessionCheckInMode;
    batchId: string;
    sessionDate: string;
    batchName: string | null;
  } | null>(null);
  const [checkinOps, setCheckinOps] = useState<QueuedOp[]>([]);

  const refreshQueue = useCallback(async () => {
    const ops = await readQueue(QUEUE_KEYS.checkin);
    setCheckinOps(ops);
  }, []);

  useEffect(() => {
    void refreshQueue();
    const t = setInterval(() => void refreshQueue(), 4000);
    return () => clearInterval(t);
  }, [refreshQueue]);

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader
        title={hi ? `जय जिनेन्द्र, ${firstName}` : `Jai Jinendra, ${firstName}`}
        subtitle={hi ? "डैशबोर्ड — आज के सत्र और गुरुजी मेनू" : "Dashboard — today's sessions and Guruji menu"}
        right={
          <HeaderHomeActions
            name={user?.full_name}
            photoUrl={user?.photo_url}
            profileHref="/shikshak/profile"
          />
        }
      />
      <Screen
        refreshing={isRefetching}
        onRefresh={() => {
          void refetch();
          void refreshQueue();
        }}
        contentStyle={{ paddingBottom: 110 }}
      >
        <AnimatedMount delay={0}>
          <GalleryCarousel />
        </AnimatedMount>

        <AnimatedMount delay={40}>
          <ShikshakQuickActions />
        </AnimatedMount>

        <AnimatedMount delay={50}>
          <BrowseQuickActions />
        </AnimatedMount>

        <Title style={{ fontSize: 17, marginTop: 8, marginBottom: 4 }}>
          {hi ? "आज के सत्र" : "Today's sessions"}
        </Title>

        {isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "सत्र लोड नहीं हुए।" : "Could not load sessions."}
            onRetry={refetch}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : items.length === 0 ? (
          <StateView status="empty" emptyText={hi ? "आज कोई सत्र नहीं है।" : "No sessions today."} />
        ) : (
          items.map((s, idx) => {
            const batchId = (s as { batch_id?: string }).batch_id ?? "";
            const sessionDate = s.session_date;
            const key = batchId ? sessionKey(batchId, sessionDate) : "";
            const syncOp =
              checkinOps.find((op) => {
                const p = op.payload as { batch_id?: string; session_date?: string };
                return sessionKey(p.batch_id ?? "", p.session_date ?? "") === key;
              }) ?? null;

            return (
              <AnimatedMount key={s.id} delay={60 + idx * 40}>
                <SessionCard
                  s={s}
                  hi={hi}
                  syncOp={syncOp}
                  onOpenCheckIn={() =>
                    setSheet({
                      mode: "checkin",
                      batchId,
                      sessionDate,
                      batchName: s.batch_name,
                    })
                  }
                  onOpenCheckOut={() =>
                    setSheet({
                      mode: "checkout",
                      batchId,
                      sessionDate,
                      batchName: s.batch_name,
                    })
                  }
                  onRetrySync={() => {
                    if (syncOp) {
                      void retryOp(QUEUE_KEYS.checkin, syncOp.submission_op_id).then(refreshQueue);
                    }
                  }}
                />
              </AnimatedMount>
            );
          })
        )}
      </Screen>

      {sheet ? (
        <SessionCheckIn
          visible
          mode={sheet.mode}
          batchId={sheet.batchId}
          sessionDate={sheet.sessionDate}
          batchName={sheet.batchName}
          onClose={() => setSheet(null)}
          onSettled={() => {
            void refetch();
            void refreshQueue();
          }}
        />
      ) : null}
    </View>
  );
}
