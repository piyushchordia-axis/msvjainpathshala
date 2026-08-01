import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost, ApiError } from '@/lib/api-client';
import { useLocale } from '@/lib/locale-context';
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface MediaRow {
  id: string;
  url: string;
  kind: string;
  mime: string | null;
  ordinal: number;
}

interface ReviewRow {
  id: string;
  student_id: string;
  student_name: string;
  student_code: string;
  niyam_id: string;
  niyam_title_en: string;
  niyam_title_hi: string | null;
  proof_url: string | null;
  notes: string | null;
  media?: MediaRow[];
  submission_date: string;
  status: string;
  points_awarded: number;
  created_at: string;
  can_reject: boolean;
  reversal_window_expires_at: string;
}

interface StudentOption {
  id: string;
  full_name: string;
  student_code?: string;
}

interface NiyamOption {
  id: string;
  title_en: string;
}

type TabKey = 'pending' | 'recent' | 'rejected';

const TABS: { key: TabKey; statusQuery: string[]; labelEn: string; labelHi: string }[] = [
  { key: 'pending', statusQuery: ['pending'], labelEn: 'Needs review', labelHi: 'समीक्षा आवश्यक' },
  {
    key: 'recent',
    statusQuery: ['auto_approved', 'approved'],
    labelEn: 'Recent',
    labelHi: 'हालिया',
  },
  { key: 'rejected', statusQuery: ['rejected'], labelEn: 'Rejected', labelHi: 'अस्वीकृत' },
];

function t(hi: boolean, en: string, hin: string) {
  return hi ? hin : en;
}

function AdminStatusPill({ status, hi }: { status: string; hi: boolean }) {
  const label =
    status === 'pending'
      ? t(hi, 'Pending', 'लंबित')
      : status === 'auto_approved'
        ? t(hi, 'Auto-approved', 'स्वतः स्वीकृत')
        : status === 'approved'
          ? t(hi, 'Approved', 'स्वीकृत')
          : status === 'rejected'
            ? t(hi, 'Rejected', 'अस्वीकृत')
            : status;
  const cls =
    status === 'pending'
      ? 'rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-700'
      : status === 'auto_approved' || status === 'approved'
        ? 'rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700'
        : status === 'rejected'
          ? 'rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive'
          : 'rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground';
  return <span className={cls}>{label}</span>;
}

function daysLeftChip(expiresAt: string, hi: boolean): string | null {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const days = Math.max(1, Math.ceil(ms / (24 * 60 * 60 * 1000)));
  return hi ? `${days} दिन शेष` : `${days} days left`;
}

function ProofCell({ row }: { row: ReviewRow }) {
  const media = row.media?.length
    ? row.media
    : row.proof_url
      ? [{ id: 'legacy', url: row.proof_url, kind: 'photo', mime: null, ordinal: 0 }]
      : [];

  if (media.length === 0) return <>—</>;

  return (
    <div className="flex flex-col gap-1">
      {media.map((m) => {
        const href = safeHref(m.url);
        if (!href) return null;
        return (
          <a
            key={m.id}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline underline-offset-2 capitalize"
          >
            {m.kind}
          </a>
        );
      })}
    </div>
  );
}

function ApproveButton({
  id,
  onChanged,
  hi,
}: {
  id: string;
  onChanged: () => void;
  hi: boolean;
}) {
  const [busy, setBusy] = useState(false);

  async function approve() {
    if (busy) return;
    setBusy(true);
    try {
      await apiPost(`/v1/niyam-submissions/${id}/approve`, {});
      toast.success(t(hi, 'Submission approved.', 'जमा स्वीकृत।'));
      onChanged();
    } catch (err) {
      toast.error(
        t(hi, 'Could not approve.', 'स्वीकृत नहीं हो सका।'),
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" onClick={approve} disabled={busy}>
      {busy ? '…' : t(hi, 'Approve', 'स्वीकृत करें')}
    </Button>
  );
}

function RejectDialog({
  id,
  canReject,
  onChanged,
  hi,
}: {
  id: string;
  canReject: boolean;
  onChanged: () => void;
  hi: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [inlineError, setInlineError] = useState<string | null>(null);

  const trimmed = reason.trim();
  const valid = trimmed.length >= 20 && trimmed.length <= 300;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !valid) return;
    setBusy(true);
    setInlineError(null);
    try {
      await apiPost(`/v1/niyam-submissions/${id}/reject`, { reason: trimmed });
      toast.success(t(hi, 'Submission rejected.', 'जमा अस्वीकृत।'));
      setOpen(false);
      setReason('');
      onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ERR_NIYAM_REVERSAL_WINDOW_EXPIRED') {
        setInlineError(
          t(
            hi,
            'The 30-day rejection window for this submission has closed.',
            'इस जमा के लिए 30-दिन की अस्वीकृति अवधि समाप्त हो चुकी है।',
          ),
        );
      } else {
        toast.error(
          t(hi, 'Could not reject.', 'अस्वीकृत नहीं हो सका।'),
          err instanceof ApiError ? err.message : undefined,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  const windowClosedTooltip = t(
    hi,
    'Rejection window closed — submissions can only be rejected within 30 days.',
    'अस्वीकृति अवधि बंद — जमा केवल 30 दिनों के भीतर अस्वीकृत किए जा सकते हैं।',
  );

  if (!canReject) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Button size="sm" variant="secondary" disabled>
                {t(hi, 'Reject', 'अस्वीकृत करें')}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">{windowClosedTooltip}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setInlineError(null);
          setReason('');
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          {t(hi, 'Reject', 'अस्वीकृत करें')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t(hi, 'Reject submission', 'जमा अस्वीकृत करें')}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <div className="space-y-1">
            <Label className="text-xs font-medium">
              {t(hi, 'Reason (required, min 20 characters)', 'कारण (आवश्यक, न्यूनतम 20 अक्षर)')}
            </Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t(hi, 'Why is this being rejected?', 'यह क्यों अस्वीकृत किया जा रहा है?')}
              maxLength={300}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                {trimmed.length < 20
                  ? t(hi, `${20 - trimmed.length} more needed`, `${20 - trimmed.length} और चाहिए`)
                  : t(hi, 'Looks good', 'ठीक है')}
              </span>
              <span>
                {trimmed.length}/300
              </span>
            </div>
          </div>
          {inlineError ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {inlineError}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t(hi, 'Cancel', 'रद्द')}
              </Button>
            </DialogClose>
            <Button type="submit" variant="secondary" disabled={busy || !valid}>
              {busy ? t(hi, 'Rejecting…', 'अस्वीकृत हो रहा…') : t(hi, 'Reject', 'अस्वीकृत करें')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function NiyamReviewPage() {
  const locale = useLocale();
  const hi = locale === 'hi';

  const [tab, setTab] = useState<TabKey>('recent');
  const [studentId, setStudentId] = useState('');
  const [niyamId, setNiyamId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [items, setItems] = useState<ReviewRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [students, setStudents] = useState<StudentOption[]>([]);
  const [niyamOptions, setNiyamOptions] = useState<NiyamOption[]>([]);

  useEffect(() => {
    void apiGet<{ items: StudentOption[] }>('/v1/admin/students?limit=500').then((r) =>
      setStudents(r?.items ?? []),
    );
    void apiGet<{ items: NiyamOption[] }>('/v1/admin/niyams').then((r) =>
      setNiyamOptions(r?.items ?? []),
    );
  }, []);

  const statusQuery = useMemo(
    () => TABS.find((x) => x.key === tab)?.statusQuery ?? ['auto_approved', 'approved'],
    [tab],
  );

  const buildPath = useCallback(
    (cursor: string | null) => {
      const params = new URLSearchParams();
      params.set('limit', '50');
      for (const s of statusQuery) params.append('status', s);
      if (studentId) params.set('student_id', studentId);
      if (niyamId) params.set('niyam_id', niyamId);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (cursor) params.set('cursor', cursor);
      return `/v1/admin/niyam-submissions?${params.toString()}`;
    },
    [statusQuery, studentId, niyamId, from, to],
  );

  const loadFirst = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{ items: ReviewRow[]; next_cursor: string | null }>(buildPath(null));
      setItems(res?.items ?? []);
      setNextCursor(res?.next_cursor ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t(hi, 'Could not load data.', 'डेटा लोड नहीं हुआ।'));
      setItems([]);
      setNextCursor(null);
    } finally {
      setLoading(false);
    }
  }, [buildPath, hi]);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await apiGet<{ items: ReviewRow[]; next_cursor: string | null }>(
        buildPath(nextCursor),
      );
      setItems((prev) => [...prev, ...(res?.items ?? [])]);
      setNextCursor(res?.next_cursor ?? null);
    } catch (err) {
      toast.error(
        t(hi, 'Could not load more.', 'और लोड नहीं हो सका।'),
        err instanceof Error ? err.message : undefined,
      );
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <AdminPageShell
      title={t(hi, 'Niyam Review', 'Niyam समीक्षा')}
      subtitle={t(
        hi,
        'Review pending submissions and retroactively reject recent auto-approved Niyam work in your scope.',
        'अपने दायरे में लंबित जमा की समीक्षा करें और हालिया स्वतः-स्वीकृत Niyam को अस्वीकृत करें।',
      )}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {TABS.map((f) => {
            const active = tab === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setTab(f.key)}
                className={[
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-foreground hover:bg-muted',
                ].join(' ')}
              >
                {hi ? f.labelHi : f.labelEn}
              </button>
            );
          })}
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">{t(hi, 'Student', 'छात्र')}</Label>
          <select
            className="h-9 min-w-[12rem] rounded-md border border-input bg-background px-2 text-sm"
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
          >
            <option value="">{t(hi, 'All students', 'सभी छात्र')}</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
                {s.student_code ? ` (${s.student_code})` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Niyam</Label>
          <select
            className="h-9 min-w-[12rem] rounded-md border border-input bg-background px-2 text-sm"
            value={niyamId}
            onChange={(e) => setNiyamId(e.target.value)}
          >
            <option value="">{t(hi, 'All Niyams', 'सभी Niyam')}</option>
            {niyamOptions.map((n) => (
              <option key={n.id} value={n.id}>
                {n.title_en}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t(hi, 'From', 'से')}</Label>
          <Input type="date" className="h-9 w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t(hi, 'To', 'तक')}</Label>
          <Input type="date" className="h-9 w-40" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      {error ? <AdminError message={error} /> : null}
      <AdminTable
        columns={[
          t(hi, 'Student', 'छात्र'),
          'Niyam',
          t(hi, 'Date', 'तिथि'),
          t(hi, 'Status', 'स्थिति'),
          t(hi, 'Window', 'अवधि'),
          t(hi, 'Proof', 'प्रमाण'),
          t(hi, 'Notes', 'नोट्स'),
          t(hi, 'Actions', 'कार्रवाई'),
        ]}
        loading={loading}
        empty=""
        colSpan={8}
        footer={
          nextCursor ? (
            <div className="flex justify-center p-3">
              <Button variant="outline" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore
                  ? t(hi, 'Loading…', 'लोड हो रहा…')
                  : t(hi, 'Load more', 'और लोड करें')}
              </Button>
            </div>
          ) : null
        }
      >
        {items.length === 0 && !loading ? (
          <AdminEmptyRow
            colSpan={8}
            message={t(hi, 'No submissions in this view.', 'इस दृश्य में कोई जमा नहीं।')}
          />
        ) : null}
        {items.map((s) => {
          const chip = s.can_reject ? daysLeftChip(s.reversal_window_expires_at, hi) : null;
          return (
            <tr key={s.id} className="hover:bg-muted/30">
              <td className="px-4 py-3">
                <div className="font-medium">{s.student_name}</div>
                <div className="font-mono text-xs text-muted-foreground">{s.student_code}</div>
              </td>
              <td className="px-4 py-3">
                {hi && s.niyam_title_hi ? s.niyam_title_hi : s.niyam_title_en}
              </td>
              <td className="px-4 py-3 text-xs text-muted-foreground">
                {new Date(s.submission_date).toLocaleDateString(hi ? 'hi-IN' : 'en-GB')}
              </td>
              <td className="px-4 py-3">
                <AdminStatusPill status={s.status} hi={hi} />
              </td>
              <td className="px-4 py-3 text-xs">
                {s.status === 'rejected' ? (
                  '—'
                ) : chip ? (
                  <span className="rounded-full bg-sky-500/10 px-2 py-0.5 font-semibold text-sky-700">
                    {chip}
                  </span>
                ) : s.can_reject ? (
                  '—'
                ) : (
                  <span className="text-muted-foreground">
                    {t(hi, 'Closed', 'बंद')}
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-xs">
                <ProofCell row={s} />
              </td>
              <td className="px-4 py-3 text-xs text-muted-foreground">{s.notes ?? '—'}</td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1">
                  {s.status === 'pending' ? (
                    <ApproveButton id={s.id} onChanged={loadFirst} hi={hi} />
                  ) : null}
                  {s.status === 'pending' ||
                  s.status === 'auto_approved' ||
                  s.status === 'approved' ? (
                    <RejectDialog
                      id={s.id}
                      canReject={s.can_reject}
                      onChanged={loadFirst}
                      hi={hi}
                    />
                  ) : null}
                </div>
              </td>
            </tr>
          );
        })}
      </AdminTable>
    </AdminPageShell>
  );
}
