import { Ionicons } from "@expo/vector-icons";
import { Linking, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/contexts/AuthContext";
import { useSessionView } from "@/contexts/SessionViewContext";
import { apiGet, apiPost } from "@/lib/api";
import { AppHeader, ProfileAvatarButton } from "@/components/AppHeader";
import { Body, Button, Card, Pill, Row, Screen, StateView, Title } from "@/components/ui";

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  pdf: "document-text-outline",
  video: "play-circle-outline",
  audio: "musical-notes-outline",
  image: "image-outline",
};

interface LibraryItem {
  id: string;
  content_type: "pdf" | "video" | "audio" | "image";
  title_en: string;
  title_hi?: string | null;
  description_en?: string | null;
  description_hi?: string | null;
  embed_url?: string | null;
  file_url?: string | null;
  /** Member feed resolves a single delivery URL; the public feed does not. */
  url?: string | null;
  access_tier?: "public" | "student" | "msv" | "shikshak";
}

const TIER_LABEL: Record<string, { en: string; hi: string }> = {
  student: { en: "Members", hi: "सदस्य" },
  msv: { en: "MSV", hi: "MSV" },
  shikshak: { en: "Teachers", hi: "शिक्षक" },
};

/** Per-content-type call-to-action label. */
function actionLabel(type: string, hi: boolean): string {
  if (type === "video") return hi ? "देखें" : "Watch";
  if (type === "audio") return hi ? "सुनें" : "Listen";
  if (type === "pdf") return hi ? "पढ़ें" : "Read";
  return hi ? "खोलें" : "Open";
}

function deliveryUrl(it: LibraryItem): string | null {
  return it.url ?? it.file_url ?? it.embed_url ?? null;
}

/**
 * Digital-library screen. When the caller is signed in it reads the tiered
 * member feed (`/v1/library`, which includes file_url/embed_url so every item
 * is deliverable); otherwise it falls back to the public feed. An open/play/
 * download action is rendered for ALL content types, not just video.
 */
export default function StudentLibrary() {
  const c = useColors();
  const { hi } = useLocale();
  const { user } = useAuth();
  const { activeChild } = useSessionView();
  const authed = !!user;

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["library", authed ? "member" : "public"],
    queryFn: () =>
      authed
        ? apiGet<{ items: LibraryItem[] }>("/v1/library?limit=80")
        : apiGet<{ items: LibraryItem[] }>("/v1/public/library?limit=60"),
  });
  const items = data?.items ?? [];

  async function open(item: LibraryItem) {
    const fallback = deliveryUrl(item);
    // Members: log the access and re-resolve a fresh URL in one round-trip.
    if (authed) {
      try {
        const res = await apiPost<{ url?: string }>(`/v1/library/${item.id}/access`, {});
        const url = res?.url ?? fallback;
        if (url) await Linking.openURL(url);
        return;
      } catch {
        /* fall through to the fallback URL below */
      }
    }
    if (fallback) await Linking.openURL(fallback);
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppHeader
        title={hi ? "पुस्तकालय" : "Digital library"}
        subtitle={hi ? "ग्रंथ, वीडियो और श्रव्य सामग्री" : "Scriptures, videos and audio resources"}
        right={
          <ProfileAvatarButton
            name={activeChild?.full_name ?? user?.full_name}
            photoUrl={activeChild?.photo_url}
            href="/student/profile"
          />
        }
      />
      <Screen refreshing={isRefetching} onRefresh={refetch} contentStyle={{ paddingBottom: 110 }}>
        {isLoading ? (
          <StateView status="loading" emptyText="" />
        ) : isError ? (
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "पुस्तकालय लोड नहीं हुआ।" : "Could not load the library."}
            onRetry={refetch}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        ) : items.length === 0 ? (
          <StateView status="empty" emptyText={hi ? "अभी कोई संसाधन नहीं है।" : "No resources available yet."} />
        ) : (
          items.map((item) => {
            const title = hi && item.title_hi ? item.title_hi : item.title_en;
            const desc = hi && item.description_hi ? item.description_hi : item.description_en;
            const icon = ICONS[item.content_type] ?? "document-outline";
            const url = deliveryUrl(item);
            const tier = item.access_tier && item.access_tier !== "public" ? TIER_LABEL[item.access_tier] : null;
            return (
              <Card key={item.id}>
                <Row style={{ gap: 12 }}>
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 10,
                      backgroundColor: c.accent,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons name={icon} size={22} color={c.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Title style={{ fontSize: 16 }}>{title}</Title>
                    <Row style={{ marginTop: 4, gap: 6 }}>
                      <Pill label={item.content_type.toUpperCase()} />
                      {tier ? <Pill label={hi ? tier.hi : tier.en} tone="warning" /> : null}
                    </Row>
                  </View>
                </Row>
                {desc ? (
                  <Body muted style={{ marginTop: 10 }}>
                    {desc}
                  </Body>
                ) : null}
                {url ? (
                  <Button
                    label={actionLabel(item.content_type, hi)}
                    icon="open-outline"
                    variant="outline"
                    onPress={() => open(item)}
                    style={{ marginTop: 12 }}
                  />
                ) : (
                  <Body muted style={{ marginTop: 12, fontSize: 13 }}>
                    {hi ? "सामग्री शीघ्र उपलब्ध होगी।" : "Content coming soon."}
                  </Body>
                )}
              </Card>
            );
          })
        )}
      </Screen>
    </View>
  );
}
