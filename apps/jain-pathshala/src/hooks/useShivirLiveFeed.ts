/**
 * Live shivir scan feed over the `/shivirs/:shivirId` Socket.IO namespace
 * (CLAUDE.md's frozen namespace list), with a polling fallback.
 *
 * This is the web app's first socket consumer. The shivir dashboard called
 * itself "Live QR-scan attendance counts" while doing neither a subscription
 * nor a poll: it loaded once per dropdown selection and then only on a manual
 * Refresh, so a city_admin watching a camp saw a frozen number all day.
 *
 * The fallback is not decoration. Socket.IO is loaded lazily, the namespace can
 * refuse the handshake, and a deployment without Redis or behind a proxy that
 * drops upgrades will not connect at all — in every one of those cases the page
 * must still update, and must say which mode it is in rather than claiming to
 * be live.
 */
import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';

const POLL_MS = 10_000;

export interface ShivirLiveFeed {
  /** True only while a socket is genuinely connected to this shivir. */
  connected: boolean;
}

export function useShivirLiveFeed(shivirId: string, onScan: () => void): ShivirLiveFeed {
  const [connected, setConnected] = useState(false);
  // Kept in a ref so reconnects and poll ticks always call the latest handler
  // without tearing down and rebuilding the socket on every render.
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!shivirId) {
      setConnected(false);
      return;
    }

    let socket: Socket | null = null;
    let cancelled = false;

    void import('socket.io-client')
      .then(({ io }) => {
        if (cancelled) return;
        const base = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';
        socket = io(`${base}/shivirs/${shivirId}`, {
          path: '/socket.io',
          // The access token is in an httpOnly cookie the page cannot read, so
          // the handshake carries credentials rather than an auth payload.
          withCredentials: true,
          transports: ['websocket', 'polling'],
        });
        socket.on('connect', () => setConnected(true));
        socket.on('disconnect', () => setConnected(false));
        socket.on('connect_error', () => setConnected(false));
        socket.on('shivir.scan', () => onScanRef.current());
      })
      .catch(() => {
        // socket.io-client unavailable — the poll below carries the page.
        if (!cancelled) setConnected(false);
      });

    return () => {
      cancelled = true;
      socket?.removeAllListeners();
      socket?.disconnect();
      setConnected(false);
    };
  }, [shivirId]);

  useEffect(() => {
    if (!shivirId || connected) return;
    const t = window.setInterval(() => onScanRef.current(), POLL_MS);
    return () => window.clearInterval(t);
  }, [shivirId, connected]);

  return { connected };
}
