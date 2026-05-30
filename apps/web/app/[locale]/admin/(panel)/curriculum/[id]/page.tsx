/**
 * Admin → Curriculum detail (`/admin/curriculum/:id`).
 *
 * Renders the bilingual section → item tree for a single curriculum via
 * GET /v1/admin/curricula/:id/tree. Standard curricula are city-scoped and
 * editable by city_admin+; MSV curricula are managed by super_admin only at
 * the service layer (Q2) — for non-super_admin this view is read-only and
 * shows the restriction note.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getCurriculumTree, type CurriculumTree } from '@/api/curriculum';
import { Card } from '@/components/ui/card';
import { readSessionUser } from '@/lib/auth-cookies';

export default async function CurriculumDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await readSessionUser();
  const isSuper = user?.role === 'super_admin';

  let tree: CurriculumTree | null = null;
  let error: string | null = null;
  try {
    tree = await getCurriculumTree(id);
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not load this curriculum.';
  }

  if (!tree && !error) return notFound();

  const curriculum = tree?.curriculum;
  const isMsv = curriculum?.kind === 'msv';
  const readOnly = isMsv && !isSuper;
  const itemCount = tree?.sections.reduce((n, s) => n + s.items.length, 0) ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/curriculum"
          className="text-sm font-semibold text-saffron hover:underline"
        >
          ← Back to curricula
        </Link>
      </div>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-secondary">
            {curriculum?.name ?? 'Curriculum'}
          </h2>
          <p className="text-sm text-muted-foreground">
            {curriculum ? (
              <>
                <span className="uppercase">{curriculum.kind}</span>
                {curriculum.academic_year ? ` · ${curriculum.academic_year}` : ''} ·{' '}
                {tree?.sections.length ?? 0} section{(tree?.sections.length ?? 0) === 1 ? '' : 's'}{' '}
                · {itemCount} topic{itemCount === 1 ? '' : 's'}
              </>
            ) : null}
            {readOnly ? (
              <span className="block text-xs italic">
                MSV curricula are managed by the national super_admin only — read-only here.
              </span>
            ) : null}
          </p>
        </div>
        {curriculum ? <StatusPill status={curriculum.status ?? 'draft'} /> : null}
      </header>

      {error ? (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </Card>
      ) : null}

      {tree && tree.sections.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          No sections yet. Sections and topics for this curriculum will appear here.
        </Card>
      ) : null}

      {tree?.sections.map((section, sIdx) => (
        <Card key={section.id} className="overflow-hidden p-0">
          <div className="flex items-baseline justify-between gap-3 bg-saffron-50 px-4 py-3">
            <div>
              <h3 className="font-semibold text-secondary">
                {sIdx + 1}. {section.title_en}
              </h3>
              {section.title_hi ? (
                <p className="font-display text-sm text-muted-foreground">{section.title_hi}</p>
              ) : null}
            </div>
            <span className="text-xs text-muted-foreground">
              {section.items.length} topic{section.items.length === 1 ? '' : 's'}
            </span>
          </div>
          {section.items.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted-foreground">
              No topics in this section yet.
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {section.items.map((item) => (
                <li key={item.id} className="px-4 py-3">
                  <p className="text-sm font-medium text-ink">{item.title_en}</p>
                  {item.title_hi ? (
                    <p className="font-display text-sm text-muted-foreground">{item.title_hi}</p>
                  ) : null}
                  {item.description_en ? (
                    <p className="mt-1 text-xs text-muted-foreground">{item.description_en}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const palette: Record<string, { bg: string; fg: string }> = {
    draft: { bg: 'bg-muted', fg: 'text-muted-foreground' },
    active: { bg: 'bg-success-bg', fg: 'text-success' },
    archived: { bg: 'bg-warning-bg', fg: 'text-warning' },
  };
  const p = palette[status] ?? palette.draft!;
  return (
    <span
      className={`inline-flex items-center rounded-sm px-2 py-0.5 text-[10px] font-semibold uppercase ${p.bg} ${p.fg}`}
    >
      {status}
    </span>
  );
}
