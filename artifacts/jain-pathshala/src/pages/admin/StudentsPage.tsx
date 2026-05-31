import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiGet, apiPost, ApiError } from '@/lib/api-client';
import { toast } from '@/components/ui/toast-jp';

interface AdminStudentRow {
  id: string;
  full_name: string | null;
  student_code: string;
  age_group: string;
  dob: string | null;
  msv_status: string;
  status: 'active' | 'inactive';
}

function StatusPill({ status }: { status: string }) {
  const active = status === 'active';
  return (
    <span
      className={
        active
          ? 'rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700'
          : 'rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground'
      }
    >
      {status}
    </span>
  );
}

function StudentRowActions({
  id,
  status,
  onChanged,
}: {
  id: string;
  status: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    const action = status === 'active' ? 'deactivate' : 'reactivate';
    const reason = status === 'active' ? window.prompt('Reason for deactivation:') : undefined;
    if (status === 'active' && !reason) return;
    setBusy(true);
    try {
      await apiPost(`/v1/admin/students/${id}/status`, {
        action,
        ...(reason ? { reason } : {}),
      });
      toast.success(`Student ${action}d successfully.`);
      onChanged();
    } catch (err) {
      toast.error(
        `Could not ${action} student.`,
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      size="sm"
      variant={status === 'active' ? 'secondary' : 'ghost'}
      disabled={busy}
      onClick={toggle}
    >
      {status === 'active' ? 'Deactivate' : 'Reactivate'}
    </Button>
  );
}

export default function StudentsPage() {
  const [items, setItems] = useState<AdminStudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{ data: { items: AdminStudentRow[] } }>(
        '/v1/admin/students?limit=100',
      );
      setItems(res.data?.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load students.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-secondary">Students</h2>
          <p className="text-sm text-muted-foreground">
            Roster across your centres and batches. Inactive students stay on record.
          </p>
        </div>
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
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    Loading students…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    No students in scope yet.
                  </td>
                </tr>
              ) : (
                items.map((s) => (
                  <tr key={s.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{s.full_name || '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {s.student_code}
                    </td>
                    <td className="px-4 py-3 text-xs uppercase tracking-wide text-muted-foreground">
                      {s.age_group}
                    </td>
                    <td className="px-4 py-3 text-xs">{s.dob ?? '—'}</td>
                    <td className="px-4 py-3">
                      {s.msv_status === 'approved' ? (
                        <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">MSV</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">{s.msv_status}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={s.status} />
                    </td>
                    <td className="px-4 py-3">
                      <StudentRowActions id={s.id} status={s.status} onChanged={load} />
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
