import { useEffect, useState } from 'react';
import { Plus, ClipboardList, Pencil, Trash2, Paperclip } from 'lucide-react';
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from '@/lib/api-client';
import { useAdminList } from '@/hooks/useAdminList';
import { toast } from '@/components/ui/toast-jp';
import { AdminPageShell, AdminTable, AdminError, AdminEmptyRow } from '@/components/admin/AdminPageShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { safeHref } from '@/lib/safe-url';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';

type UploadResult = { url: string; key: string };

/** Multipart upload to /v1/uploads (folder=homework). */
async function uploadHomeworkFile(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append('file', file);
  form.append('folder', 'homework');
  const res = await fetch(`${API_BASE}/v1/uploads`, {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json' },
    body: form,
  });
  if (!res.ok) {
    let code = 'ERR_UPLOAD';
    let message = res.statusText;
    try {
      const j = (await res.json()) as { error?: { code?: string; message?: string } };
      code = j.error?.code ?? code;
      message = j.error?.message ?? message;
    } catch {
      /* ignore */
    }
    throw new ApiError(code, message, res.status);
  }
  const json = (await res.json()) as { data: UploadResult };
  return json.data;
}
interface AssignmentRow {
  id: string;
  title: string;
  description: string | null;
  due_date: string;
  attachment_url: string | null;
  is_msv: boolean;
  batch_id: string;
  batch_name: string | null;
  centre_name: string;
  created_at: string;
  total: number;
  submitted: number;
  graded: number;
  overdue: number;
}

interface BatchOption { id: string; name: string | null; centre_name: string; }

interface SubmissionRow {
  id: string;
  student_id: string;
  student_name: string;
  student_code: string;
  status: 'pending' | 'submitted' | 'approved' | 'starred' | 'late' | 'acknowledged' | 'returned';
  submission_url: string | null;
  feedback_note: string | null;
  late: boolean;
  marked_at: string | null;
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-xs font-medium">{label}</Label>{children}</div>;
}

function fmtDate(d: string): string {
  // due_date is 'YYYY-MM-DD'; render as locale date without TZ drift.
  return new Date(`${d}T00:00:00`).toLocaleDateString('en-GB');
}

function StatusPill({ status }: { status: string }) {
  const cls: Record<string, string> = {
    pending: 'bg-muted text-muted-foreground',
    submitted: 'bg-sky-500/10 text-sky-700',
    acknowledged: 'bg-amber-500/10 text-amber-800',
    approved: 'bg-emerald-500/10 text-emerald-700',
    starred: 'bg-amber-500/10 text-amber-700',
    late: 'bg-rose-500/10 text-rose-700',
    returned: 'bg-orange-500/10 text-orange-800',
  };
  const label =
    status === 'acknowledged' ? 'Marked done'
    : status === 'returned' ? 'Returned'
    : status;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${cls[status] ?? 'bg-muted text-muted-foreground'}`}>
      {label}
    </span>
  );
}

function NewAssignmentDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [batches, setBatches] = useState<BatchOption[]>([]);
  const [batchId, setBatchId] = useState('');
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [description, setDescription] = useState('');
  const [attachmentUrl, setAttachmentUrl] = useState('');

  useEffect(() => {
    if (!open) return;
    void apiGet<{ items: BatchOption[] }>('/v1/admin/batches').then((r) => setBatches(r?.items ?? []));
  }, [open]);

  async function onPickAttachment(file: File | null) {
    if (!file) return;
    setUploading(true);
    try {
      const uploaded = await uploadHomeworkFile(file);
      setAttachmentUrl(uploaded.url);
      toast.success('Worksheet uploaded.');
    } catch (err) {
      toast.error('Could not upload worksheet.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setUploading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!batchId || !title.trim() || !dueDate) return;
    setBusy(true);
    try {
      const res = await apiPost<{ submissions_created: number }>('/v1/homework/assignments', {
        batch_id: batchId,
        title: title.trim(),
        due_date: dueDate,
        description: description.trim() || undefined,
        ...(attachmentUrl.trim() ? { attachment_url: attachmentUrl.trim() } : {}),
      });
      toast.success('Assignment created.', `${res?.submissions_created ?? 0} student(s) assigned.`);
      setOpen(false);
      setBatchId(''); setTitle(''); setDueDate(''); setDescription(''); setAttachmentUrl('');
      onAdded();
    } catch (err) {
      toast.error('Failed to create assignment.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-1 h-4 w-4" />New assignment</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>New homework assignment</DialogTitle></DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <FormRow label="Batch *">
            <Select value={batchId} onValueChange={setBatchId}>
              <SelectTrigger><SelectValue placeholder="Select batch" /></SelectTrigger>
              <SelectContent>
                {batches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {(b.name ?? 'Batch')} · {b.centre_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormRow>
          <FormRow label="Title *">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Learn the Navkar Mantra" required />
          </FormRow>
          <FormRow label="Due date *">
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
          </FormRow>
          <FormRow label="Description">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Optional instructions" />
          </FormRow>
          <FormRow label="Worksheet (optional)">
            <Input
              type="file"
              accept="image/*,application/pdf"
              disabled={uploading || busy}
              onChange={(e) => void onPickAttachment(e.target.files?.[0] ?? null)}
            />
            {attachmentUrl ? (
              <p className="truncate text-xs text-muted-foreground">
                Attached — families will see this on their homework feed.
              </p>
            ) : null}
          </FormRow>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={busy || uploading || !batchId || !title.trim() || !dueDate}>
              {busy ? 'Saving…' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditAssignmentDialog({
  assignment,
  onSaved,
}: {
  assignment: AssignmentRow;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState(assignment.title);
  const [dueDate, setDueDate] = useState(assignment.due_date);
  const [description, setDescription] = useState(assignment.description ?? '');
  const [attachmentUrl, setAttachmentUrl] = useState(assignment.attachment_url ?? '');
  const [isMsv, setIsMsv] = useState(assignment.is_msv);

  useEffect(() => {
    if (!open) return;
    setTitle(assignment.title);
    setDueDate(assignment.due_date);
    setDescription(assignment.description ?? '');
    setAttachmentUrl(assignment.attachment_url ?? '');
    setIsMsv(assignment.is_msv);
  }, [open, assignment]);

  async function onPickAttachment(file: File | null) {
    if (!file) return;
    setUploading(true);
    try {
      const uploaded = await uploadHomeworkFile(file);
      setAttachmentUrl(uploaded.url);
      toast.success('Worksheet uploaded.');
    } catch (err) {
      toast.error('Could not upload worksheet.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setUploading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !dueDate) return;
    setBusy(true);
    try {
      await apiPatch(`/v1/homework/assignments/${assignment.id}`, {
        title: title.trim(),
        due_date: dueDate,
        // Correcting a due date backwards is allowed with an explicit flag (FIX #19).
        ...(dueDate < new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
          ? { allow_past_due_date: true }
          : {}),
        description: description.trim() || null,
        attachment_url: attachmentUrl.trim() || null,
        is_msv: isMsv,
      });
      toast.success('Assignment updated.');
      setOpen(false);
      onSaved();
    } catch (err) {
      toast.error('Could not update assignment.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" aria-label="Edit assignment">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Edit homework assignment</DialogTitle></DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <FormRow label="Title *">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </FormRow>
          <FormRow label="Due date *">
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
          </FormRow>
          <FormRow label="Description">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </FormRow>
          <FormRow label="Worksheet">
            <Input
              type="file"
              accept="image/*,application/pdf"
              disabled={uploading || busy}
              onChange={(e) => void onPickAttachment(e.target.files?.[0] ?? null)}
            />
            {attachmentUrl ? (
              <div className="flex items-center gap-2 text-xs">
                <a
                  href={safeHref(attachmentUrl) ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-primary underline"
                >
                  Current worksheet
                </a>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2"
                  onClick={() => setAttachmentUrl('')}
                >
                  Remove
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No worksheet attached.</p>
            )}
          </FormRow>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isMsv} onChange={(e) => setIsMsv(e.target.checked)} />
            MSV assignment
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={busy || uploading || !title.trim() || !dueDate}>
              {busy ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteAssignmentButton({
  assignment,
  onDeleted,
}: {
  assignment: AssignmentRow;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const graded = assignment.graded;

  async function confirmDelete(force: boolean) {
    setBusy(true);
    try {
      await apiDelete(`/v1/homework/assignments/${assignment.id}`, force ? { force_delete: true } : {});
      toast.success('Assignment removed.');
      setOpen(false);
      onDeleted();
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409 && !force) {
        toast.error('Graded work on this assignment.', err.message);
        return;
      }
      toast.error('Could not delete assignment.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" aria-label="Delete assignment">
          <Trash2 className="h-3.5 w-3.5 text-destructive" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Delete assignment?</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          “{assignment.title}” will be hidden from parents and the admin list.
          {graded > 0
            ? ` ${graded} graded submission(s) already awarded Punya — deleting will reverse those awards.`
            : ' No graded submissions yet, so no Punya will be reversed.'}
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <DialogClose asChild><Button type="button" variant="outline" disabled={busy}>Cancel</Button></DialogClose>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => void confirmDelete(graded > 0)}
          >
            {busy ? 'Deleting…' : graded > 0 ? 'Delete and reverse Punya' : 'Delete'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GradeButtons({ submission, onGraded }: { submission: SubmissionRow; onGraded: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState(submission.feedback_note ?? '');
  // Only send feedback_note when the Guruji actually edits the box — an empty
  // unedited field must not wipe existing feedback (FIX #13).
  const [feedbackEdited, setFeedbackEdited] = useState(false);

  const graded = submission.status === 'approved' || submission.status === 'starred';
  const canReturn =
    submission.status === 'submitted' ||
    submission.status === 'late' ||
    submission.status === 'acknowledged' ||
    graded;

  async function grade(status: 'approved' | 'starred' | 'returned') {
    if (busy) return;
    if (status === 'returned' && !feedback.trim()) {
      toast.error('Add a short note explaining what to fix before returning.');
      return;
    }
    setBusy(status);
    try {
      const body: { status: 'approved' | 'starred' | 'returned'; feedback_note?: string | null } = { status };
      if (status === 'returned' || feedbackEdited) {
        body.feedback_note = feedback.trim() || null;
      }
      await apiPost(`/v1/homework/submissions/${submission.id}/grade`, body);
      toast.success(
        status === 'returned'
          ? 'Returned for rework.'
          : status === 'starred'
            ? 'Submission starred.'
            : 'Submission approved.',
      );
      onGraded();
    } catch (err) {
      toast.error('Could not grade submission.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  }

  if (submission.status === 'returned' || submission.status === 'pending') {
    return (
      <p className="text-xs text-muted-foreground">
        {submission.status === 'returned' ? 'Waiting for resubmission.' : 'Not submitted yet.'}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <Input
        value={feedback}
        onChange={(e) => {
          setFeedback(e.target.value);
          setFeedbackEdited(true);
        }}
        placeholder={canReturn ? 'Feedback (required to return)' : 'Feedback (optional)'}
        className="h-8 text-xs"
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => grade('approved')}>
          {busy === 'approved' ? '…' : 'Approve'}
        </Button>
        <Button size="sm" disabled={!!busy} onClick={() => grade('starred')}>
          {busy === 'starred' ? '…' : 'Star'}
        </Button>
        {canReturn ? (
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => grade('returned')}>
            {busy === 'returned' ? '…' : 'Return'}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function SubmissionsDialog({ assignment }: { assignment: AssignmentRow }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<SubmissionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmBulk, setConfirmBulk] = useState<{
    work_kind: 'all' | 'uploaded' | 'acknowledged';
    label: string;
    count: number;
  } | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{ items: SubmissionRow[] }>(`/v1/homework/assignments/${assignment.id}/submissions`);
      setItems(res?.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load submissions.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (open) void load(); }, [open]);

  const gradeable = items.filter((s) =>
    s.status === 'submitted' || s.status === 'late' || s.status === 'acknowledged',
  );
  const uploadedReady = gradeable.filter((s) => !!s.submission_url);
  const acknowledgedReady = gradeable.filter((s) => s.status === 'acknowledged' && !s.submission_url);

  function askBulk(work_kind: 'all' | 'uploaded' | 'acknowledged', label: string, count: number) {
    if (count === 0) {
      toast.error('Nothing ready to approve for that action.');
      return;
    }
    setConfirmBulk({ work_kind, label, count });
  }

  async function runBulk() {
    if (!confirmBulk || bulkBusy) return;
    setBulkBusy(true);
    try {
      const res = await apiPost<{
        results: Array<{ submission_id: string; status: string; awarded: number }>;
        summary: { graded: number; skipped: number; failed: number; points_awarded: number; points_per_student: number };
      }>(`/v1/homework/assignments/${assignment.id}/grade-all`, {
        status: 'approved',
        only_ungraded: true,
        work_kind: confirmBulk.work_kind,
      });
      const s = res?.summary;
      toast.success(
        `Approved ${s?.graded ?? 0} submission(s).`,
        s
          ? `${s.points_awarded} Punya awarded${s.skipped ? `; ${s.skipped} skipped` : ''}${s.failed ? `; ${s.failed} failed` : ''}.`
          : undefined,
      );
      setConfirmBulk(null);
      await load();
    } catch (err) {
      toast.error('Bulk grade failed.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setConfirmBulk(null); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">Submissions</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{assignment.title}</DialogTitle></DialogHeader>
        {error ? <AdminError message={error} /> : null}

        {!loading && gradeable.length > 0 ? (
          <div className="flex flex-wrap gap-2 border-b border-border pb-3">
            <Button
              size="sm"
              variant="secondary"
              disabled={bulkBusy || uploadedReady.length === 0}
              onClick={() => askBulk('uploaded', 'Approve all uploaded work', uploadedReady.length)}
            >
              Approve uploaded ({uploadedReady.length})
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={bulkBusy || acknowledgedReady.length === 0}
              onClick={() => askBulk('acknowledged', 'Approve all marked done', acknowledgedReady.length)}
            >
              Approve marked done ({acknowledgedReady.length})
            </Button>
            <Button
              size="sm"
              disabled={bulkBusy || gradeable.length === 0}
              onClick={() => askBulk('all', 'Approve all ready work', gradeable.length)}
            >
              Approve all ({gradeable.length})
            </Button>
          </div>
        ) : null}

        {confirmBulk ? (
          <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
            <p className="font-medium">{confirmBulk.label}?</p>
            <p className="mt-1 text-muted-foreground">
              This will approve {confirmBulk.count} submission(s) and award Punya for each.
              Already-graded rows are skipped. Per-row Approve / Star / Return still work below.
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <Button type="button" size="sm" variant="outline" disabled={bulkBusy} onClick={() => setConfirmBulk(null)}>
                Cancel
              </Button>
              <Button type="button" size="sm" disabled={bulkBusy} onClick={() => void runBulk()}>
                {bulkBusy ? 'Approving…' : `Confirm approve ${confirmBulk.count}`}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="max-h-[60vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Student</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Work</th>
                <th className="px-3 py-2">Grade</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">No submissions.</td></tr>
              ) : (
                items.map((s) => (
                  <tr key={s.id} className="hover:bg-muted/30 align-top">
                    <td className="px-3 py-3">
                      <div className="font-medium">{s.student_name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{s.student_code}</div>
                    </td>
                    <td className="px-3 py-3"><StatusPill status={s.status} /></td>
                    <td className="px-3 py-3 text-xs">
                      {safeHref(s.submission_url) ? (
                        <a href={safeHref(s.submission_url)} target="_blank" rel="noreferrer" className="text-primary underline">View</a>
                      ) : s.status === 'acknowledged' ? (
                        <span className="text-amber-800">Parent marked done</span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-3">
                      <GradeButtons submission={s} onGraded={load} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function HomeworkPage() {
  const [overdueOnly, setOverdueOnly] = useState(false);
  const listPath = overdueOnly
    ? '/v1/homework/assignments?limit=100&overdue=1'
    : '/v1/homework/assignments?limit=100';
  const { items, loading, error, reload } = useAdminList<AssignmentRow>(listPath, [overdueOnly]);

  return (
    <AdminPageShell
      title="Homework"
      subtitle="Assignments across your batches, with submission progress."
      actions={
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={overdueOnly}
              onChange={(e) => setOverdueOnly(e.target.checked)}
            />
            Overdue only
          </label>
          <NewAssignmentDialog onAdded={reload} />
        </div>
      }
    >
      {error ? <AdminError message={error} /> : null}
      <AdminTable
        columns={['Assignment', 'Batch', 'Due', 'Submitted', 'Graded', 'Overdue', 'Actions']}
        loading={loading}
        empty=""
        colSpan={7}
      >
        {items.length === 0 && !loading ? <AdminEmptyRow colSpan={7} message="No homework assigned yet." /> : null}
        {items.map((a) => (
          <tr key={a.id} className="hover:bg-muted/30">
            <td className="px-4 py-3 font-medium">
              <span className="inline-flex items-center gap-1.5">
                <ClipboardList className="h-3.5 w-3.5 text-muted-foreground" />
                {a.title}
              </span>
              {a.is_msv ? <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">MSV</span> : null}
              {a.attachment_url ? (
                <a
                  href={safeHref(a.attachment_url) ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-2 inline-flex items-center gap-1 text-xs text-primary underline"
                  title="Worksheet attached"
                >
                  <Paperclip className="h-3 w-3" />
                  Worksheet
                </a>
              ) : null}
            </td>
            <td className="px-4 py-3 text-xs text-muted-foreground">
              {a.batch_name || '—'}<span className="block">{a.centre_name}</span>
            </td>
            <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(a.due_date)}</td>
            <td className="px-4 py-3 text-xs">{a.submitted}/{a.total}</td>
            <td className="px-4 py-3 text-xs">{a.graded}/{a.total}</td>
            <td className="px-4 py-3 text-xs">
              {(a.overdue ?? 0) > 0 ? (
                <span className="font-semibold text-rose-700">{a.overdue}</span>
              ) : (
                '0'
              )}
            </td>
            <td className="px-4 py-3">
              <div className="flex items-center gap-1">
                <SubmissionsDialog assignment={a} />
                <EditAssignmentDialog assignment={a} onSaved={reload} />
                <DeleteAssignmentButton assignment={a} onDeleted={reload} />
              </div>
            </td>
          </tr>
        ))}
      </AdminTable>
    </AdminPageShell>
  );
}
