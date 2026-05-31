'use client';

/**
 * ShivirLiveBoard — client component that subscribes to
 * `/shivirs/:shivirId` over Socket.IO and updates the four stat cards +
 * live activity feed without a page refresh.
 *
 * Initial counters are seeded from the server fetch (no spinner on first
 * paint). Each `scan.completed` event arrives as a `RealtimeEnvelope`
 * payload — we splice the entry into the activity feed and apply a
 * lightweight delta to the counters in place.
 *
 * The session filter (a row of pills below the stat cards) navigates
 * the page via `?session_id=…` so the same component handles both
 * event-wide and per-session views.
 */

import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  CircleAlert,
  type LucideIcon,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import type { ShivirLiveResponse, ShivirRecentScan, ShivirScanKind } from '@/api/shivirs';

interface ScanCompletedPayload {
  shivir_event_id: string;
  shivir_session_id: string;
  student_id: string;
  student_full_name: string;
  student_code: string;
  scan_kind: ShivirScanKind;
  scanned_at: string;
  attendance_mode: 'in_out' | 'present_only';
}

interface RealtimeEnvelope<T> {
  event: string;
  emitted_at: string;
  data: T;
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'unauthorised';

interface SessionPill {
  id: string;
  day_number: number;
  session_date: string;
}

interface Props {
  shivirId: string;
  initial: ShivirLiveResponse;
  sessions: SessionPill[];
  activeSessionId: string | null;
}

const MAX_FEED_ITEMS = 30;

export function ShivirLiveBoard({ shivirId, initial, sessions, activeSessionId }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [counters, setCounters] = useState(initial.counters);
  const [feed, setFeed] = useState<ShivirRecentScan[]>(initial.recent_scans);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function connect(): Promise<void> {
      try {
        const res = await fetch('/api/admin/socket-auth', { credentials: 'include' });
        if (!res.ok) {
          setStatus('unauthorised');
          return;
        }
        const { access_token, api_base_url } = (await res.json()) as {
          access_token: string;
          api_base_url: string;
        };
        if (cancelled) return;
        const socket = io(`${api_base_url}/shivirs/${shivirId}`, {
          auth: { token: access_token },
          transports: ['websocket', 'polling'],
          withCredentials: true,
        });
        socketRef.current = socket;
        socket.on('connect', () => !cancelled && setStatus('connected'));
        socket.on('disconnect', () => !cancelled && setStatus('disconnected'));
        socket.on('connect_error', () => !cancelled && setStatus('disconnected'));
        socket.on('scan.completed', (envelope: RealtimeEnvelope<ScanCompletedPayload>) => {
          if (cancelled) return;
          // If the user is viewing a session-scoped view, filter the feed by it.
          if (activeSessionId && envelope.data.shivir_session_id !== activeSessionId) return;
          setFeed((prev) =>
            [
              {
                id: `${envelope.data.shivir_session_id}:${envelope.data.student_id}:${envelope.emitted_at}`,
                student_id: envelope.data.student_id,
                student_full_name: envelope.data.student_full_name,
                student_code: envelope.data.student_code,
                scan_kind: envelope.data.scan_kind,
                scanned_at: envelope.data.scanned_at,
              },
              ...prev,
            ].slice(0, MAX_FEED_ITEMS),
          );
          setCounters((prev) => applyDelta(prev, envelope.data));
        });
      } catch {
        if (!cancelled) setStatus('disconnected');
      }
    }
    void connect();
    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [shivirId, activeSessionId]);

  const onSessionChange = (id: string | null) => {
    const sp = new URLSearchParams(searchParams.toString());
    if (id) sp.set('session_id', id);
    else sp.delete('session_id');
    router.push(`?${sp.toString()}`);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-secondary">{initial.event.name}</h2>
          <p className="text-sm text-muted-foreground">
            {initial.event.start_date} → {initial.event.end_date}
          </p>
        </div>
        <Badge
          variant={
            status === 'connected' ? 'success' : status === 'unauthorised' ? 'error' : 'warning'
          }
        >
          {status === 'connected'
            ? 'Live'
            : status === 'unauthorised'
              ? 'Off'
              : status === 'connecting'
                ? 'Connecting…'
                : 'Reconnecting…'}
        </Badge>
      </header>

      {/* Session filter pills */}
      <div className="flex flex-wrap gap-2">
        <SessionPillBtn
          label="All sessions"
          active={activeSessionId === null}
          onClick={() => onSessionChange(null)}
        />
        {sessions.map((s) => (
          <SessionPillBtn
            key={s.id}
            label={`Day ${s.day_number} · ${s.session_date}`}
            active={activeSessionId === s.id}
            onClick={() => onSessionChange(s.id)}
          />
        ))}
      </div>

      {/* Stat cards — Registered / Currently In / Already Out / Not Arrived */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Registered" value={counters.registered} icon={Activity} tone="info" />
        <StatTile
          label="Currently in"
          value={counters.currently_in}
          icon={ArrowDownToLine}
          tone="success"
        />
        <StatTile
          label="Already out"
          value={counters.already_out}
          icon={ArrowUpFromLine}
          tone="warning"
        />
        <StatTile
          label="Not arrived"
          value={counters.not_arrived}
          icon={CircleAlert}
          tone="neutral"
        />
      </div>

      {/* Live activity feed */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Live activity</CardTitle>
            <CardDescription>Volunteers scanning, in real time.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {feed.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              Waiting for the first scan…
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {feed.map((s) => (
                <li key={s.id} className="flex items-start gap-3 py-3">
                  <KindBadge kind={s.scan_kind} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">
                      {s.student_full_name}{' '}
                      <span className="text-xs text-muted-foreground">({s.student_code})</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(s.scanned_at).toLocaleTimeString()}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatTile({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  tone: 'success' | 'warning' | 'info' | 'neutral';
}) {
  const ring =
    tone === 'success'
      ? 'ring-status-success/30'
      : tone === 'warning'
        ? 'ring-status-warning/30'
        : tone === 'info'
          ? 'ring-status-info/30'
          : 'ring-border';
  return (
    <Card className={`p-4 ring-1 ring-inset ${ring}`}>
      <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-sub">
        <span>{label}</span>
        <Icon className="size-4" />
      </div>
      <div className="mt-1 font-display text-3xl text-foreground">{value.toLocaleString()}</div>
    </Card>
  );
}

function SessionPillBtn({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-pill px-3 py-1 text-xs font-medium ring-1 ring-inset transition-colors ${
        active
          ? 'bg-primary text-primary-foreground ring-primary'
          : 'bg-transparent text-foreground ring-border hover:bg-muted/30'
      }`}
    >
      {label}
    </button>
  );
}

function KindBadge({ kind }: { kind: ShivirScanKind }) {
  if (kind === 'check_in') return <Badge variant="success">In</Badge>;
  if (kind === 'check_out') return <Badge variant="warning">Out</Badge>;
  return <Badge variant="info">Present</Badge>;
}

function applyDelta(
  prev: ShivirLiveResponse['counters'],
  scan: ScanCompletedPayload,
): ShivirLiveResponse['counters'] {
  // For present_only, every scan is a +1 to currently_in (and -1 from not_arrived).
  if (scan.attendance_mode === 'present_only') {
    return {
      ...prev,
      currently_in: prev.currently_in + 1,
      not_arrived: Math.max(0, prev.not_arrived - 1),
    };
  }
  // in_out: depending on scan_kind, move student between buckets.
  switch (scan.scan_kind) {
    case 'check_in':
      return {
        ...prev,
        currently_in: prev.currently_in + 1,
        already_out: prev.already_out, // re-entry: from already_out → in is handled by replacement
        not_arrived: Math.max(0, prev.not_arrived - 1),
      };
    case 'check_out':
      return {
        ...prev,
        currently_in: Math.max(0, prev.currently_in - 1),
        already_out: prev.already_out + 1,
      };
    default:
      return prev;
  }
}
