/**
 * Admin → Curriculum index (`/admin/curriculum`).
 *
 * Tabs: Standard (city-scoped) and MSV (read-only for non-super_admin).
 * Q2: editing/creating MSV curricula is restricted to super_admin at the
 * SERVICE LAYER; the UI hides the "+ New MSV" button for non-super_admin
 * but the real gate lives in NestJS.
 */

import Link from 'next/link';

import { listAdminCurricula, type CurriculumRow } from '@/api/curriculum';
import { Card } from '@/components/ui/card';
import { readSessionUser } from '@/lib/auth-cookies';

export default async function AdminCurriculumPage() {
  const user = await readSessionUser();
  const isSuper = user?.role === 'super_admin';

  let standard: CurriculumRow[] = [];
  let msv: CurriculumRow[] = [];
  let error: string | null = null;
  try {
    const [s, m] = await Promise.all([
      listAdminCurricula({ kind: 'standard' }),
      listAdminCurricula({ kind: 'msv' }),
    ]);
    standard = s.items;
    msv = m.items;
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not load curricula.';
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-secondary">Curriculum</h2>
          <p className="text-sm text-muted-foreground">
            Author Standard curricula for your city, or browse MSV master curricula.
            {!isSuper && (
              <span className="block text-xs italic">
                MSV curricula are managed by the national super_admin only.
              </span>
            )}
          </p>
        </div>
        <Link
          href="/admin/curriculum/new"
          className="inline-flex items-center gap-2 rounded-md bg-saffron px-4 py-2 text-sm font-semibold text-white hover:bg-saffron-700"
        >
          + New curriculum
        </Link>
      </header>

      {error ? (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </Card>
      ) : null}

      <Section title="Standard" rows={standard} />
      <Section title="MSV" rows={msv} mutedHeader={!isSuper} />
    </div>
  );
}

function Section({
  title,
  rows,
  mutedHeader,
}: {
  title: string;
  rows: CurriculumRow[];
  mutedHeader?: boolean;
}) {
  return (
    <Card className="overflow-hidden p-0">
      <div className={`px-4 py-3 ${mutedHeader ? 'bg-muted/60' : 'bg-saffron-50'}`}>
        <h3 className="font-semibold text-secondary">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Academic year</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                  No {title} curricula yet.
                </td>
              </tr>
            ) : (
              rows.map((c) => (
                <tr key={c.id} className="border-t border-border/60">
                  <td className="px-4 py-3 text-ink">{c.name}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {c.academic_year ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={c.status ?? 'draft'} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/curriculum/${c.id}`}
                      className="text-sm font-semibold text-saffron hover:underline"
                    >
                      Open →
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
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
