/**
 * Public course outline — sections stay a numbered list, not folders.
 * Signed-in parents/students see their own status + certification star
 * (M34); guests and staff-without-a-child fall back to the guest outline.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import { ChevronDown, ChevronRight, Star } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useLocale } from '@/lib/locale-context';
import { useAuth } from '@/lib/auth-context';
import { apiGet, ApiError } from '@/lib/api-client';

interface TreeSubsection {
  id: string;
  title_en: string;
  title_hi: string | null;
}

interface TreeSection {
  id: string;
  title_en: string;
  title_hi: string | null;
  subsections: TreeSubsection[];
  // Present only on the member (student-facing) tree — CU11/CU17.
  status?: 'not_started' | 'in_progress' | 'completed';
  certified_at?: string | null;
  certified_by_gender?: string | null;
}

interface CourseTree {
  course: {
    id: string;
    name_en: string;
    name_hi: string | null;
    kind: string;
    academic_year: string | null;
  };
  sections: TreeSection[];
}

interface ChildOption {
  id: string;
  full_name: string;
}

function pick(hi: boolean, en: string, hiVal: string | null | undefined): string {
  return hi ? hiVal || en : en;
}

/** CU11 progress-status label (three values only — 'mastered' is dead). */
function progressStatusLabel(status: TreeSection['status'], hi: boolean): string {
  if (status == null) return '';
  if (status === 'not_started') return hi ? 'शुरू करना बाकी' : 'To be started';
  if (status === 'in_progress') return hi ? 'चल रहा है' : 'In progress';
  return hi ? 'पूर्ण' : 'Completed';
}

/** CU17 — three-branch honorific; NULL/other must not default to Guruji. */
function certifiedByLabel(gender: string | null | undefined, hi: boolean): string {
  if (gender === 'male') return hi ? 'गुरुजी द्वारा प्रमाणित' : 'Certified by Guruji';
  if (gender === 'female') return hi ? 'दीदी द्वारा प्रमाणित' : 'Certified by Didi';
  return hi ? 'प्रमाणित' : 'Certified';
}

export default function CourseDetailPage() {
  const params = useParams<{ id: string }>();
  const courseId = String(params.id ?? '');
  const hi = useLocale() === 'hi';
  const { user } = useAuth();
  const authed = !!user;

  const [children, setChildren] = useState<ChildOption[]>([]);
  const [studentId, setStudentId] = useState<string | null>(null);
  // Gates the tree fetch so an authed parent never flashes the guest outline
  // while /v1/me/children is still in flight.
  const [childrenLoaded, setChildrenLoaded] = useState(false);

  const [tree, setTree] = useState<CourseTree | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (!authed) {
      setChildren([]);
      setStudentId(null);
      setChildrenLoaded(true);
      return;
    }
    let cancelled = false;
    setChildrenLoaded(false);
    apiGet<{ items: ChildOption[] }>('/v1/me/children')
      .then((res) => {
        if (cancelled) return;
        const kids = res.items ?? [];
        setChildren(kids);
        setStudentId((prev) => (prev && kids.some((k) => k.id === prev) ? prev : (kids[0]?.id ?? null)));
      })
      .catch(() => {
        if (!cancelled) {
          setChildren([]);
          setStudentId(null);
        }
      })
      .finally(() => {
        if (!cancelled) setChildrenLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [authed]);

  useEffect(() => {
    if (!courseId) return;
    // Wait for the children lookup so a signed-in parent is never served the
    // guest tree just because studentId hasn't resolved yet.
    if (authed && !childrenLoaded) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    // M34 — the student-facing read path (with status + star per node) when
    // signed in with a resolvable child; the guest tree only when there is
    // no session or no child to scope to (CU3).
    const useMember = authed && !!studentId;
    const path = useMember
      ? `/v1/courses/${encodeURIComponent(courseId)}/tree?student_id=${encodeURIComponent(studentId!)}`
      : `/v1/public/courses/${encodeURIComponent(courseId)}/tree`;

    // L21 — the shared client instead of a hand-rolled fetch + manual
    // envelope unwrap.
    apiGet<CourseTree>(path)
      .then((data) => {
        if (!cancelled) setTree(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.message
              : hi
                ? 'यह पाठ्यक्रम उपलब्ध नहीं है।'
                : 'Could not load this course.',
          );
          setTree(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, hi, authed, studentId, childrenLoaded]);

  const title = tree
    ? pick(hi, tree.course.name_en, tree.course.name_hi)
    : hi
      ? 'पाठ्यक्रम'
      : 'Course';

  return (
    <section className="container py-12 md:py-16">
      <Link href="/courses" className="text-sm text-muted-foreground hover:text-primary">
        ← {hi ? 'पाठ्यक्रम' : 'Courses'}
      </Link>

      {children.length > 1 ? (
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {hi ? 'बच्चा चुनें' : 'Showing progress for'}
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

      {loading ? (
        <p className="mt-8 text-muted-foreground">{hi ? 'लोड हो रहा है…' : 'Loading…'}</p>
      ) : error || !tree ? (
        <Card className="mt-8 p-6 text-muted-foreground">
          {error ?? (hi ? 'यह पाठ्यक्रम उपलब्ध नहीं है।' : 'That course is not available.')}
        </Card>
      ) : (
        <>
          <h1 className="mt-4 font-display text-3xl text-secondary md:text-4xl">{title}</h1>
          {tree.course.academic_year ? (
            <p className="mt-2 text-sm text-muted-foreground">{tree.course.academic_year}</p>
          ) : null}

          {tree.sections.length === 0 ? (
            <Card className="mt-8 p-6 text-muted-foreground">
              {hi ? 'इस पाठ्यक्रम में अभी कोई अनुभाग नहीं।' : 'No sections in this course yet.'}
            </Card>
          ) : (
            <ol className="mt-8 overflow-hidden rounded-lg border border-border bg-card">
              {tree.sections.map((section, i) => {
                const sectionTitle = pick(hi, section.title_en, section.title_hi);
                const expanded = openId === section.id;
                const count = section.subsections.length;
                const certified = !!section.certified_at;
                return (
                  <li key={section.id} className="border-b border-border last:border-b-0">
                    <button
                      type="button"
                      onClick={() =>
                        setOpenId((cur) => (cur === section.id ? null : section.id))
                      }
                      className={`flex w-full items-center gap-3 px-4 py-3 text-left ${
                        expanded ? 'bg-muted/40' : 'bg-card'
                      }`}
                    >
                      <span className="min-w-6 text-sm font-semibold text-foreground">
                        {i + 1}.
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-foreground">{sectionTitle}</span>
                        {section.status ? (
                          <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                            {certified ? (
                              <Star className="h-3 w-3 shrink-0 text-gold" aria-hidden />
                            ) : null}
                            {certified
                              ? certifiedByLabel(section.certified_by_gender, hi)
                              : progressStatusLabel(section.status, hi)}
                          </span>
                        ) : null}
                      </span>
                      {count > 0 ? (
                        <span className="text-xs text-muted-foreground">({count})</span>
                      ) : null}
                      {count > 0 ? (
                        expanded ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )
                      ) : null}
                    </button>
                    {expanded && count > 0 ? (
                      <ol className="border-t border-border bg-muted/20 py-1">
                        {section.subsections.map((sub, j) => (
                          <li
                            key={sub.id}
                            className="px-4 py-2 pl-12 text-sm text-foreground"
                          >
                            {j + 1}. {pick(hi, sub.title_en, sub.title_hi)}
                          </li>
                        ))}
                      </ol>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
