import { useState } from 'react';
import { apiPost, ApiError } from '@/lib/api-client';
import { useAdminList } from '@/hooks/useAdminList';
import { toast } from '@/components/ui/toast-jp';
import { AdminPageShell, AdminTable, AdminError, AdminEmptyRow } from '@/components/admin/AdminPageShell';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

// Row shape mirrors the API's snake_case fields exactly.
interface EnquiryRow {
  id: string;
  kind: string;
  name: string;
  phone: string | null;
  email: string | null;
  subject: string | null;
  message: string;
  city: string | null;
  status: string;
  created_at: string;
}

const ALL = '__all__';
const KINDS = ['contact', 'enquire', 'donate'];
const STATUSES = ['new', 'in_review', 'closed'];

function StatusActions({ row, onChanged }: { row: EnquiryRow; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);

  async function mark(status: 'in_review' | 'closed') {
    setBusy(status);
    try {
      await apiPost(`/v1/enquiries/${row.id}/status`, { status });
      toast.success(status === 'closed' ? 'Enquiry closed.' : 'Marked in review.');
      onChanged();
    } catch (err) {
      toast.error('Failed to update enquiry.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex justify-end gap-2">
      {row.status !== 'in_review' && row.status !== 'closed' ? (
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() => mark('in_review')}
        >
          {busy === 'in_review' ? 'Saving…' : 'In review'}
        </Button>
      ) : null}
      {row.status !== 'closed' ? (
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() => mark('closed')}
        >
          {busy === 'closed' ? 'Saving…' : 'Close'}
        </Button>
      ) : null}
    </div>
  );
}

export default function EnquiriesPage() {
  const [kind, setKind] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);

  const params = new URLSearchParams({ limit: '200' });
  if (kind !== ALL) params.set('kind', kind);
  if (status !== ALL) params.set('status', status);

  const { items, loading, error, reload } = useAdminList<EnquiryRow>(
    `/v1/enquiries?${params.toString()}`,
    [kind, status],
  );

  return (
    <AdminPageShell
      title="Enquiries"
      subtitle="Contact, enrolment, and donation messages from the public website."
    >
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs font-medium">Kind</Label>
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger className="w-44"><SelectValue placeholder="All kinds" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All kinds</SelectItem>
              {KINDS.map((k) => (
                <SelectItem key={k} value={k} className="capitalize">{k}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-medium">Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-44"><SelectValue placeholder="All statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g, ' ')}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {error ? <AdminError message={error} /> : null}
      <AdminTable
        columns={['Received', 'Kind', 'Name', 'Contact', 'City', 'Message', 'Status', '']}
        loading={loading}
        empty=""
        colSpan={8}
      >
        {items.length === 0 && !loading ? (
          <AdminEmptyRow colSpan={8} message="No enquiries match these filters." />
        ) : null}
        {items.map((e) => (
          <tr key={e.id} className="hover:bg-muted/30 align-top">
            <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
              {new Date(e.created_at).toLocaleDateString('en-GB')}
            </td>
            <td className="px-4 py-3 text-xs capitalize">{e.kind}</td>
            <td className="px-4 py-3 font-medium">
              {e.name}
              {e.subject ? <div className="text-xs text-muted-foreground">{e.subject}</div> : null}
            </td>
            <td className="px-4 py-3 text-xs text-muted-foreground">
              {e.phone ? <div>{e.phone}</div> : null}
              {e.email ? <div>{e.email}</div> : null}
              {!e.phone && !e.email ? '—' : null}
            </td>
            <td className="px-4 py-3 text-xs">{e.city ?? '—'}</td>
            <td className="px-4 py-3 text-xs text-muted-foreground max-w-md">{e.message}</td>
            <td className="px-4 py-3 text-xs capitalize">{e.status.replace(/_/g, ' ')}</td>
            <td className="px-4 py-3">
              <StatusActions row={e} onChanged={reload} />
            </td>
          </tr>
        ))}
      </AdminTable>
    </AdminPageShell>
  );
}
