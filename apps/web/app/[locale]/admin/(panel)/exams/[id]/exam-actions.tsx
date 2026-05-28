/**
 * Client subcomponent — "Generate OTP" and "Release results" actions.
 *
 *   - Generate OTP: one-click reveal. The current OTP (if already set)
 *     stays visible until rotated. Below the OTP we show "Valid until
 *     [+30min from window_start]" — once that time passes the OTP can no
 *     longer be used to start an attempt (server-side enforcement, SPEC §8.9).
 *
 *   - Release results: confirmation prompt, then POST. On success shows
 *     the awarded-Punya / pushes counts.
 */

'use client';

import { useRouter } from 'next/navigation';
import React, { useCallback, useState } from 'react';

export default function ExamActions({
  examId,
  existingOtp,
  windowStart,
  resultsReleased,
}: {
  examId: string;
  existingOtp: string | null;
  windowStart: string;
  resultsReleased: boolean;
}) {
  const router = useRouter();
  const [otp, setOtp] = useState<string | null>(existingOtp);
  const [generating, setGenerating] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [released, setReleased] = useState<null | {
    ranks_emitted: number;
    punya_awards: number;
    pushes_enqueued: number;
  }>(null);

  const validUntil = new Date(new Date(windowStart).getTime() + 30 * 60 * 1000);

  const generate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/exams/otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: examId }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(payload.error?.message ?? `Failed (${res.status})`);
      }
      const out = (await res.json()) as { data: { exam_otp: string } };
      setOtp(out.data.exam_otp);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate OTP');
    } finally {
      setGenerating(false);
    }
  }, [examId, router]);

  const release = useCallback(async () => {
    if (
      !confirm('Release results to all parents? This awards Punya and sends push notifications.')
    ) {
      return;
    }
    setReleasing(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/exams/release', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: examId }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(payload.error?.message ?? `Failed (${res.status})`);
      }
      const out = (await res.json()) as {
        data: { ranks_emitted: number; punya_awards: number; pushes_enqueued: number };
      };
      setReleased(out.data);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not release');
    } finally {
      setReleasing(false);
    }
  }, [examId, router]);

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-4">
        {otp ? (
          <div className="rounded-md border border-saffron bg-saffron-50 px-5 py-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-saffron-700">
              Current OTP
            </div>
            <div className="font-mono text-3xl font-bold tracking-[0.4em] text-saffron-700">
              {otp}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Valid until {validUntil.toLocaleString()}
            </div>
          </div>
        ) : (
          <p className="text-sm italic text-muted-foreground">
            No OTP generated yet — tap below to create one.
          </p>
        )}
        <button
          type="button"
          onClick={() => void generate()}
          disabled={generating}
          className="rounded-md bg-saffron px-5 py-2 text-sm font-semibold text-white hover:bg-saffron-700 disabled:opacity-60"
        >
          {generating ? 'Generating…' : otp ? 'Rotate OTP' : 'Generate OTP'}
        </button>
      </div>

      <hr className="border-border" />

      <div className="space-y-3">
        <h4 className="font-semibold text-secondary">Release results</h4>
        <p className="text-sm text-muted-foreground">
          Releases scores to every parent. Awards Punya: completion to each submitter, top-score to
          the top 3 by rank. Idempotent — safe if you tap twice.
        </p>
        <button
          type="button"
          onClick={() => void release()}
          disabled={releasing || resultsReleased}
          className="rounded-md bg-gold px-5 py-2 text-sm font-semibold text-white hover:bg-gold-300 disabled:opacity-60"
        >
          {resultsReleased
            ? 'Results already released'
            : releasing
              ? 'Releasing…'
              : 'Release results'}
        </button>
        {released ? (
          <div className="rounded-md border border-success/40 bg-success-bg p-3 text-sm text-success">
            Released — {released.ranks_emitted} students ranked, {released.punya_awards} Punya
            awards, {released.pushes_enqueued} pushes enqueued.
          </div>
        ) : null}
      </div>
    </div>
  );
}
