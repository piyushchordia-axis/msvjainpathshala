import { useEffect, useMemo, useState } from 'react';
import { apiGet } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { useAdminList } from '@/hooks/useAdminList';
import {
  AdminPageShell, AdminTable, AdminError, AdminEmptyRow, AdminLoadMore,
} from '@/components/admin/AdminPageShell';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

// Row shape mirrors the API's snake_case fields exactly.
interface AuditRow {
  id: string;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  action: string;
  entity_kind: string;
  entity_id: string | null;
  summary: string | null;
  created_at: string;
}

const ALL = '__all__';

export default function AuditLogPage() {
  const { user } = useAuth();
  // The endpoint is state_admin+ — below that, name the restriction instead
  // of rendering a bare 403 card that reads as "broken" (STA-API-01).
  const restricted = user ? !['super_admin', 'state_admin'].includes(user.role) : false;

  if (restricted) {
    return (
      <AdminPageShell
        title="Audit log"
        subtitle="Append-only trail of sensitive actions across the organisation."
      >
        <Card className="p-6 text-sm text-muted-foreground">
          The audit log is restricted to state and national admins. Your role
          ({user?.role.replace(/_/g, ' ')}) does not include it — ask your state admin if you
          need an entry checked.
        </Card>
      </AdminPageShell>
    );
  }

  return <AuditLogContent />;
}

function AuditLogContent() {
  const [actions, setActions] = useState<string[]>([]);
  const [action, setAction] = useState<string>(ALL);
  const [entityKind, setEntityKind] = useState('');
  // Debounced value actually used to build the query.
  const [entityKindQuery, setEntityKindQuery] = useState('');

  // Load the action enum once for the filter dropdown.
  useEffect(() => {
    void apiGet<{ items: string[] }>('/v1/audit-logs/actions')
      .then((r) => setActions(r?.items ?? []))
      .catch(() => {});
  }, []);

  // Debounce the free-text entity_kind input.
  useEffect(() => {
    const t = setTimeout(() => setEntityKindQuery(entityKind.trim()), 300);
    return () => clearTimeout(t);
  }, [entityKind]);

  // Cursor-paged list (STA-API-01) — the old hard limit:200 fetch meant
  // nothing beyond the newest 200 entries was ever visible.
  const listUrl = useMemo(() => {
    const params = new URLSearchParams({ limit: '100' });
    if (action !== ALL) params.set('action', action);
    if (entityKindQuery) params.set('entity_kind', entityKindQuery);
    return `/v1/audit-logs?${params.toString()}`;
  }, [action, entityKindQuery]);

  const { items, loading, loadingMore, error, hasMore, loadMore } =
    useAdminList<AuditRow>(listUrl);

  return (
    <AdminPageShell
      title="Audit log"
      subtitle="Append-only trail of sensitive actions across the organisation."
    >
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs font-medium">Action</Label>
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger className="w-48"><SelectValue placeholder="All actions" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All actions</SelectItem>
              {actions.map((a) => (
                <SelectItem key={a} value={a} className="capitalize">{a.replace(/_/g, ' ')}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-medium">Entity kind</Label>
          <Input
            className="w-56"
            placeholder="e.g. settings, enrolment"
            value={entityKind}
            onChange={(e) => setEntityKind(e.target.value)}
          />
        </div>
      </div>

      {error ? <AdminError message={error} /> : null}
      <AdminTable
        columns={['Time', 'Actor', 'Role', 'Action', 'Entity kind', 'Entity ID', 'Summary']}
        loading={loading}
        empty=""
        colSpan={7}
        footer={
          <AdminLoadMore hasMore={hasMore} loadingMore={loadingMore} onLoadMore={() => void loadMore()} />
        }
      >
        {items.length === 0 && !loading ? (
          <AdminEmptyRow colSpan={7} message="No audit entries match these filters." />
        ) : null}
        {items.map((r) => (
          <tr key={r.id} className="hover:bg-muted/30">
            <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
              {new Date(r.created_at).toLocaleString('en-GB')}
            </td>
            <td className="px-4 py-3 font-medium">{r.actor_name ?? '—'}</td>
            <td className="px-4 py-3 text-xs capitalize">
              {r.actor_role ? r.actor_role.replace(/_/g, ' ') : '—'}
            </td>
            <td className="px-4 py-3 text-xs capitalize">{r.action.replace(/_/g, ' ')}</td>
            <td className="px-4 py-3 text-xs">{r.entity_kind}</td>
            <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
              {r.entity_id ? r.entity_id.slice(0, 8) : '—'}
            </td>
            <td className="px-4 py-3 text-xs text-muted-foreground">{r.summary ?? '—'}</td>
          </tr>
        ))}
      </AdminTable>
    </AdminPageShell>
  );
}
