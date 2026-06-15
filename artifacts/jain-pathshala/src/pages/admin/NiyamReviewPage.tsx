import { useState } from 'react';
import { apiPost, ApiError } from '@/lib/api-client';
import { useAdminList } from '@/hooks/useAdminList';
import { toast } from '@/components/ui/toast-jp';
import { AdminPageShell, AdminTable, AdminError, AdminEmptyRow } from '@/components/admin/AdminPageShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { safeHref } from '@/lib/safe-url';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';

// Mirrors GET /v1/niyam-submissions/pending row shape exactly.
interface PendingRow {
  id: string;
  student_id: string;
  student_name: string;
  student_code: string;
  niyam_id: string;
  niyam_title_en: string;
  niyam_title_hi: string;
  proof_url: string | null;
  notes: string | null;
  submission_date: string;
}

function ApproveButton({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);

  async function approve() {
    if (busy) return;
    setBusy(true);
    try {
      await apiPost(`/v1/niyam-submissions/${id}/approve`, {});
      toast.success('Submission approved.');
      onChanged();
    } catch (err) {
      toast.error('Could not approve.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" onClick={approve} disabled={busy}>
      {busy ? '…' : 'Approve'}
    </Button>
  );
}

function RejectDialog({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await apiPost(`/v1/niyam-submissions/${id}/reject`, reason.trim() ? { reason: reason.trim() } : {});
      toast.success('Submission rejected.');
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
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">Reject</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Reject submission</DialogTitle></DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <div className="space-y-1">
            <Label className="text-xs font-medium">Reason (optional)</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this being rejected?"
              maxLength={300}
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

export default function NiyamReviewPage() {
  const { items, loading, error, reload } = useAdminList<PendingRow>('/v1/niyam-submissions/pending?limit=100');
  return (
    <AdminPageShell
      title="Niyam Review"
      subtitle="Approve or reject pending niyam submissions in your scope."
    >
      {error ? <AdminError message={error} /> : null}
      <AdminTable
        columns={['Student', 'Niyam', 'Date', 'Proof', 'Notes', 'Actions']}
        loading={loading}
        empty=""
        colSpan={6}
      >
        {items.length === 0 && !loading ? (
          <AdminEmptyRow colSpan={6} message="No pending submissions." />
        ) : null}
        {items.map((s) => (
          <tr key={s.id} className="hover:bg-muted/30">
            <td className="px-4 py-3">
              <div className="font-medium">{s.student_name}</div>
              <div className="font-mono text-xs text-muted-foreground">{s.student_code}</div>
            </td>
            <td className="px-4 py-3">{s.niyam_title_en}</td>
            <td className="px-4 py-3 text-xs text-muted-foreground">
              {new Date(s.submission_date).toLocaleDateString('en-GB')}
            </td>
            <td className="px-4 py-3 text-xs">
              {safeHref(s.proof_url) ? (
                <a
                  href={safeHref(s.proof_url)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline underline-offset-2"
                >
                  View
                </a>
              ) : (
                '—'
              )}
            </td>
            <td className="px-4 py-3 text-xs text-muted-foreground">{s.notes ?? '—'}</td>
            <td className="px-4 py-3">
              <div className="flex gap-1">
                <ApproveButton id={s.id} onChanged={reload} />
                <RejectDialog id={s.id} onChanged={reload} />
              </div>
            </td>
          </tr>
        ))}
      </AdminTable>
    </AdminPageShell>
  );
}
