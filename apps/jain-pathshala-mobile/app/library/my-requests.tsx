/**
 * My library requests — Section 17 v3 §17.10.4.
 *
 * Guests see their device-scoped list; a member sees theirs. After first login
 * the server has re-keyed the device's rows to the account, so the guest
 * history simply appears here — there is deliberately no "claim my requests"
 * action for the reader to find and press.
 */
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { t, type Locale } from "@workspace/i18n";

import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/contexts/AuthContext";
import { fetchMyLibraryRequests, type LibraryContentRequest, type LibraryRequestStatus } from "@/lib/library/requests";
import { Body, Button, Card, Row, Screen, StateView, Title } from "@/components/ui";

function tr(locale: Locale, key: string, vars?: Record<string, string>): string {
  return t(`libraryRequests.${key}`, locale, vars);
}

function statusLabel(status: LibraryRequestStatus, locale: Locale): string {
  if (status === "accepted") return tr(locale, "statusAccepted");
  if (status === "rejected") return tr(locale, "statusRejected");
  if (status === "published") return tr(locale, "statusPublished");
  return tr(locale, "statusPending");
}

function StatusChip({ status, locale }: { status: LibraryRequestStatus; locale: Locale }) {
  const c = useColors();
  // Rejected is the only muted-negative state; published is the only success.
  // Pending and accepted both read as "in hand", which is what they are.
  const palette: Record<LibraryRequestStatus, { bg: string; fg: string }> = {
    pending: { bg: c.muted, fg: c.mutedForeground },
    accepted: { bg: c.accent, fg: c.accentForeground },
    published: { bg: c.accent, fg: c.primary },
    rejected: { bg: c.muted, fg: c.destructive },
  };
  const p = palette[status];
  return (
    <View
      style={{
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
        backgroundColor: p.bg,
      }}
    >
      <Body style={{ fontSize: 12, lineHeight: 22, color: p.fg }}>{statusLabel(status, locale)}</Body>
    </View>
  );
}

function formatDate(iso: string, hi: boolean): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(hi ? "hi-IN" : "en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function MyLibraryRequestsScreen() {
  const c = useColors();
  const { locale } = useLocale();
  const hi = locale === "hi";
  const { user } = useAuth();

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    // Keyed on the account so signing in refetches under the new identity and
    // the re-keyed history appears without the reader doing anything.
    queryKey: ["library-requests", "mine", user?.id ?? "guest"],
    queryFn: fetchMyLibraryRequests,
  });

  const requests = data ?? [];

  return (
    <Screen refreshing={isRefetching} onRefresh={refetch} contentStyle={{ paddingBottom: 110 }}>
      <Title style={{ fontSize: 20 }}>{tr(locale, "myTitle")}</Title>
      <Body muted style={{ marginTop: 4, marginBottom: 12 }}>
        {tr(locale, "mySubtitle")}
      </Body>

      {isLoading ? (
        <StateView status="loading" emptyText="" />
      ) : isError ? (
        <StateView
          status="error"
          emptyText=""
          errorText={tr(locale, "loadFailed")}
          onRetry={() => void refetch()}
          retryLabel={tr(locale, "tryAgain")}
        />
      ) : requests.length === 0 ? (
        <View>
          <StateView status="empty" emptyText={tr(locale, "empty")} />
          <Body muted style={{ textAlign: "center", marginTop: -8, marginBottom: 16 }}>
            {tr(locale, "emptyHint")}
          </Body>
          <Button
            label={tr(locale, "action")}
            icon="add-circle-outline"
            onPress={() => router.push("/library/request" as Href)}
          />
        </View>
      ) : (
        requests.map((r: LibraryContentRequest) => {
          const sectionName = hi
            ? r.section_name_hi || r.section_name_en
            : r.section_name_en || r.section_name_hi;
          return (
            <Card key={r.id}>
              <Row style={{ gap: 8, alignItems: "flex-start" }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Title style={{ fontSize: 16, lineHeight: 22 }}>{r.title}</Title>
                  <Body muted style={{ marginTop: 4, fontSize: 12 }}>
                    {tr(locale, "requestedOn", { date: formatDate(r.created_at, hi) })}
                    {sectionName ? ` · ${sectionName}` : ""}
                    {!sectionName && r.suggested_section
                      ? ` · ${tr(locale, "suggestedSectionChip", { name: r.suggested_section })}`
                      : ""}
                  </Body>
                </View>
                <StatusChip status={r.status} locale={locale} />
              </Row>

              <Body muted style={{ marginTop: 8, fontSize: 13 }}>
                {r.details}
              </Body>

              {r.admin_note ? (
                <View
                  style={{
                    marginTop: 12,
                    padding: 10,
                    borderRadius: c.radius,
                    backgroundColor: c.muted,
                  }}
                >
                  <Body style={{ fontSize: 12, color: c.mutedForeground }}>
                    {tr(locale, "adminNoteLabel")}
                  </Body>
                  <Body style={{ marginTop: 4, fontSize: 13 }}>{r.admin_note}</Body>
                </View>
              ) : null}

              {/*
                Deep-link by item, not by section+item: a request filed under
                "Other" has no section_id, and keying the link on one would hide
                the tap-through on exactly the requests that were hardest to
                place — the ones the reader most wants to be shown.
              */}
              {r.status === "published" && r.linked_item_id ? (
                <View style={{ marginTop: 12 }}>
                  <Button
                    label={tr(locale, "openItem")}
                    icon="open-outline"
                    variant="outline"
                    compact
                    onPress={() => router.push(`/library/item/${r.linked_item_id}` as Href)}
                  />
                </View>
              ) : null}

              {r.status !== "published" ? (
                <Row style={{ marginTop: 10, gap: 6, alignItems: "center" }}>
                  <Ionicons
                    name={r.status === "rejected" ? "information-circle-outline" : "time-outline"}
                    size={14}
                    color={c.mutedForeground}
                  />
                  <Body muted style={{ fontSize: 12 }}>
                    {r.status === "accepted"
                      ? tr(locale, "statusAcceptedHint")
                      : r.status === "pending"
                        ? tr(locale, "statusPendingHint")
                        : ""}
                  </Body>
                </Row>
              ) : (
                <Body muted style={{ marginTop: 10, fontSize: 12 }}>
                  {tr(locale, "statusPublishedHint")}
                </Body>
              )}
            </Card>
          );
        })
      )}
    </Screen>
  );
}
