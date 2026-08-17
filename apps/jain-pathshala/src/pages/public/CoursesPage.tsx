import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { Award } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { CourseFolderCard } from '@/components/public/CourseFolderCard';
import { useLocale } from '@/lib/locale-context';
import { useAuth } from '@/lib/auth-context';
import { apiGet } from '@/lib/api-client';
import { GuestError, GuestLoading } from '@/components/public/GuestLoadState';

interface CourseListRow {
  id: string;
  name_en: string;
  name_hi: string | null;
  kind: string;
  academic_year: string | null;
  punya_points: number;
}

interface CertificateRow {
  id: string;
  kind: string;
  /** Stable join key — titles change, ids don't. */
  course_id: string | null;
  title_en: string;
  title_hi: string | null;
  voided_at: string | null;
}

interface ChildOption {
  id: string;
  full_name: string;
}

function pickTitle(hi: boolean, row: CourseListRow): string {
  return hi ? row.name_hi || row.name_en : row.name_en;
}

function subtitle(row: CourseListRow): string | null {
  const parts = [row.academic_year, row.kind].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

export default function CoursesPage() {
  const locale = useLocale();
  const hi = locale === 'hi';
  const { user } = useAuth();
  const authed = !!user;

  const [items, setItems] = useState<CourseListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [guestHasMore, setGuestHasMore] = useState(false);
  const [guestNextOffset, setGuestNextOffset] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  async function loadMoreGuest() {
    if (guestNextOffset == null || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await fetch(`/v1/public/courses?limit=200&offset=${guestNextOffset}`, {
        headers: { Accept: 'application/json' },
      });
      if (!r.ok) throw new Error(`courses ${r.status}`);
      const json = (await r.json()) as {
        data?: { items?: CourseListRow[] };
        meta?: { has_more?: boolean; next_offset?: number | null };
      };
      setItems((prev) => [...prev, ...(json.data?.items ?? [])]);
      setGuestHasMore(json.meta?.has_more === true);
      setGuestNextOffset(
        typeof json.meta?.next_offset === 'number' ? json.meta.next_offset : null,
      );
    } catch {
      // Leave the loaded pages in place; the button stays for a retry.
    } finally {
      setLoadingMore(false);
    }
  }
  const [studentId, setStudentId] = useState<string | null>(null);
  const [children, setChildren] = useState<ChildOption[]>([]);
  // Matched by course_id, not title: a renamed course used to lose its badge,
  // and two courses sharing a title badged each other.
  const [certifiedCourseIds, setCertifiedCourseIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);

    const load = authed
      ? // Scope to the selected child. Without student_id the server falls back to
        // a union across all children, so a parent with kids in two cities saw a
        // merged catalogue that matched neither of them.
        apiGet<{ items: CourseListRow[] }>(
          studentId ? `/v1/courses?student_id=${encodeURIComponent(studentId)}` : '/v1/courses',
        )
      : fetch('/v1/public/courses?limit=200', { headers: { Accept: 'application/json' } })
          .then(async (r) => {
            if (!r.ok) throw new Error(`courses ${r.status}`);
            return r.json();
          })
          .then(
            (json: {
              data?: { items?: CourseListRow[] };
              meta?: { has_more?: boolean; next_offset?: number | null };
            }) => {
              if (!cancelled) {
                setGuestHasMore(json.meta?.has_more === true);
                setGuestNextOffset(
                  typeof json.meta?.next_offset === 'number' ? json.meta.next_offset : null,
                );
              }
              return { items: json.data?.items ?? [] };
            },
          );

    Promise.resolve(load)
      .then((res) => {
        if (!cancelled) setItems(res.items ?? []);
      })
      .catch(() => {
        // Raw "Courses request failed (502)" told a Hindi guest nothing
        // actionable (GST-DSN-03) — the shared error card owns the copy now.
        if (!cancelled) {
          setError(true);
          setItems([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authed, studentId, reloadKey]);

  useEffect(() => {
    if (!authed) {
      setStudentId(null);
      setChildren([]);
      setCertifiedCourseIds(new Set());
      return;
    }
    let cancelled = false;
    apiGet<{ items: ChildOption[] }>('/v1/me/children')
      .then((res) => {
        if (cancelled) return;
        const kids = res.items ?? [];
        setChildren(kids);
        // Keep the current selection if it is still one of the parent's children.
        setStudentId((prev) => (prev && kids.some((k) => k.id === prev) ? prev : kids[0]?.id ?? null));
      })
      .catch(() => {
        if (!cancelled) setStudentId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [authed]);

  useEffect(() => {
    if (!studentId) {
      setCertifiedCourseIds(new Set());
      return;
    }
    let cancelled = false;
    apiGet<{ items: CertificateRow[] }>(`/v1/students/${studentId}/certificates`)
      .then((res) => {
        if (cancelled) return;
        const ids = new Set<string>();
        for (const row of res.items ?? []) {
          if (row.kind !== 'course' || row.voided_at) continue;
          if (row.course_id) ids.add(row.course_id);
        }
        setCertifiedCourseIds(ids);
      })
      .catch(() => {
        if (!cancelled) setCertifiedCourseIds(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  return (
    <section className="container py-12 md:py-16">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-primary">
            {hi ? 'पाठ्यक्रम' : 'Courses'}
          </p>
          <h1 className="mt-3 font-display text-4xl text-secondary md:text-5xl">
            {hi ? 'पाठशाला पाठ्यक्रम' : 'Pathshala courses'}
          </h1>
          <p className="mt-4 max-w-2xl text-muted-foreground">
            {hi
              ? 'प्रकाशित पाठ्यक्रम — एक पाठ्यक्रम खोलकर अनुभाग देखें।'
              : 'Published courses — open one to browse its sections.'}
          </p>
        </div>
        {studentId ? (
          <Link
            href="/certificates"
            className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm text-secondary hover:border-primary/40"
          >
            <Award className="h-4 w-4" aria-hidden />
            {hi ? 'प्रमाणपत्र' : 'Certificates'}
          </Link>
        ) : null}
      </div>

      {/* Which child's catalogue is this? A parent with children in different
          cities was silently shown child #1's, with no way to switch. */}
      {children.length > 1 ? (
        <div className="mt-8 flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {hi ? 'बच्चा चुनें' : 'Showing courses for'}
          </span>
          {children.map((kid) => {
            const active = kid.id === studentId;
            return (
              <button
                key={kid.id}
                type="button"
                onClick={() => setStudentId(kid.id)}
                aria-pressed={active}
                className={
                  active
                    ? 'rounded-full border border-primary bg-primary px-3 py-1.5 text-sm text-primary-foreground'
                    : 'rounded-full border border-border bg-card px-3 py-1.5 text-sm text-secondary hover:border-primary/40'
                }
              >
                {kid.full_name}
              </button>
            );
          })}
        </div>
      ) : null}

      {error ? (
        <GuestError
          hi={hi}
          what="courses"
          whatHi="पाठ्यक्रम"
          onRetry={() => setReloadKey((k) => k + 1)}
        />
      ) : loading ? (
        <GuestLoading hi={hi} />
      ) : items.length === 0 ? (
        <Card className="mt-10 p-6 text-muted-foreground">
          {hi ? 'अभी कोई सक्रिय पाठ्यक्रम नहीं।' : 'No active courses yet.'}
        </Card>
      ) : (
        <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((course) => {
            const title = pickTitle(hi, course);
            const certified =
              certifiedCourseIds.has(course.id);
            return (
              <li key={course.id}>
                <CourseFolderCard
                  title={title}
                  subtitle={subtitle(course)}
                  href={`/courses/${course.id}`}
                  certificate={
                    certified ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-1 text-xs font-medium text-gold">
                        <Award className="h-3.5 w-3.5" aria-hidden />
                        {hi ? 'प्रमाणपत्र' : 'Certificate'}
                      </span>
                    ) : null
                  }
                />
              </li>
            );
          })}
        </ul>
      )}

      {!authed && guestHasMore ? (
        <div className="mt-8 flex justify-center">
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => void loadMoreGuest()}
            className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-secondary hover:border-primary/40 disabled:opacity-60"
          >
            {loadingMore
              ? hi
                ? 'लोड हो रहा है…'
                : 'Loading…'
              : hi
                ? 'और पाठ्यक्रम देखें'
                : 'Load more courses'}
          </button>
        </div>
      ) : null}
    </section>
  );
}
