/**
 * Public course outline — sections stay a numbered list, not folders.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useLocale } from '@/lib/locale-context';

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

function pick(hi: boolean, en: string, hiVal: string | null | undefined): string {
  return hi ? hiVal || en : en;
}

export default function CourseDetailPage() {
  const params = useParams<{ id: string }>();
  const courseId = String(params.id ?? '');
  const hi = useLocale() === 'hi';
  const [tree, setTree] = useState<CourseTree | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (!courseId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/v1/public/courses/${encodeURIComponent(courseId)}/tree`, {
      headers: { Accept: 'application/json' },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(hi ? 'पाठ्यक्रम नहीं मिला।' : 'Course not found.');
        return r.json();
      })
      .then((json: { data?: CourseTree }) => {
        if (!cancelled) setTree(json.data ?? null);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load this course.');
          setTree(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, hi]);

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
                      <span className="min-w-0 flex-1 text-sm text-foreground">{sectionTitle}</span>
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
