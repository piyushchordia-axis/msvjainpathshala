import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, type Href } from "expo-router";
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { ActivityThemed } from "@/contexts/ActivityThemeContext";
import { apiGet } from "@/lib/api";
import { TeamMemberCard, type TeamCardModel } from "@/components/TeamMemberCard";
import { Body, Card, Row, Screen, StateView, Title } from "@/components/ui";
import { TEAM_PUBLIC_CITY_SLUG } from "@jp/shared/constants";

type TeamCategoryBlock = {
  id: string;
  key: string;
  name_en: string;
  name_hi: string;
  member_count: number;
  members: TeamCardModel[];
  states: Array<{
    state_id: string;
    state_name: string;
    members: TeamCardModel[];
  }>;
};

type CityIndexRow = {
  id: string;
  slug: string;
  name: string;
  state_name: string;
  member_count: number;
};

type TeamPayload = {
  categories: TeamCategoryBlock[];
  cities: CityIndexRow[];
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
 * National Team directory — GET /v1/team.
 * Cities link into /team/[citySlug].
 */
export default function TeamScreen() {
  const c = useColors();
  const router = useRouter();
  const { hi } = useLocale();
  const launchSlug = TEAM_PUBLIC_CITY_SLUG;

  useEffect(() => {
    if (!launchSlug) return;
    router.replace(`/team/${launchSlug}` as Href);
  }, [launchSlug, router]);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["team", "national"],
    queryFn: () => apiGet<TeamPayload>("/v1/team"),
    enabled: !launchSlug,
  });

  if (launchSlug) {
    return (
      <ActivityThemed accent="shikshaks">
        <Screen scroll={false}>
          <StateView status="loading" emptyText="" />
        </Screen>
      </ActivityThemed>
    );
  }

  if (isLoading) {
    return (
      <ActivityThemed accent="shikshaks">
        <Screen scroll={false}>
          <StateView status="loading" emptyText="" />
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
            errorText={
              hi
                ? "टीम अभी लोड नहीं हो सकी — थोड़ी देर बाद फिर कोशिश करें।"
                : "The Team page could not load — try again in a moment."
            }
            onRetry={refetch}
            retryLabel={hi ? "पुनः प्रयास करें" : "Try again"}
          />
        </Screen>
      </ActivityThemed>
    );
  }

  const empty = data.categories.length === 0 && data.cities.length === 0;

  return (
    <ActivityThemed accent="shikshaks">
      <Screen refreshing={isRefetching} onRefresh={refetch}>
        <Title style={{ fontSize: 26 }}>{hi ? "हमारी टीम" : "Our Team"}</Title>
        <Body muted style={{ marginTop: 6, lineHeight: 22 }}>
          {hi
            ? "राष्ट्रीय नेतृत्व, राज्य समन्वय, और आपके शहर की पाठशाला टीम।"
            : "National leadership, state coordination, and the Pathshala team in your city."}
        </Body>

        {empty ? (
          <Card style={{ marginTop: 16 }}>
            <Body muted>
              {hi ? "अभी कोई टीम सदस्य प्रकाशित नहीं है।" : "No Team members are published yet."}
            </Body>
          </Card>
        ) : (
          <View style={{ marginTop: 20, gap: 28 }}>
            {data.categories.map((cat) => {
              const isCore = cat.key === "core_team";
              const title = hi ? cat.name_hi : cat.name_en;
              const hasNational = cat.members.length > 0;
              const stateBlocks = cat.states.filter((s) => s.members.length > 0);
              if (!hasNational && stateBlocks.length === 0) return null;

              return (
                <View key={cat.id} style={{ gap: 14 }}>
                  <Row style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                    <Title style={{ fontSize: 20, flex: 1 }}>{title}</Title>
                    {cat.member_count > 0 ? (
                      <Body muted style={{ fontSize: 12 }}>
                        {cat.member_count}{" "}
                        {hi ? "सदस्य" : cat.member_count === 1 ? "member" : "members"}
                      </Body>
                    ) : null}
                  </Row>

                  {hasNational ? (
                    <MemberGrid members={cat.members} hi={hi} variant={isCore ? "core" : "default"} />
                  ) : null}

                  {stateBlocks.map((state) => (
                    <View key={state.state_id} style={{ gap: 10 }}>
                      <Title style={{ fontSize: 16 }}>{state.state_name}</Title>
                      <MemberGrid
                        members={state.members}
                        hi={hi}
                        variant={isCore ? "core" : "default"}
                      />
                    </View>
                  ))}
                </View>
              );
            })}

            {data.cities.length > 0 ? (
              <View style={{ gap: 12 }}>
                <Title style={{ fontSize: 20 }}>{hi ? "शहर की टीमें" : "City teams"}</Title>
                <Body muted style={{ lineHeight: 20 }}>
                  {hi
                    ? "अपने शहर की संचालक और गुरुजी/दीदी टीम देखें।"
                    : "See Sanchalaks and Gurujis & Didis in your city."}
                </Body>
                <Card style={{ padding: 0, overflow: "hidden", backgroundColor: c.creamDark }}>
                  {data.cities.map((city, i) => (
                    <Pressable
                      key={city.id}
                      onPress={() => router.push(`/team/${city.slug}` as Href)}
                    >
                      {({ pressed }) => (
                        <Row
                          style={{
                            paddingVertical: 16,
                            paddingHorizontal: 16,
                            opacity: pressed ? 0.7 : 1,
                            backgroundColor: pressed ? c.accent : "transparent",
                            borderBottomWidth: i < data.cities.length - 1 ? 1 : 0,
                            borderBottomColor: c.border,
                          }}
                        >
                          <View style={{ flex: 1 }}>
                            <Body style={{ fontSize: 15 }}>{city.name}</Body>
                            <Body muted style={{ fontSize: 12, marginTop: 2 }}>
                              {city.state_name}
                              {city.member_count > 0
                                ? ` · ${city.member_count} ${hi ? "सदस्य" : city.member_count === 1 ? "member" : "members"}`
                                : ""}
                            </Body>
                          </View>
                          <Ionicons name="chevron-forward" size={18} color={c.inkDim} />
                        </Row>
                      )}
                    </Pressable>
                  ))}
                </Card>
              </View>
            ) : null}
          </View>
        )}
      </Screen>
    </ActivityThemed>
  );
}
