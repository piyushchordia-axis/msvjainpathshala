'use client';

/**
 * Submission row — client component that owns the reject modal. The 30-day
 * window check happens BOTH in the UI (button disabled + tooltip) and on
 * the server (ERR_NIYAM_REVERSAL_WINDOW_EXPIRED 409). UI feels honest
 * either way.
 *
 * Reason field must be ≥ 20 chars; matches the SPEC §6.10 validation.
 * Server returns the same error code if the UI is bypassed.
 */

import { useState, useTransition } from 'react';

import type { NiyamSubmissionRow } from '@/api/niyams';

const REJECT_WINDOW_DAYS = 30;
const REJECT_WINDOW_MS = REJECT_WINDOW_DAYS * 24 * 3600 * 1000;

interface Props {
  row: NiyamSubmissionRow;
}

interface SubmitState {
  ok: boolean;
  code?: string;
  message: string;
}

export function SubmissionRow({ row }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<SubmitState | null>(null);
  const [pending, startTransition] = useTransition();
  const [hidden, setHidden] = useState(false);

  const submittedAt = new Date(row.submitted_at);
  const expired = Date.now() - submittedAt.getTime() > REJECT_WINDOW_MS;
  const alreadyRejected = row.status === 'rejected';
  const disabled = expired || alreadyRejected;

  function submitReject() {
    if (reason.trim().length < 20) {
      setResult({
        ok: false,
        message: 'Reason must be at least 20 characters.',
      });
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/niyams/reject', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: row.id, reason: reason.trim() }),
        });
        const body = await res.json();
        if (!res.ok) {
          setResult({
            ok: false,
            code: body?.error?.code,
            message: body?.error?.message ?? `HTTP ${res.status}`,
          });
          return;
        }
        setResult({ ok: true, message: 'Submission rejected. Punya reversed.' });
        setHidden(true);
        setTimeout(() => setOpen(false), 1500);
      } catch (err) {
        setResult({
          ok: false,
          message: err instanceof Error ? err.message : 'Network error',
        });
      }
    });
  }

  if (hidden) return null;

  return (
    <>
      <tr className="hover:bg-muted/30">
        <td className="px-4 py-3">
          <div className="text-foreground">{submittedAt.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground">{row.submission_date}</div>
        </td>
        <td className="px-4 py-3">
          <StatusBadge status={row.status} />
        </td>
        <td className="px-4 py-3 text-right font-semibold">+{row.points_value}</td>
        <td className="px-4 py-3">
          <code className="font-mono text-[11px] text-muted-foreground">
            {row.proof_asset_id.slice(0, 8)}…
          </code>
        </td>
        <td className="px-4 py-3 text-right">
          {alreadyRejected ? (
            <span className="text-xs italic text-muted-foreground">Already rejected</span>
          ) : (
            <button
              type="button"
              onClick={() => setOpen(true)}
              disabled={disabled}
              title={expired ? 'Rejection window closed' : 'Reject submission'}
              className={
                disabled
                  ? 'cursor-not-allowed rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground'
                  : 'rounded-md border border-destructive/40 bg-destructive/5 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/10'
              }
            >
              Reject
            </button>
          )}
        </td>
      </tr>

      {open ? (
        <tr>
          <td colSpan={5} className="bg-muted/30 px-4 py-4">
            <div className="rounded-md border border-border bg-background p-4">
              <div className="mb-2 text-sm font-semibold text-foreground">
                Reject submission — Punya will be reversed
              </div>
              <p className="mb-3 text-xs text-muted-foreground">
                Reason will be sent to the parent. Minimum 20 characters.
              </p>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                disabled={pending}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="Reason for rejection (≥ 20 characters)"
              />
              {result ? (
                <div
                  className={
                    result.ok
                      ? 'mt-3 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-success'
                      : 'mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive'
                  }
                >
                  {result.message}
                  {result.code === 'ERR_NIYAM_REVERSAL_WINDOW_EXPIRED' ? (
                    <span className="block text-[11px] text-destructive/70">
                      Rejections are only allowed within 30 days of the submission.
                    </span>
                  ) : null}
                </div>
              ) : null}
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setResult(null);
                    setReason('');
                  }}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitReject}
                  disabled={pending}
                  className="rounded-md bg-destructive px-3 py-1.5 text-xs font-semibold text-destructive-foreground hover:bg-destructive/90 disabled:cursor-not-allowed disabled:bg-destructive/60"
                >
                  {pending ? 'Rejecting…' : 'Confirm reject'}
                </button>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function StatusBadge({ status }: { status: 'auto_approved' | 'rejected' }) {
  if (status === 'auto_approved') {
    return (
      <span className="rounded-pill bg-success/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-success">
        Approved
      </span>
    );
  }
  return (
    <span className="rounded-pill bg-destructive/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-destructive">
      Rejected
    </span>
  );
}
