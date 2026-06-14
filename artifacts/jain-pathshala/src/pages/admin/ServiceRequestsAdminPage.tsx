import { useState } from 'react';
import { apiGet, apiPost, ApiError } from '@/lib/api-client';
import { useAdminList } from '@/hooks/useAdminList';
import { toast } from '@/components/ui/toast-jp';
import { AdminPageShell, AdminTable, AdminError, AdminEmptyRow } from '@/components/admin/AdminPageShell';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

// Row type mirrors the API list shape exactly (snake_case).
interface RequestRow {
  id: string;
  category: string;
  subject: string;
  status: 'submitted' | 'in_review' | 'resolved';
  parent_name: string | null;
  student_name: string | null;
  centre_name: string | null;
  assigned_name: string | null;
  last_response_at: string | null;
  resolved_at: string | null;
  created_at: string;
}

interface ThreadMessage {
  id: string;
  message: string;
  author_user_id: string | null;
  author_name: string | null;
  created_at: string;
}

interface RequestDetail {
  id: string;
  category: string;
  subject: string;
  description: string;
  status: 'submitted' | 'in_review' | 'resolved';
  parent_name: string | null;
  student_name: string | null;
  centre_name: string | null;
  assigned_to: string | null;
  last_response_at: string | null;
  resolved_at: string | null;
  created_at: string;
  messages: ThreadMessage[];
}

function statusVariant(status: string): 'default' | 'secondary' | 'outline' {
  if (status === 'resolved') return 'secondary';
  if (status === 'in_review') return 'default';
  return 'outline';
}

function fmt(ts: string): string {
  return new Date(ts).toLocaleString('en-GB');
}

function ThreadDialog({
  request,
  open,
  onOpenChange,
  onChanged,
}: {
  request: RequestRow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  async function loadDetail(id: string) {
    setLoading(true);
    try {
      const res = await apiGet<RequestDetail>(`/v1/service-requests/${id}`);
      setDetail(res);
    } catch (err) {
      toast.error('Failed to load request.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }

  function handleOpenChange(v: boolean) {
    onOpenChange(v);
    if (v && request) {
      setReply('');
      setDetail(null);
      void loadDetail(request.id);
    }
  }

  async function sendReply() {
    if (!request || !reply.trim()) return;
    setBusy('reply');
    try {
      await apiPost(`/v1/service-requests/${request.id}/messages`, { message: reply.trim() });
      toast.success('Reply sent.');
      setReply('');
      await loadDetail(request.id);
      onChanged();
    } catch (err) {
      toast.error('Failed to send reply.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  }

  async function doAction(action: 'assign' | 'resolve') {
    if (!request) return;
    setBusy(action);
    try {
      await apiPost(`/v1/service-requests/${request.id}/${action}`, {});
      toast.success(action === 'assign' ? 'Assigned to you.' : 'Marked resolved.');
      await loadDetail(request.id);
      onChanged();
    } catch (err) {
      toast.error('Action failed.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  }

  const status = detail?.status ?? request?.status;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{request?.subject ?? 'Service request'}</DialogTitle>
        </DialogHeader>

        {loading || !detail ? (
          <div className="py-8 text-center text-muted-foreground">Loading…</div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant={statusVariant(detail.status)} className="capitalize">
                {detail.status.replace('_', ' ')}
              </Badge>
              <span className="capitalize">{detail.category}</span>
              <span>·</span>
              <span>{detail.parent_name ?? '—'}</span>
              {detail.student_name ? <><span>·</span><span>{detail.student_name}</span></> : null}
              {detail.centre_name ? <><span>·</span><span>{detail.centre_name}</span></> : null}
            </div>

            <div className="rounded-md border bg-muted/20 p-3 text-sm">
              {detail.description}
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-medium">Thread</Label>
              <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {detail.messages.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No replies yet.</div>
                ) : (
                  detail.messages.map((m) => (
                    <div key={m.id} className="rounded-md border px-3 py-2">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{m.author_name ?? 'Unknown'}</span>
                        <span>{fmt(m.created_at)}</span>
                      </div>
                      <div className="mt-1 text-sm whitespace-pre-wrap">{m.message}</div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-medium">Reply</Label>
              <Textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                rows={3}
                placeholder="Write a response…"
              />
              <div className="flex justify-end">
                <Button size="sm" onClick={sendReply} disabled={busy !== null || !reply.trim()}>
                  {busy === 'reply' ? 'Sending…' : 'Send reply'}
                </Button>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t pt-3">
              <Button
                size="sm"
                variant="outline"
                onClick={() => doAction('assign')}
                disabled={busy !== null || status === 'resolved'}
              >
                {busy === 'assign' ? 'Assigning…' : 'Assign to me'}
              </Button>
              <Button
                size="sm"
                onClick={() => doAction('resolve')}
                disabled={busy !== null || status === 'resolved'}
              >
                {busy === 'resolve' ? 'Resolving…' : 'Resolve'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function ServiceRequestsAdminPage() {
  const { items, loading, error, reload } = useAdminList<RequestRow>('/v1/service-requests?limit=100');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<RequestRow | null>(null);

  function openThread(row: RequestRow) {
    setActive(row);
    setOpen(true);
  }

  return (
    <AdminPageShell
      title="Service requests"
      subtitle="Parent support requests in your scope. Open a request to reply, assign, or resolve."
    >
      {error ? <AdminError message={error} /> : null}
      <AdminTable
        columns={['Parent', 'Subject', 'Category', 'Status', 'Assigned', 'Created', '']}
        loading={loading}
        empty=""
        colSpan={7}
      >
        {items.length === 0 && !loading ? (
          <AdminEmptyRow colSpan={7} message="No service requests yet." />
        ) : null}
        {items.map((r) => (
          <tr key={r.id} className="hover:bg-muted/30">
            <td className="px-4 py-3 font-medium">
              {r.parent_name ?? '—'}
              {r.student_name ? (
                <div className="text-xs text-muted-foreground">{r.student_name}</div>
              ) : null}
            </td>
            <td className="px-4 py-3">{r.subject}</td>
            <td className="px-4 py-3 text-xs capitalize">{r.category}</td>
            <td className="px-4 py-3">
              <Badge variant={statusVariant(r.status)} className="capitalize">
                {r.status.replace('_', ' ')}
              </Badge>
            </td>
            <td className="px-4 py-3 text-xs text-muted-foreground">{r.assigned_name ?? '—'}</td>
            <td className="px-4 py-3 text-xs text-muted-foreground">
              {new Date(r.created_at).toLocaleDateString('en-GB')}
            </td>
            <td className="px-4 py-3 text-right">
              <Button size="sm" variant="outline" onClick={() => openThread(r)}>
                Open
              </Button>
            </td>
          </tr>
        ))}
      </AdminTable>

      <ThreadDialog request={active} open={open} onOpenChange={setOpen} onChanged={reload} />
    </AdminPageShell>
  );
}
