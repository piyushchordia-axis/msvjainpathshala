import { useState } from 'react';
import { apiPost, ApiError } from '@/lib/api-client';
import { useAdminList } from '@/hooks/useAdminList';
import { toast } from '@/components/ui/toast-jp';
import { AdminPageShell, AdminTable, AdminError, AdminEmptyRow } from '@/components/admin/AdminPageShell';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';

interface MsvRow {
  id: string;
  student_id: string;
  student_name: string;
  student_code: string;
  centre_name: string | null;
  status: 'none' | 'applied' | 'waitlisted' | 'approved' | 'rejected' | 'revoked';
  reason: string | null;
  created_at: string;
  decided_at: string | null;
}

const STATUS_STYLES: Record<MsvRow['status'], string> = {
  none: 'bg-muted text-muted-foreground',
  applied: 'bg-amber-100 text-amber-800',
  waitlisted: 'bg-blue-100 text-blue-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
  revoked: 'bg-zinc-200 text-zinc-700',
};

function RejectDialog({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiPost(`/v1/msv/${id}/reject`, { reason: reason.trim() || undefined });
      toast.success('Application rejected.');
      setOpen(false);
      setReason('');
      onChanged();
    } catch (err) {
      toast.error('Could not reject.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Reject</Button>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Reject MSV application</DialogTitle></DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <div className="space-y-1">
            <Label className="text-xs font-medium">Reason (optional)</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this application being rejected?"
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" variant="secondary" disabled={busy}>{busy ? 'Rejecting…' : 'Reject'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RowActions({ row, onChanged }: { row: MsvRow; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);

  async function approve() {
    if (busy) return;
    setBusy(true);
    try {
      await apiPost(`/v1/msv/${row.id}/approve`, {});
      toast.success('Application approved.');
      onChanged();
    } catch (err) {
      toast.error('Could not approve.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  if (row.status !== 'applied' && row.status !== 'waitlisted') return null;

  return (
    <div className="flex gap-1">
      <Button size="sm" onClick={approve} disabled={busy}>{busy ? '…' : 'Approve'}</Button>
      <RejectDialog id={row.id} onChanged={onChanged} />
    </div>
  );
}

export default function MsvAdminPage() {
  const { items, loading, error, reload } = useAdminList<MsvRow>('/v1/msv?limit=100');
  return (
    <AdminPageShell title="MSV applications" subtitle="Megh Sanskar Vatika programme applications in your scope.">
      {error ? <AdminError message={error} /> : null}
      <AdminTable
        columns={['Student', 'Code', 'Centre', 'Status', 'Reason', 'Applied', 'Actions']}
        loading={loading}
        empty=""
        colSpan={7}
      >
        {items.length === 0 && !loading ? <AdminEmptyRow colSpan={7} message="No MSV applications." /> : null}
        {items.map((m) => (
          <tr key={m.id} className="hover:bg-muted/30">
            <td className="px-4 py-3 font-medium">{m.student_name}</td>
            <td className="px-4 py-3 font-mono text-xs">{m.student_code}</td>
            <td className="px-4 py-3 text-xs">{m.centre_name ?? '—'}</td>
            <td className="px-4 py-3">
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${STATUS_STYLES[m.status]}`}>
                {m.status}
              </span>
            </td>
            <td className="px-4 py-3 text-xs text-muted-foreground">{m.reason ?? '—'}</td>
            <td className="px-4 py-3 text-xs text-muted-foreground">
              {new Date(m.created_at).toLocaleDateString('en-GB')}
            </td>
            <td className="px-4 py-3">
              <RowActions row={m} onChanged={reload} />
            </td>
          </tr>
        ))}
      </AdminTable>
    </AdminPageShell>
  );
}
