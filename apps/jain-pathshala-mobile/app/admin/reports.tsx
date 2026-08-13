/**
 * Sanchalak monthly centre reports — generate PDF, poll until ready, share on WhatsApp.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Platform, Pressable, View } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";
import { resolveUploadUrl, ApiError } from "@/lib/api";
import {
  useAdminCentres,
  useCentreMonthlyReports,
  useGenerateCentreMonthlyReport,
  type CentreMonthlyReportRow,
} from "@/lib/queries";
import { AppHeader } from "@/components/AppHeader";
import { CentreSwitcher, usePersistedCentreId } from "@/components/CentreSwitcher";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

const CENTRE_KEY = "jp.sanchalak.selectedCentreId";

function currentMonthIst(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).slice(0, 7);
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y!, (m ?? 1) - 1 + delta, 1);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}`;
}

function monthLabel(ym: string, hi: boolean): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y!, (m ?? 1) - 1, 1);
  return d.toLocaleDateString(hi ? "hi-IN" : "en-IN", { month: "long", year: "numeric" });
}

function statusTone(
  status: string,
): "neutral" | "success" | "warning" | "error" {
  switch (status) {
    case "ready":
      return "success";
    case "generating":
    case "queued":
      return "warning";
    case "failed":
      return "error";
    default:
      return "neutral";
  }
}

function statusLabel(status: string, hi: boolean): string {
  switch (status) {
    case "ready":
      return hi ? "तैयार" : "Ready";
    case "generating":
    case "queued":
      return hi ? "बन रहा है…" : "Generating…";
    case "failed":
      return hi ? "विफल" : "Failed";
    default:
      return status;
  }
}

async function shareReportPdf(row: CentreMonthlyReportRow, hi: boolean) {
  const url = resolveUploadUrl(row.pdf_url);
  if (!url) {
    Alert.alert(hi ? "त्रुटि" : "Error", hi ? "PDF उपलब्ध नहीं।" : "PDF is not available yet.");
    return;
  }
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.open(url, "_blank");
    return;
  }
  const available = await Sharing.isAvailableAsync();
  if (!available) {
    Alert.alert(
      hi ? "साझा नहीं हो सकता" : "Sharing unavailable",
      hi ? "इस डिवाइस पर शेयर शीट उपलब्ध नहीं।" : "Share sheet is not available on this device.",
    );
    return;
  }
  const dest = `${FileSystem.cacheDirectory}centre-report-${row.month}-${row.id.slice(0, 8)}.pdf`;
  const downloaded = await FileSystem.downloadAsync(url, dest);
  await Sharing.shareAsync(downloaded.uri, {
    mimeType: "application/pdf",
    dialogTitle: hi ? "मासिक रिपोर्ट साझा करें" : "Share monthly report",
    UTI: "com.adobe.pdf",
  });
}

export default function ReportsScreen() {
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
  const maxMonth = currentMonthIst();
  const [month, setMonth] = useState(maxMonth);
  const reportsQ = useCentreMonthlyReports(selectedCentreId, month);
  const generateMut = useGenerateCentreMonthlyReport();
  const pendingJobId = useRef<string | null>(null);

  const items = reportsQ.data?.items ?? [];
  const generating = items.some((r) => r.status === "queued" || r.status === "generating");

  useEffect(() => {
    const jobId = pendingJobId.current;
    if (!jobId) return;
    const row = items.find((r) => r.id === jobId);
    if (!row) return;
    if (row.status === "ready" && row.pdf_url) {
      pendingJobId.current = null;
      void shareReportPdf(row, hi).catch((e) =>
        Alert.alert(hi ? "त्रुटि" : "Error", e instanceof Error ? e.message : "Share failed"),
      );
    } else if (row.status === "failed") {
      pendingJobId.current = null;
      Alert.alert(
        hi ? "रिपोर्ट विफल" : "Report failed",
        row.error_message ?? (hi ? "PDF नहीं बन सकी।" : "Could not build the PDF."),
      );
    }
  }, [items, hi]);

  function stepMonth(delta: number) {
    const next = shiftMonth(month, delta);
    if (next > maxMonth) return;
    setMonth(next);
  }

  function onGenerate() {
    if (!selectedCentreId) return;
    generateMut.mutate(
      { centreId: selectedCentreId, month },
      {
        onSuccess: (data) => {
          pendingJobId.current = data.job_id;
        },
        onError: (e) =>
          Alert.alert(
            hi ? "त्रुटि" : "Error",
            e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed",
          ),
      },
    );
  }

  return (
    <ActivityThemed accent="reports">
      <AppHeader
        title={hi ? "रिपोर्ट" : "Reports"}
        subtitle={hi ? "केंद्र मासिक PDF" : "Centre monthly PDF"}
      />
      <Screen
        refreshing={centresQ.isRefetching || reportsQ.isRefetching}
        onRefresh={() => {
          void centresQ.refetch();
          void reportsQ.refetch();
        }}
      >
        <CentreSwitcher
          centres={centres}
          storageKey={CENTRE_KEY}
          selectedId={selectedCentreId}
          onChange={pickCentre}
        />

        <Card style={{ marginTop: 4 }}>
          <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
            <Pressable
              onPress={() => stepMonth(-1)}
              accessibilityLabel={hi ? "पिछला माह" : "Previous month"}
              style={{ padding: 8 }}
            >
              <Ionicons name="chevron-back" size={22} color={c.primary} />
            </Pressable>
            <Title style={{ fontSize: 16, lineHeight: 22 }}>{monthLabel(month, hi)}</Title>
            <Pressable
              onPress={() => stepMonth(1)}
              disabled={month >= maxMonth}
              accessibilityLabel={hi ? "अगला माह" : "Next month"}
              style={{ padding: 8, opacity: month >= maxMonth ? 0.35 : 1 }}
            >
              <Ionicons name="chevron-forward" size={22} color={c.primary} />
            </Pressable>
          </Row>
          <Button
            label={
              generateMut.isPending || generating
                ? hi
                  ? "बन रहा है…"
                  : "Generating…"
                : hi
                  ? "रिपोर्ट बनाएँ"
                  : "Generate report"
            }
            onPress={onGenerate}
            disabled={!selectedCentreId || generateMut.isPending || generating}
            loading={generateMut.isPending || generating}
            style={{ marginTop: 12 }}
          />
          {generating ? (
            <Body muted style={{ marginTop: 10, lineHeight: 22 }}>
              {hi
                ? "PDF तैयार हो रही है — पूरा होने पर व्हाट्सऐप शेयर खुल जाएगा।"
                : "Building the PDF — the share sheet opens when it is ready."}
            </Body>
          ) : null}
        </Card>

        <Title style={{ marginTop: 18, marginBottom: 8, fontSize: 15, lineHeight: 22 }}>
          {hi ? "इस माह की रिपोर्टें" : "Reports for this month"}
        </Title>

        {reportsQ.isLoading ? <StateView status="loading" emptyText="" /> : null}
        {reportsQ.isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={
              reportsQ.error instanceof Error ? reportsQ.error.message : "Could not load reports"
            }
            onRetry={() => void reportsQ.refetch()}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : null}
        {!reportsQ.isLoading && !reportsQ.isError && items.length === 0 ? (
          <StateView
            status="empty"
            emptyText={
              hi ? "अभी कोई रिपोर्ट नहीं — ऊपर से बनाएँ।" : "No reports yet — generate one above."
            }
          />
        ) : null}

        {items.map((row) => (
          <Card key={row.id} style={{ marginBottom: 10 }}>
            <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
              <Body style={{ fontWeight: "600" }}>{row.month}</Body>
              <Pill label={statusLabel(row.status, hi)} tone={statusTone(row.status)} />
            </Row>
            {row.error_message ? (
              <Body muted style={{ marginTop: 6, lineHeight: 20, color: c.errorText }}>
                {row.error_message}
              </Body>
            ) : null}
            {row.status === "ready" && row.pdf_url ? (
              <Button
                variant="outline"
                label={hi ? "साझा करें" : "Share"}
                onPress={() =>
                  void shareReportPdf(row, hi).catch((e) =>
                    Alert.alert(
                      hi ? "त्रुटि" : "Error",
                      e instanceof Error ? e.message : "Share failed",
                    ),
                  )
                }
                style={{ marginTop: 10 }}
              />
            ) : null}
          </Card>
        ))}
      </Screen>
    </ActivityThemed>
  );
}
