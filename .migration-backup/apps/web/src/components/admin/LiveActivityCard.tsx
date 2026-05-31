'use client';

/**
 * LiveActivityCard — subscribes to `/admin-dashboard/:cityId` over
 * Socket.IO and renders the last 20 events. No page refresh needed.
 *
 * Token + city resolution: a server-side handler (`/api/admin/socket-auth`)
 * reads the httpOnly access cookie and returns `{access_token, city_id,
 * api_base_url}`. We connect to `${api_base_url}/admin-dashboard/${city_id}`
 * with `auth: { token }` — the backend gateway verifies the JWT before
 * letting the client join the namespace.
 *
 * Visual: mirrors `jp-design-system/ui_kits/admin/screens.jsx` Awaiting-
 * Approval panel layout (header + list rows, separators between rows).
 */

import { ArrowRight, CircleAlert, GraduationCap, Megaphone, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

interface AdminDashboardActivity {
  event: string;
  city_id: string;
  actor_role?: string;
  summary_en: string;
  summary_hi: string;
  source_entity_kind?: string;
  source_entity_id?: string;
  at: string;
}

interface RealtimeEnvelope<T> {
  event: string;
  emitted_at: string;
  data: T;
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'unauthorised';

const MAX_ITEMS = 20;

function iconFor(event: string): LucideIcon {
  if (event.startsWith('enrolment')) return GraduationCap;
  if (event.startsWith('notice') || event === 'centre_holiday_announced') return Megaphone;
  return CircleAlert;
}

function timeAgo(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} d ago`;
}

export function LiveActivityCard(): React.JSX.Element {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [items, setItems] = useState<AdminDashboardActivity[]>([]);
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
        const { access_token, city_id, api_base_url } = (await res.json()) as {
          access_token: string;
          city_id: string | null;
          api_base_url: string;
        };
        if (cancelled) return;
        if (!city_id) {
          setStatus('unauthorised');
          return;
        }
        const socket = io(`${api_base_url}/admin-dashboard/${city_id}`, {
          auth: { token: access_token },
          transports: ['websocket', 'polling'],
          withCredentials: true,
        });
        socketRef.current = socket;
        socket.on('connect', () => {
          if (!cancelled) setStatus('connected');
        });
        socket.on('disconnect', () => {
          if (!cancelled) setStatus('disconnected');
        });
        socket.on('connect_error', () => {
          if (!cancelled) setStatus('disconnected');
        });
        socket.on('activity', (envelope: RealtimeEnvelope<AdminDashboardActivity>) => {
          if (cancelled) return;
          setItems((prev) => [envelope.data, ...prev].slice(0, MAX_ITEMS));
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
  }, []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Live activity</CardTitle>
          <CardDescription>Updates from across your city, in real time.</CardDescription>
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
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            {status === 'connected'
              ? 'Waiting for activity — events appear here without a refresh.'
              : status === 'unauthorised'
                ? 'Sign in as city_admin to see live activity for your city.'
                : 'Connecting to the activity stream…'}
          </div>
        ) : (
          items.map((it, i) => {
            const Icon = iconFor(it.event);
            return (
              <div key={`${it.source_entity_id ?? 'na'}-${it.at}-${i}`}>
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-primary">
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">
                      {it.summary_en}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {it.event} · {timeAgo(it.at)}
                    </div>
                  </div>
                  <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
                </div>
                {i < items.length - 1 ? <Separator className="mt-3" /> : null}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
