import { useState } from 'react';
import { apiPost } from '@/lib/api-client';
import { describeApiError } from '@/lib/admin-error';
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

/* Status design tokens, not stock Tailwind colours (CTY-DSN-03). */
const STATUS_STYLES: Record<MsvRow['status'], string> = {
  none: 'bg-muted text-muted-foreground',
  applied: 'bg-status-warning-soft text-status-warning',
  waitlisted: 'bg-status-info-soft text-status-info',
  approved: 'bg-status-success-soft text-status-success',
  rejected: 'bg-status-error-soft text-status-error',
  revoked: 'bg-muted text-muted-foreground',
};

/**
 * Both decisions capture an optional note (CTY-API-08): approve used to POST
 * an empty body, so the admin's rationale — which the server stores and the
 * parent sees — was silently dropped on the approve side.
 */
function DecisionDialog({
  id,
  kind,
  onChanged,
}: {
  id: string;
  kind: 'approve' | 'reject';
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const approve = kind === 'approve';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiPost(
        `/v1/msv/${id}/${kind}`,
        approve ? { note: note.trim() || undefined } : { reason: note.trim() || undefined },
      );
      toast.success(approve ? 'Application approved.' : 'Application rejected.');
      setOpen(false);
      setNote('');
      onChanged();
    } catch (err) {
      const d = describeApiError(err, approve ? 'Could not approve' : 'Could not reject');
      toast.error(d.title, d.detail);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant={approve ? 'default' : 'secondary'} onClick={() => setOpen(true)}>
        {approve ? 'Approve' : 'Reject'}
      </Button>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{approve ? 'Approve MSV application' : 'Reject MSV application'}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <div className="space-y-1">
            <Label className="text-xs font-medium">{approve ? 'Note (optional)' : 'Reason (optional)'}</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                approve
                  ? 'Anything worth recording about this admission?'
                  : 'Why is this application being rejected?'
              }
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" variant={approve ? 'default' : 'secondary'} disabled={busy}>
              {busy ? (approve ? 'Approving…' : 'Rejecting…') : approve ? 'Approve' : 'Reject'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RowActions({ row, onChanged }: { row: MsvRow; onChanged: () => void }) {
  if (row.status !== 'applied' && row.status !== 'waitlisted') return null;

  return (
    <div className="flex gap-1">
      <DecisionDialog id={row.id} kind="approve" onChanged={onChanged} />
      <DecisionDialog id={row.id} kind="reject" onChanged={onChanged} />
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
