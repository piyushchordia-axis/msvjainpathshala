import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost, ApiError } from '@/lib/api-client';
import { useLocale } from '@/lib/locale-context';
import { toast } from '@/components/ui/toast-jp';
import { AdminPageShell, AdminTable, AdminError, AdminEmptyRow } from '@/components/admin/AdminPageShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { safeHref } from '@/lib/safe-url';
import {
  NIYAM_REJECT_REASON_MIN,
  NIYAM_REJECT_REASON_MAX,
  NIYAM_REJECT_REASON_PRESETS,
  isNiyamRejectReasonValid,
  trimRejectReason,
} from '@workspace/api-zod';
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
  /** Q12 — false when the row is outside the caller's batch write scope. */
  can_decide?: boolean;
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

type TabKey = 'open' | 'approved' | 'rejected';

const TABS: { key: TabKey; statusQuery: string[]; labelEn: string; labelHi: string }[] = [
  {
    // Auto-approved used to live only under "Recent" — admins never saw proofs
    // when they stayed on the default pending tab.
    key: 'open',
    statusQuery: ['pending', 'auto_approved'],
    labelEn: 'Open',
    labelHi: 'खुले',
  },
  {
    key: 'approved',
    statusQuery: ['approved'],
    labelEn: 'Approved',
    labelHi: 'स्वीकृत',
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
      ? 'rounded-full bg-status-warning-soft px-2 py-0.5 text-xs font-semibold text-status-warning'
      : status === 'auto_approved' || status === 'approved'
        ? 'rounded-full bg-status-success-soft px-2 py-0.5 text-xs font-semibold text-status-success'
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

function isImageProof(m: { kind: string; mime: string | null }): boolean {
  if ((m.mime ?? '').toLowerCase().startsWith('image/')) return true;
  return m.kind === 'photo';
}

function ProofCell({ row, hi }: { row: ReviewRow; hi: boolean }) {
  const media = row.media?.length
    ? row.media
    : row.proof_url
      ? [{ id: 'legacy', url: row.proof_url, kind: 'photo', mime: null, ordinal: 0 }]
      : [];

  if (media.length === 0) return <>—</>;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {media.map((m) => {
        const href = safeHref(m.url);
        if (!href) return null;
        if (isImageProof(m)) {
          return (
            <a
              key={m.id}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="block overflow-hidden rounded-md border border-border"
              title={t(hi, 'Open proof', 'प्रमाण खोलें')}
            >
              {/* The proof IS the content being reviewed — an empty alt told a
                  screen-reader user the decisive evidence was decoration. */}
              <img
                src={href}
                alt={
                  hi
                    ? `${row.student_name} का ${row.niyam_title_hi ?? row.niyam_title_en} के लिए प्रमाण`
                    : `Proof from ${row.student_name} for ${row.niyam_title_en}`
                }
                className="h-14 w-14 object-cover"
                loading="lazy"
              />
            </a>
          );
        }
        const label =
          m.kind === 'audio'
            ? t(hi, 'Open audio', 'ऑडियो खोलें')
            : m.kind === 'video'
              ? t(hi, 'Open video', 'वीडियो खोलें')
              : t(hi, 'Open proof', 'प्रमाण खोलें');
        return (
          <a
            key={m.id}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
          >
            {label}
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

  // Bounds and presets come from @workspace/api-zod, shared with the mobile
  // review sheet — this page used to inline 20/300 and offer no presets, so a
  // Guruji on web hand-typed 20+ characters for every rejection.
  const trimmed = trimRejectReason(reason);
  const valid = isNiyamRejectReasonValid(reason);

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
              {t(
                hi,
                `Reason (required, min ${NIYAM_REJECT_REASON_MIN} characters)`,
                `कारण (आवश्यक, न्यूनतम ${NIYAM_REJECT_REASON_MIN} अक्षर)`,
              )}
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {NIYAM_REJECT_REASON_PRESETS.map((p) => (
                <button
                  key={p.en}
                  type="button"
                  onClick={() => setReason(hi ? p.hi : p.en)}
                  className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-left text-xs hover:bg-muted"
                >
                  {hi ? p.hi : p.en}
                </button>
              ))}
            </div>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t(hi, 'Why is this being rejected?', 'यह क्यों अस्वीकृत किया जा रहा है?')}
              maxLength={NIYAM_REJECT_REASON_MAX}
              rows={3}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                {trimmed.length < NIYAM_REJECT_REASON_MIN
                  ? t(
                      hi,
                      `${NIYAM_REJECT_REASON_MIN - trimmed.length} more needed`,
                      `${NIYAM_REJECT_REASON_MIN - trimmed.length} और चाहिए`,
                    )
                  : t(hi, 'Looks good', 'ठीक है')}
              </span>
              <span>
                {trimmed.length}/{NIYAM_REJECT_REASON_MAX}
              </span>
            </div>
          </div>
          {/* M9 — rejection is terminal: Punya is reversed, the streak
              recomputed and any gallery item hidden, with no undo. Say so
              before the click, not after. */}
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {t(
              hi,
              'This cannot be undone: Punya is taken back, the streak is recalculated, and any photo is removed from the gallery. The parent is notified with your reason.',
              'यह वापस नहीं लिया जा सकता: पुण्य वापस लिया जाएगा, श्रृंखला दोबारा गिनी जाएगी, और फ़ोटो गैलरी से हट जाएगी। अभिभावक को आपका कारण भेजा जाएगा।',
            )}
          </p>
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

  const [tab, setTab] = useState<TabKey>('open');
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

  const [studentQuery, setStudentQuery] = useState('');

  // Bulk approve (L7). The endpoint is scope-checked, audited and tested — only
  // mobile ever called it, so a Sanchalak on web cleared 30 rows one at a time.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // Server-side ?q= search, same as PunyaAwardPage (CTY-PRF-02). The old
  // ?limit=500 <select> silently truncated: a student past the first 500 could
  // not be filtered for at all, with nothing on screen saying so.
  useEffect(() => {
    const q = studentQuery.trim();
    const timer = window.setTimeout(() => {
      const url = q
        ? `/v1/admin/students?limit=20&q=${encodeURIComponent(q)}`
        : '/v1/admin/students?limit=20';
      void apiGet<{ items: StudentOption[] }>(url).then((r) => setStudents(r?.items ?? []));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [studentQuery]);

  useEffect(() => {
    void apiGet<{ items: NiyamOption[] }>('/v1/admin/niyams').then((r) =>
      setNiyamOptions(r?.items ?? []),
    );
  }, []);

  const statusQuery = useMemo(
    () => TABS.find((x) => x.key === tab)?.statusQuery ?? ['pending', 'auto_approved'],
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
      // Ids from the previous view are meaningless against the new one.
      setSelected(new Set());
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

  /** Only a pending row the caller may decide can be bulk-approved. */
  const selectableIds = useMemo(
    () => items.filter((s) => s.status === 'pending' && s.can_decide !== false).map((s) => s.id),
    [items],
  );

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulkApprove() {
    const ids = selectableIds.filter((id) => selected.has(id));
    if (ids.length === 0 || bulkBusy) return;
    if (
      !window.confirm(
        t(
          hi,
          `Approve ${ids.length} submission(s)? Punya is awarded immediately.`,
          `${ids.length} जमा स्वीकृत करें? पुण्य तुरंत दिया जाएगा।`,
        ),
      )
    ) {
      return;
    }
    setBulkBusy(true);
    try {
      const res = await apiPost<{ results: Array<{ id: string; status: string }> }>(
        '/v1/niyam-submissions/bulk-approve',
        { submission_ids: ids },
      );
      const results = res?.results ?? [];
      const approved = results.filter((r) => r.status === 'approved').length;
      const skipped = results.length - approved;
      // Report skips rather than claiming a clean sweep — the server skips rows
      // that raced another reviewer or fell outside batch scope.
      if (skipped > 0) {
        toast.success(
          t(hi, `Approved ${approved}. ${skipped} skipped.`, `${approved} स्वीकृत। ${skipped} छोड़े गए।`),
        );
      } else {
        toast.success(t(hi, `Approved ${approved}.`, `${approved} स्वीकृत।`));
      }
      setSelected(new Set());
      void loadFirst();
    } catch (err) {
      toast.error(
        t(hi, 'Bulk approve failed.', 'सामूहिक स्वीकृति विफल।'),
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setBulkBusy(false);
    }
  }

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
        'Pending submissions need approval. Auto-approved work appears here too — open the proof, or reject within 30 days.',
        'लंबित जमा को स्वीकृति चाहिए। स्वतः-स्वीकृत कार्य भी यहाँ दिखता है — प्रमाण खोलें, या 30 दिनों में अस्वीकृत करें।',
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
          <Input
            className="h-9 min-w-[12rem]"
            value={studentQuery}
            onChange={(e) => setStudentQuery(e.target.value)}
            placeholder={t(hi, 'Search students…', 'छात्र खोजें…')}
          />
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
        {/* submission_date is an IST calendar date server-side, and the filter is
            compared against it as a plain date. Label the fields so a reviewer in
            another timezone does not read them as local. */}
        <div className="space-y-1">
          <Label className="text-xs">{t(hi, 'From (IST)', 'से (IST)')}</Label>
          <Input type="date" className="h-9 w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t(hi, 'To (IST)', 'तक (IST)')}</Label>
          <Input type="date" className="h-9 w-40" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      {error ? <AdminError message={error} /> : null}

      {selectableIds.length > 0 ? (
        <div className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="rounded"
              checked={selected.size > 0 && selected.size === selectableIds.length}
              ref={(el) => {
                if (el) el.indeterminate = selected.size > 0 && selected.size < selectableIds.length;
              }}
              onChange={(e) =>
                setSelected(e.target.checked ? new Set(selectableIds) : new Set())
              }
            />
            {t(hi, 'Select all pending', 'सभी लंबित चुनें')}
          </label>
          <span className="text-xs text-muted-foreground">
            {selected.size > 0
              ? t(hi, `${selected.size} selected`, `${selected.size} चुने गए`)
              : t(hi, `${selectableIds.length} approvable`, `${selectableIds.length} स्वीकार्य`)}
          </span>
          <div className="ml-auto">
            <Button size="sm" disabled={selected.size === 0 || bulkBusy} onClick={() => void bulkApprove()}>
              {bulkBusy
                ? t(hi, 'Approving…', 'स्वीकृत हो रहा…')
                : t(hi, `Approve ${selected.size}`, `${selected.size} स्वीकृत करें`)}
            </Button>
          </div>
        </div>
      ) : null}

      <AdminTable
        columns={[
          '',
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
        colSpan={9}
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
            colSpan={9}
            message={t(hi, 'No submissions in this view.', 'इस दृश्य में कोई जमा नहीं।')}
          />
        ) : null}
        {items.map((s) => {
          const chip = s.can_reject ? daysLeftChip(s.reversal_window_expires_at, hi) : null;
          return (
            <tr key={s.id} className="hover:bg-muted/30">
              <td className="px-4 py-3">
                {s.status === 'pending' && s.can_decide !== false ? (
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={selected.has(s.id)}
                    onChange={() => toggleOne(s.id)}
                    aria-label={t(hi, `Select ${s.student_name}`, `${s.student_name} चुनें`)}
                  />
                ) : null}
              </td>
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
                  <span className="rounded-full bg-status-info-soft px-2 py-0.5 font-semibold text-status-info">
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
                <ProofCell row={s} hi={hi} />
              </td>
              <td className="px-4 py-3 text-xs text-muted-foreground">{s.notes ?? '—'}</td>
              <td className="px-4 py-3">
                {/* Q12 — the list is centre-wide but the decide writes are
                    batch-bound. Explain rather than render a button that fails
                    with a bare "Submission not found." toast, exactly as the
                    mobile review screen does. */}
                {s.can_decide === false ? (
                  <span className="text-xs text-muted-foreground">
                    {t(hi, "Another Guruji's batch", 'अन्य गुरुजी का बैच')}
                  </span>
                ) : (
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
                )}
              </td>
            </tr>
          );
        })}
      </AdminTable>
    </AdminPageShell>
  );
}
