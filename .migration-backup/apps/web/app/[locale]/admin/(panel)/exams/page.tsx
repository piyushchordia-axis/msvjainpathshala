/**
 * Admin → Exams index (`/admin/exams`).
 *
 * Lists every exam in the admin's city. Each row links to the detail page
 * where you can generate the class OTP, grade short-text answers, and
 * release results.
 */

import Link from 'next/link';

import { listAdminExams, type ExamRow } from '@/api/exams';
import { Card } from '@/components/ui/card';

export default async function AdminExamsPage() {
  let items: ExamRow[] = [];
  let error: string | null = null;
  try {
    const res = await listAdminExams();
    items = res.items;
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not load exams.';
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-secondary">Online exams</h2>
        <p className="text-sm text-muted-foreground">
          Generate the class OTP, monitor live attempts, grade short-text answers, and release
          results.
        </p>
      </header>
      {error ? (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </Card>
      ) : null}
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Window</th>
                <th className="px-4 py-3">Total marks</th>
                <th className="px-4 py-3">Results</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                    No exams yet.
                  </td>
                </tr>
              ) : (
                items.map((e) => (
                  <tr key={e.id} className="border-t border-border/60">
                    <td className="px-4 py-3">
                      <div className="text-sm text-ink">{e.title_en}</div>
                      <div className="text-xs text-muted-foreground">{e.title_hi}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(e.window_start).toLocaleString()} –{' '}
                      {new Date(e.window_end).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-xs">{e.total_marks}</td>
                    <td className="px-4 py-3 text-xs">
                      {e.results_released ? (
                        <span className="inline-flex items-center rounded-sm bg-gold-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-gold">
                          Released
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-sm bg-warning-bg px-2 py-0.5 text-[10px] font-semibold uppercase text-warning">
                          Pending
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/exams/${e.id}`}
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
    </div>
  );
}
