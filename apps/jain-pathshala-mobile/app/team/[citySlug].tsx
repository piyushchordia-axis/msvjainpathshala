import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, Stack } from "expo-router";
import { Pressable, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";
import { apiGet, apiGetEnvelope } from "@/lib/api";
import { TeamMemberCard, type TeamCardModel } from "@/components/TeamMemberCard";
import { Body, Card, Row, Screen, StateView, Title } from "@/components/ui";
import { TEAM_PUBLIC_CITY_SLUG } from "@jp/shared/constants";

type CentreBlock = {
  id: string;
  name: string;
  members: TeamCardModel[];
};

type CityCategory = {
  id: string;
  key: string;
  name_en: string;
  name_hi: string;
  group_by: string;
  is_lazy_loaded: boolean;
  member_count: number;
  members: TeamCardModel[];
  centres: CentreBlock[];
  next_cursor: string | null;
};

type CityPayload = {
  city: { id: string; slug: string; name: string; state_name: string };
  categories: CityCategory[];
};

function MemberGrid({
  members,
  hi,
  variant = "default",
}: {
  members: TeamCardModel[];
  hi: boolean;
  variant?: "default" | "core";
}) {
  const rows: TeamCardModel[][] = [];
  for (let i = 0; i < members.length; i += 2) {
    rows.push(members.slice(i, i + 2));
  }
  return (
    <View style={{ gap: 12 }}>
      {rows.map((row) => (
        <View key={row.map((m) => m.id).join("-")} style={{ flexDirection: "row", gap: 12 }}>
          {row.map((m) => (
            <View key={m.id} style={{ flex: 1 }}>
              <TeamMemberCard member={m} hi={hi} variant={variant} />
            </View>
          ))}
          {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
        </View>
      ))}
    </View>
  );
}

/**
 * City Team page — GET /v1/team/cities/:citySlug
 * Gurujis & Didis load further centres via cursor (not accordion).
 */
export default function TeamCityScreen() {
  const c = useColors();
  const { hi } = useLocale();
  const { citySlug } = useLocalSearchParams<{ citySlug?: string }>();
  const slug = String(citySlug ?? "");
  const slugBlocked = Boolean(TEAM_PUBLIC_CITY_SLUG) && slug !== TEAM_PUBLIC_CITY_SLUG;

  const { data, isLoading, isError, refetch, isRefetching, error } = useQuery({
    queryKey: ["team", "city", slug],
    queryFn: () => apiGet<CityPayload>(`/v1/team/cities/${encodeURIComponent(slug)}`),
    enabled: !!slug && !slugBlocked,
    retry: false,
  });

  const [shikshakCentres, setShikshakCentres] = useState<CentreBlock[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadLock = useRef(false);

  useEffect(() => {
    if (!data) return;
    const shik = data.categories.find((cat) => cat.key === "shikshak");
    setShikshakCentres(shik?.centres ?? []);
    setNextCursor(shik?.next_cursor ?? null);
  }, [data]);

  const loadMore = useCallback(async () => {
    if (!slug || !nextCursor || loadLock.current) return;
    loadLock.current = true;
    setLoadingMore(true);
    try {
      const env = await apiGetEnvelope<{ centres: CentreBlock[] }>(
        `/v1/team/cities/${encodeURIComponent(slug)}/shikshaks?cursor=${encodeURIComponent(nextCursor)}`,
      );
      const batch = env.data.centres ?? [];
      setShikshakCentres((prev) => {
        const seen = new Set(prev.map((centre) => centre.id));
        return [...prev, ...batch.filter((centre) => !seen.has(centre.id))];
      });
      setNextCursor(
        typeof env.meta?.next_cursor === "string" ? env.meta.next_cursor : null,
      );
    } finally {
      setLoadingMore(false);
      loadLock.current = false;
    }
  }, [slug, nextCursor]);

  const notFound =
    slugBlocked ||
    (isError &&
      error instanceof Error &&
      "statusCode" in error &&
      (error as { statusCode?: number }).statusCode === 404);

  if (isLoading && !slugBlocked) {
    return (
      <ActivityThemed accent="shikshaks">
        <Screen scroll={false}>
          <StateView status="loading" emptyText="" />
        </Screen>
      </ActivityThemed>
    );
  }

  if (notFound) {
    return (
      <ActivityThemed accent="shikshaks">
        <Stack.Screen options={{ title: hi ? "टीम" : "Team" }} />
        <Screen scroll={false}>
          <StateView
            status="empty"
            emptyText={
              hi
                ? "यह शहर नहीं मिला, या यहाँ अभी कोई प्रकाशित टीम सदस्य नहीं है।"
                : "City not found, or it has no published Team members yet."
            }
          />
        </Screen>
      </ActivityThemed>
    );
  }

  if (isError || !data) {
    return (
      <ActivityThemed accent="shikshaks">
        <Screen scroll={false}>
          <StateView
            status="error"
            emptyText=""
            errorText={hi ? "टीम लोड नहीं हो सकी।" : "Could not load this city team."}
            onRetry={refetch}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        </Screen>
      </ActivityThemed>
    );
  }

  return (
    <ActivityThemed accent="shikshaks">
      <Stack.Screen
        options={{
          title: data.city.name,
        }}
      />
      <Screen refreshing={isRefetching} onRefresh={refetch}>
        <Title style={{ fontSize: 24 }}>{data.city.name}</Title>
        <Body muted style={{ marginTop: 4, lineHeight: 20 }}>
          {data.city.state_name}
        </Body>

        <View style={{ marginTop: 20, gap: 28 }}>
          {data.categories.map((cat) => {
            const isCore = cat.key === "core_team";
            const title = hi ? cat.name_hi : cat.name_en;
            const isCentreGrouped = cat.group_by === "centre" || cat.key === "shikshak";
            const centres = isCentreGrouped ? shikshakCentres : cat.centres;
            const flat = cat.members;
            const count = cat.member_count;

            if (!isCentreGrouped && flat.length === 0) return null;
            if (isCentreGrouped && centres.length === 0 && !nextCursor) return null;

            return (
              <View key={cat.id} style={{ gap: 14 }}>
                <Row style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                  <Title style={{ fontSize: 20, flex: 1 }}>{title}</Title>
                  {count > 0 ? (
                    <Body muted style={{ fontSize: 12 }}>
                      {count} {hi ? "सदस्य" : count === 1 ? "member" : "members"}
                    </Body>
                  ) : null}
                </Row>

                {isCentreGrouped ? (
                  <View style={{ gap: 22 }}>
                    {centres.map((centre) => (
                      <View key={centre.id} style={{ gap: 10 }}>
                        <Title style={{ fontSize: 16 }}>{centre.name}</Title>
                        <MemberGrid members={centre.members} hi={hi} />
                      </View>
                    ))}

                    {nextCursor ? (
                      <Pressable
                        onPress={() => void loadMore()}
                        disabled={loadingMore}
                        style={({ pressed }) => ({
                          opacity: loadingMore || pressed ? 0.65 : 1,
                          borderWidth: 1,
                          borderColor: c.border,
                          backgroundColor: c.card,
                          borderRadius: 10,
                          paddingVertical: 12,
                          paddingHorizontal: 16,
                          alignItems: "center",
                        })}
                      >
                        <Body style={{ color: c.secondary, fontSize: 14 }}>
                          {loadingMore
                            ? hi
                              ? "लोड हो रहा है…"
                              : "Loading…"
                            : hi
                              ? "और केंद्र देखें"
                              : "Load more centres"}
                        </Body>
                      </Pressable>
                    ) : null}
                  </View>
                ) : (
                  <MemberGrid members={flat} hi={hi} variant={isCore ? "core" : "default"} />
                )}
              </View>
            );
          })}
        </View>
      </Screen>
    </ActivityThemed>
  );
}
