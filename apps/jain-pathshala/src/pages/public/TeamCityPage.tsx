import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams, useSearch } from "wouter";
import { Card } from "@/components/ui/card";
import { useLocale } from "@/lib/locale-context";
import { TEAM_PUBLIC_CITY_SLUG } from "@jp/shared/constants";
import {
  TeamMemberCard,
  TeamMemberCardSkeleton,
  type TeamCardModel,
} from "@/components/public/TeamMemberCard";

type CentreBlock = {
  id: string;
  name: string;
  order?: number;
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

type PageMeta = {
  page: number;
  page_size: number;
  total_pages: number;
  total_centres: number;
  next_cursor: string | null;
};

const SKELETON_COUNT = 4;

function parsePageParam(search: string): number {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const n = Number(q.get("page") ?? "1");
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

function pagePath(slug: string, page: number): string {
  return page <= 1 ? `/team/${slug}` : `/team/${slug}?page=${page}`;
}

function setOrRemoveLink(rel: "prev" | "next" | "canonical", href: string | null) {
  const existing = document.head.querySelectorAll(`link[data-jp-team-rel="${rel}"]`);
  existing.forEach((el) => el.remove());
  if (!href) return;
  const link = document.createElement("link");
  link.rel = rel;
  link.href = href;
  link.setAttribute("data-jp-team-rel", rel);
  document.head.appendChild(link);
}

function setMetaDescription(content: string | null) {
  let el = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
  if (!content) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("meta");
    el.name = "description";
    document.head.appendChild(el);
  }
  el.content = content;
}

/**
 * City Team page — GET /v1/team/cities/:citySlug?page=N
 *
 * Vite SPA stand-in for apps/web/.../team/[citySlug]/page.tsx:
 * - API Cache-Control max-age=3600 ≈ ISR revalidate 3600
 * - GET /v1/team/city-slugs ≈ generateStaticParams
 * - ?page=N is cumulative (centres through page N) so the roster is crawlable without JS
 */
export default function TeamCityPage() {
  const params = useParams<{ citySlug?: string }>();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const slug = String(params.citySlug ?? "");
  const urlPage = parsePageParam(search);
  const locale = useLocale();
  const hi = locale === "hi";
  const slugBlocked = Boolean(TEAM_PUBLIC_CITY_SLUG) && slug !== TEAM_PUBLIC_CITY_SLUG;

  const [data, setData] = useState<CityPayload | null>(null);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [loading, setLoading] = useState(!slugBlocked);
  const [notFound, setNotFound] = useState(slugBlocked);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadLock = useRef(false);
  const skipUrlFetch = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!slug) return;
    if (slugBlocked) {
      setNotFound(true);
      setLoading(false);
      setData(null);
      return;
    }
    if (skipUrlFetch.current) {
      skipUrlFetch.current = false;
      return;
    }
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    const qs = urlPage > 1 ? `?page=${urlPage}` : "";
    fetch(`/v1/team/cities/${encodeURIComponent(slug)}${qs}`, {
      headers: { Accept: "application/json" },
    })
      .then(async (r) => {
        if (r.status === 404) {
          if (!cancelled) setNotFound(true);
          return null;
        }
        if (!r.ok) throw new Error("city team fetch failed");
        return r.json() as Promise<{ data?: CityPayload; meta?: Partial<PageMeta> }>;
      })
      .then((json) => {
        if (cancelled || !json?.data) return;
        setData(json.data);
        setMeta({
          page: Number(json.meta?.page ?? urlPage),
          page_size: Number(json.meta?.page_size ?? 5),
          total_pages: Number(json.meta?.total_pages ?? 1),
          total_centres: Number(json.meta?.total_centres ?? 0),
          next_cursor: (json.meta?.next_cursor as string | null | undefined) ?? null,
        });
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, urlPage, slugBlocked]);

  // Title + meta description from city name (local SEO).
  useEffect(() => {
    if (!data) return;
    const city = data.city.name;
    const title = hi
      ? `${city} टीम | जैन पाठशाला`
      : `${city} Team | Jain Pathshala`;
    const description = hi
      ? `${city} में जैन पाठशाला की टीम — सिटी एडमिन, संचालक, गुरुजी और दीदी।`
      : `Meet the Jain Pathshala team in ${city} — city admins, Sanchalaks, Gurujis and Didis.`;
    const prevTitle = document.title;
    document.title = title;
    setMetaDescription(description);
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const page = meta?.page ?? urlPage;
    const total = meta?.total_pages ?? 1;
    setOrRemoveLink("canonical", `${origin}${pagePath(slug, page)}`);
    setOrRemoveLink("prev", page > 1 ? `${origin}${pagePath(slug, page - 1)}` : null);
    setOrRemoveLink("next", page < total ? `${origin}${pagePath(slug, page + 1)}` : null);
    return () => {
      document.title = prevTitle;
      setMetaDescription(null);
      setOrRemoveLink("canonical", null);
      setOrRemoveLink("prev", null);
      setOrRemoveLink("next", null);
    };
  }, [data, hi, meta?.page, meta?.total_pages, slug, urlPage]);

  const lazyCategory = data?.categories.find((c) => c.group_by === "centre" || c.is_lazy_loaded);
  const nextCursor = meta?.next_cursor ?? lazyCategory?.next_cursor ?? null;
  const currentPage = meta?.page ?? urlPage;
  const totalPages = meta?.total_pages ?? 1;
  const hasMore = Boolean(nextCursor) && currentPage < totalPages;

  const loadMore = useCallback(async () => {
    if (!slug || !nextCursor || !lazyCategory || loadLock.current || loadingMore) return;
    loadLock.current = true;
    setLoadingMore(true);
    try {
      const r = await fetch(
        `/v1/team/cities/${encodeURIComponent(slug)}/shikshaks?cursor=${encodeURIComponent(nextCursor)}`,
        { headers: { Accept: "application/json" } },
      );
      if (!r.ok) return;
      const json = (await r.json()) as {
        data?: { centres: CentreBlock[] };
        meta?: Partial<PageMeta>;
      };
      const incoming = json.data?.centres ?? [];
      if (incoming.length === 0) {
        setMeta((m) => (m ? { ...m, next_cursor: null } : m));
        return;
      }

      const nextPage = Math.min(currentPage + 1, Number(json.meta?.total_pages ?? totalPages));
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          categories: prev.categories.map((c) => {
            if (c.id !== lazyCategory.id) return c;
            const seen = new Set(c.centres.map((x) => x.id));
            const merged = [...c.centres];
            for (const centre of incoming) {
              // Never grow a partial centre roster — skip duplicates, append whole centres only.
              if (seen.has(centre.id)) continue;
              seen.add(centre.id);
              merged.push(centre);
            }
            return {
              ...c,
              centres: merged,
              next_cursor: (json.meta?.next_cursor as string | null | undefined) ?? null,
            };
          }),
        };
      });
      setMeta((m) => ({
        page: nextPage,
        page_size: Number(json.meta?.page_size ?? m?.page_size ?? 5),
        total_pages: Number(json.meta?.total_pages ?? m?.total_pages ?? 1),
        total_centres: Number(json.meta?.total_centres ?? m?.total_centres ?? 0),
        next_cursor: (json.meta?.next_cursor as string | null | undefined) ?? null,
      }));
      // Real crawlable URL — same cumulative content as a no-JS visit to ?page=N.
      skipUrlFetch.current = true;
      setLocation(pagePath(slug, nextPage));
    } finally {
      loadLock.current = false;
      setLoadingMore(false);
    }
  }, [slug, nextCursor, lazyCategory, loadingMore, currentPage, totalPages, setLocation]);

  // Intersection observer + Load more button share this handler.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { rootMargin: "240px 0px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [hasMore, loadMore]);

  return (
    <section className="container py-12 md:py-16">
      {!TEAM_PUBLIC_CITY_SLUG ? (
        <p className="text-sm">
          <Link href="/team" className="text-primary hover:underline">
            {hi ? "← टीम" : "← Team"}
          </Link>
        </p>
      ) : null}

      {loading ? (
        <div className="mt-10 space-y-10" aria-busy="true" aria-live="polite">
          <div className="h-10 w-48 max-w-full animate-pulse rounded bg-muted" />
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
              <TeamMemberCardSkeleton key={i} variant="core" />
            ))}
          </div>
        </div>
      ) : notFound || !data ? (
        <Card className="mt-8 p-6 text-muted-foreground" style={{ lineHeight: "22px" }}>
          {hi
            ? "यह शहर नहीं मिला, या यहाँ अभी कोई प्रकाशित टीम सदस्य नहीं है।"
            : "That city was not found, or it has no published Team members yet."}
        </Card>
      ) : (
        <>
          <p className="mt-6 text-sm font-medium uppercase tracking-[0.18em] text-primary">
            {data.city.state_name}
          </p>
          <h1
            className="mt-3 break-words font-display text-4xl text-secondary md:text-5xl"
            style={{ lineHeight: "1.25" }}
          >
            {hi ? `${data.city.name} टीम` : `${data.city.name} Team`}
          </h1>
          <p
            className="mt-4 max-w-2xl break-words text-muted-foreground"
            style={{ lineHeight: "22px" }}
          >
            {hi
              ? `${data.city.name} में पाठशाला की टीम — सिटी एडमिन, संचालक, गुरुजी और दीदी।`
              : `The Pathshala team in ${data.city.name} — city admins, Sanchalaks, Gurujis and Didis.`}
          </p>

          <div className="mt-12 space-y-14">
            {data.categories.map((cat) => {
              const title = hi ? cat.name_hi : cat.name_en;
              const isCore = cat.key === "core_team";
              const isCentreGrouped = cat.group_by === "centre" || cat.is_lazy_loaded;
              if (
                cat.member_count === 0 &&
                cat.members.length === 0 &&
                cat.centres.every((c) => c.members.length === 0)
              ) {
                return null;
              }
              const memberGridClass = isCore
                ? "mt-6 grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
                : "mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

              return (
                <section key={cat.id} aria-labelledby={`city-cat-${cat.id}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <h2
                      id={`city-cat-${cat.id}`}
                      className="break-words font-display text-2xl text-secondary"
                      style={{ lineHeight: "1.3" }}
                    >
                      {title}
                    </h2>
                    <span
                      className="text-xs font-medium uppercase tracking-[0.14em] text-ink-sub"
                      style={{ lineHeight: "22px" }}
                    >
                      {cat.member_count}{" "}
                      {hi
                        ? "सदस्य"
                        : cat.member_count === 1
                          ? "member"
                          : "members"}
                    </span>
                  </div>

                  {isCentreGrouped ? (
                    <div className="mt-6 space-y-10">
                      {cat.centres.map((centre) => (
                        <div key={centre.id}>
                          <h3
                            className="break-words font-display text-xl text-secondary"
                            style={{ lineHeight: "22px" }}
                          >
                            {centre.name}
                          </h3>
                          <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                            {centre.members.map((m) => (
                              <TeamMemberCard
                                key={`${centre.id}-${m.id}`}
                                member={m}
                                locale={locale}
                              />
                            ))}
                          </div>
                        </div>
                      ))}

                      {loadingMore ? (
                        <div
                          className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                          aria-busy="true"
                        >
                          {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
                            <TeamMemberCardSkeleton key={`more-${i}`} />
                          ))}
                        </div>
                      ) : null}

                      {hasMore || (meta && currentPage < totalPages) ? (
                        <div className="flex flex-col items-start gap-4 pt-2">
                          {/*
                            Accessible path: real ?page=N link (works without JS).
                            With JS, preventDefault and append via the shared loadMore handler.
                          */}
                          <a
                            href={pagePath(slug, currentPage + 1)}
                            rel="next"
                            onClick={(e) => {
                              if (!nextCursor) return; // full navigation for no-cursor edge cases
                              e.preventDefault();
                              void loadMore();
                            }}
                            className={`inline-flex min-h-10 items-center rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-secondary hover:bg-accent ${
                              loadingMore ? "pointer-events-none opacity-60" : ""
                            }`}
                            style={{ lineHeight: "22px" }}
                            aria-disabled={loadingMore}
                          >
                            {loadingMore
                              ? hi
                                ? "लोड हो रहा है…"
                                : "Loading…"
                              : hi
                                ? "और केंद्र देखें"
                                : "Load more centres"}
                          </a>
                          <div ref={sentinelRef} className="h-1 w-full" aria-hidden />
                          {currentPage > 1 ? (
                            <a
                              href={pagePath(slug, currentPage - 1)}
                              rel="prev"
                              className="text-sm text-muted-foreground hover:text-foreground hover:underline"
                              style={{ lineHeight: "22px" }}
                            >
                              {hi ? "पिछला पृष्ठ" : "Previous page"}
                            </a>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className={memberGridClass}>
                      {cat.members.map((m) => (
                        <TeamMemberCard
                          key={m.id}
                          member={m}
                          locale={locale}
                          variant={isCore ? "core" : "default"}
                        />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
