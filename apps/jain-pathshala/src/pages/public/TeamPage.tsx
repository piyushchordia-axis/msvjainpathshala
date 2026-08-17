import { useEffect, useMemo, useState } from "react";
import { Link, Redirect } from "wouter";
import { Card } from "@/components/ui/card";
import { useLocale } from "@/lib/locale-context";
import { GuestError } from "@/components/public/GuestLoadState";
import { TEAM_PUBLIC_CITY_SLUG } from "@jp/shared/constants";
import {
  TeamMemberCard,
  useTeamJsonLd,
  type TeamCardModel,
} from "@/components/public/TeamMemberCard";

type TeamCategoryBlock = {
  id: string;
  key: string;
  name_en: string;
  name_hi: string;
  display_style: string;
  group_by: string;
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

function pickCategoryTitle(cat: TeamCategoryBlock, hi: boolean): string {
  return hi ? cat.name_hi : cat.name_en;
}

function collectPersons(categories: TeamCategoryBlock[], hi: boolean) {
  const people: Array<{
    "@type": "Person";
    name: string;
    jobTitle?: string;
    image?: string;
  }> = [];
  for (const cat of categories) {
    const all = [
      ...cat.members,
      ...cat.states.flatMap((s) => s.members),
    ];
    for (const m of all) {
      const name = hi ? m.name_hi : m.name_en;
      const job = hi ? m.designation_hi : m.designation_en;
      const image = m.photo_url || undefined;
      people.push({
        "@type": "Person",
        name: m.honorific ? `${m.honorific} ${name}` : name,
        ...(job ? { jobTitle: job } : {}),
        ...(image ? { image } : {}),
      });
    }
  }
  return people;
}

/**
 * National Team directory — GET /v1/team.
 * (Vite SPA: page cache is client-side; API serves Cache-Control max-age=3600.)
 * When TEAM_PUBLIC_CITY_SLUG is set, /team opens that city page instead.
 */
export default function TeamPage() {
  if (TEAM_PUBLIC_CITY_SLUG) {
    return <Redirect to={`/team/${TEAM_PUBLIC_CITY_SLUG}`} />;
  }
  return <NationalTeamPage />;
}

function NationalTeamPage() {
  const locale = useLocale();
  const hi = locale === "hi";
  const [data, setData] = useState<TeamPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetch("/v1/team", { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("team fetch failed"))))
      .then((json: { data?: TeamPayload }) => {
        if (!cancelled) setData(json.data ?? { categories: [], cities: [] });
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const jsonLd = useMemo(() => {
    if (!data) return null;
    const persons = collectPersons(data.categories, hi);
    return {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "ItemList",
          name: hi ? "टीम" : "Team",
          description: hi
            ? "मेघ संस्कार वाटिका जैन पाठशाला टीम"
            : "Megh Sanskar Vatika Jain Pathshala Team",
          numberOfItems: persons.length,
          itemListElement: persons.map((p, i) => ({
            "@type": "ListItem",
            position: i + 1,
            item: p,
          })),
        },
        ...persons,
      ],
    };
  }, [data, hi]);

  useTeamJsonLd(jsonLd);

  return (
    <section className="container py-12 md:py-16">
      <p className="text-sm font-medium uppercase tracking-[0.18em] text-primary">
        {hi ? "टीम" : "Team"}
      </p>
      <h1
        className="mt-3 font-display text-4xl text-secondary md:text-5xl"
        style={{ lineHeight: "1.25" }}
      >
        {hi ? "हमारी टीम" : "Our Team"}
      </h1>
      <p
        className="mt-4 max-w-2xl text-muted-foreground"
        style={{ lineHeight: "22px" }}
      >
        {hi
          ? "राष्ट्रीय नेतृत्व, राज्य समन्वय, और आपके शहर की पाठशाला टीम — एक ही स्थान पर।"
          : "National leadership, state coordination, and the Pathshala team in your city — in one place."}
      </p>

      {loading ? (
        <div className="mt-10 text-muted-foreground" style={{ lineHeight: "22px" }}>
          {hi ? "लोड हो रहा है…" : "Loading…"}
        </div>
      ) : error ? (
        <GuestError
          hi={hi}
          what="the team"
          whatHi="टीम"
          onRetry={() => setReloadKey((k) => k + 1)}
        />
      ) : !data || (data.categories.length === 0 && data.cities.length === 0) ? (
        <Card className="mt-10 p-6 text-muted-foreground" style={{ lineHeight: "22px" }}>
          {hi ? "अभी कोई टीम सदस्य प्रकाशित नहीं है।" : "No Team members are published yet."}
        </Card>
      ) : (
        <div className="mt-12 space-y-16">
          {data.categories.map((cat, catIndex) => {
            const isCore = cat.key === "core_team";
            const title = pickCategoryTitle(cat, hi);
            const hasNational = cat.members.length > 0;
            const hasStates = cat.states.some((s) => s.members.length > 0);
            if (!hasNational && !hasStates) return null;

            // First category row is LCP (Core Team in default seed order).
            const priorityRow = catIndex === 0;
            const gridClass = isCore
              ? "mt-6 grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
              : "mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

            return (
              <section key={cat.id} aria-labelledby={`team-cat-${cat.id}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h2
                    id={`team-cat-${cat.id}`}
                    className="font-display text-2xl text-secondary md:text-3xl"
                    style={{ lineHeight: "1.3" }}
                  >
                    {title}
                  </h2>
                  {cat.member_count > 0 ? (
                    <span className="text-xs font-medium uppercase tracking-[0.14em] text-ink-sub">
                      {cat.member_count}{" "}
                      {hi
                        ? "सदस्य"
                        : cat.member_count === 1
                          ? "member"
                          : "members"}
                    </span>
                  ) : null}
                </div>

                {hasNational ? (
                  <div className={gridClass}>
                    {cat.members.map((m) => (
                      <TeamMemberCard
                        key={m.id}
                        member={m}
                        locale={locale}
                        priority={priorityRow}
                        variant={isCore ? "core" : "default"}
                      />
                    ))}
                  </div>
                ) : null}

                {hasStates
                  ? cat.states.map((st) =>
                      st.members.length === 0 ? null : (
                        <div key={st.state_id} className="mt-10">
                          {/* State name is a heading only — no state route. */}
                          <h3
                            className="font-display text-xl text-secondary"
                            style={{ lineHeight: "22px" }}
                          >
                            {st.state_name}
                          </h3>
                          <div className={isCore ? "mt-4 grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" : "mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"}>
                            {st.members.map((m) => (
                              <TeamMemberCard
                                key={m.id}
                                member={m}
                                locale={locale}
                                priority={false}
                                variant={isCore ? "core" : "default"}
                              />
                            ))}
                          </div>
                        </div>
                      ),
                    )
                  : null}
              </section>
            );
          })}

          {data.cities.length > 0 ? (
            <section aria-labelledby="team-city-index">
              <h2
                id="team-city-index"
                className="font-display text-2xl text-secondary md:text-3xl"
                style={{ lineHeight: "1.3" }}
              >
                {hi ? "शहर के अनुसार" : "By city"}
              </h2>
              <p
                className="mt-2 max-w-2xl text-sm text-muted-foreground"
                style={{ lineHeight: "22px" }}
              >
                {hi
                  ? "जिन शहरों में प्रकाशित टीम सदस्य हैं, वे यहाँ सूचीबद्ध हैं।"
                  : "Only cities with published Team members are listed."}
              </p>
              <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.cities.map((city) => (
                  <li key={city.id}>
                    <Link href={`/team/${city.slug}`}>
                      <Card className="flex h-full cursor-pointer flex-col gap-1 border-border/80 bg-cream-dark p-4 transition-shadow hover:bg-accent hover:shadow-md sm:p-5">
                        <span
                          className="font-display text-lg text-secondary"
                          style={{ lineHeight: "22px" }}
                        >
                          {city.name}
                        </span>
                        <span
                          className="text-xs text-ink-sub"
                          style={{ lineHeight: "22px" }}
                        >
                          {city.state_name}
                          {city.member_count > 0
                            ? ` · ${city.member_count} ${
                                hi
                                  ? "सदस्य"
                                  : city.member_count === 1
                                    ? "member"
                                    : "members"
                              }`
                            : ""}
                        </span>
                      </Card>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </section>
  );
}
