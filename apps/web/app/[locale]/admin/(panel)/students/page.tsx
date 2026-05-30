/**
 * Admin → Students (`/admin/students`).
 *
 * Read-only roster across the actor's scope. Q11: never hard-delete —
 * inactive students appear with a dimmed status pill.
 */

import { listAdminStudents, type AdminStudentRow } from '@/api/admin-misc';
import { Card } from '@/components/ui/card';

export default async function AdminStudentsPage() {
  let items: AdminStudentRow[] = [];
  let error: string | null = null;
  try {
    const res = await listAdminStudents({ limit: 100 });
    items = res.items;
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not load students.';
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-secondary">Students</h2>
        <p className="text-sm text-muted-foreground">
          Roster across your centres and batches. Inactive students stay on record (Q11).
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
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Age group</th>
                <th className="px-4 py-3">DOB</th>
                <th className="px-4 py-3">MSV</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                    No students in scope yet.
                  </td>
                </tr>
              ) : (
                items.map((s) => (
                  <tr key={s.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{s.full_name || '—'}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{s.student_code}</td>
                    <td className="px-4 py-3 text-xs uppercase tracking-wide text-muted-foreground">
                      {s.age_group}
                    </td>
                    <td className="px-4 py-3 text-xs">{s.dob}</td>
                    <td className="px-4 py-3">
                      {s.msv_status === 'approved' ? (
                        <span className="rounded-pill bg-gold/15 px-2 py-0.5 text-xs font-semibold text-gold">
                          MSV
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">{s.msv_status}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          s.status === 'active'
                            ? 'rounded-pill bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700'
                            : 'rounded-pill bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground'
                        }
                      >
                        {s.status}
                      </span>
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
