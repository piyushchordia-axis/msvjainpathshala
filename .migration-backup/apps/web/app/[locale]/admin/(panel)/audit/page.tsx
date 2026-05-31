/**
 * Admin → Audit log (`/admin/audit`).
 *
 * Append-only audit history (`GET /v1/admin/audit-logs`). Newest-first,
 * city-scoped for city_admin; platform-wide for super/state. Read-only by
 * design — the audit_writer Postgres role rejects updates.
 */

import { listAuditLogs, type AuditLogRow } from '@/api/admin-misc';
import { Card } from '@/components/ui/card';

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export default async function AdminAuditPage() {
  let items: AuditLogRow[] = [];
  let error: string | null = null;
  try {
    const res = await listAuditLogs({ limit: 100 });
    items = res.items;
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not load the audit log.';
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-secondary">Audit log</h2>
        <p className="text-sm text-muted-foreground">
          Append-only history of admin actions, newest first. Written by the audit_writer Postgres
          role (INSERT only) — never editable here.
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
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Actor role</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Entity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                    No audit entries in scope yet.
                  </td>
                </tr>
              ) : (
                items.map((e) => (
                  <tr key={e.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatWhen(e.created_at)}
                    </td>
                    <td className="px-4 py-3 text-xs uppercase tracking-wide text-muted-foreground">
                      {e.actor_role}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-pill bg-maroon/10 px-2 py-0.5 text-xs font-semibold text-maroon">
                        {e.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className="font-medium">{e.entity_kind}</span>
                      <span className="ml-2 text-muted-foreground">{e.entity_id.slice(0, 8)}…</span>
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
