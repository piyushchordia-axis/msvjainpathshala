'use client';

/**
 * Two-phase OTP form. State machine:
 *
 *   'phone'      → user types +91 number + 10 digits, clicks "Send OTP"
 *   'otp'        → user types 6-digit code, clicks "Verify"
 *   'success'    → cookies are set; we redirect to the next URL
 *
 * Errors are localised; we use the ApiError envelope's `message` as a
 * fallback when next-intl doesn't have a matching key.
 *
 * Device id is a stable per-browser random id stored in localStorage so
 * a return visit reuses the same device session row on the backend.
 */

import { useEffect, useMemo, useState } from 'react';
import { ulid } from 'ulid';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/toast';
import { useRouter } from '@/i18n/navigation';
import { canAccessAdminPanel } from '@/lib/role-access';

import type { Role } from '@jp/shared';

interface Props {
  nextPath: string;
  /** Set when middleware bounced a signed-in non-admin to the login page. */
  initialError?: 'not_admin';
}

type Phase = 'phone' | 'otp';

function getDeviceId(): string {
  if (typeof window === 'undefined') return 'web-ssr';
  const key = 'jp.web.device_id';
  let id = window.localStorage.getItem(key);
  if (!id) {
    id = `web-${ulid()}`;
    window.localStorage.setItem(key, id);
  }
  return id;
}

const NOT_ADMIN_TITLE = 'This number is not an admin account';
const NOT_ADMIN_BODY =
  'Parents and students use the mobile app. Ask your Sanchalak or city admin if you should have panel access.';

export function LoginForm({ nextPath, initialError }: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('phone');
  const [digits, setDigits] = useState('');
  const [otp, setOtp] = useState('');
  // Captured from the send-phase response and replayed in the verify body.
  // The backend binds verify to the send via this opaque token.
  const [otpToken, setOtpToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const e164 = useMemo(() => `+91${digits}`, [digits]);
  const phoneValid = digits.length === 10;
  const otpValid = otp.length === 6;

  useEffect(() => {
    setError(null);
  }, [phase]);

  // Middleware bounced a signed-in non-admin here → explain via toast
  // (instead of silently dumping them on the public homepage).
  useEffect(() => {
    if (initialError === 'not_admin') {
      toast.error(NOT_ADMIN_TITLE, NOT_ADMIN_BODY);
    }
  }, [initialError]);

  const sendOtp = async () => {
    if (!phoneValid) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase: 'send', phone: e164 }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? 'Could not send the OTP.');
      }
      const body = (await res.json().catch(() => null)) as {
        data?: { otp_token?: string };
      } | null;
      const token = body?.data?.otp_token;
      if (!token) {
        throw new Error('Could not start OTP verification. Try again.');
      }
      setOtpToken(token);
      setPhase('otp');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the OTP.');
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async () => {
    if (!otpValid) return;
    if (!otpToken) {
      setError('Session expired. Please request a new OTP.');
      setPhase('phone');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phase: 'verify',
          otp_token: otpToken,
          code: otp,
          device_id: getDeviceId(),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? 'That OTP did not work. Try again.');
      }
      const body = (await res.json().catch(() => null)) as {
        data?: { user?: { role?: Role; full_name?: string } };
      } | null;
      const role = body?.data?.user?.role;

      // Role gate: a valid OTP can belong to a parent/student/guest who has
      // no admin-panel access. Rather than redirect to /admin and let the
      // middleware bounce them to the public homepage, surface a clear toast
      // here and clear the half-set session.
      if (!canAccessAdminPanel(role)) {
        await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
        toast.error(NOT_ADMIN_TITLE, NOT_ADMIN_BODY);
        setOtp('');
        setPhase('phone');
        setBusy(false);
        return;
      }

      const name = body?.data?.user?.full_name?.trim();
      toast.success('Signed in', name ? `Welcome back, ${name}.` : 'Welcome back.');
      router.replace(nextPath as `/${string}`);
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'That OTP did not work. Try again.';
      setError(msg);
      toast.error('Could not sign in', msg);
      setBusy(false);
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>
          {phase === 'phone'
            ? "We'll send a one-time code by SMS."
            : `We sent a 6-digit code to ${e164}.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {phase === 'phone' ? (
          <div className="space-y-2">
            <Label htmlFor="phone">Mobile number</Label>
            <div className="flex">
              <span className="inline-flex h-10 items-center rounded-l-md border border-r-0 border-input bg-muted px-3 text-sm text-foreground">
                +91
              </span>
              <Input
                id="phone"
                inputMode="numeric"
                pattern="\d{10}"
                value={digits}
                onChange={(e) => setDigits(e.target.value.replace(/\D+/g, '').slice(0, 10))}
                className="rounded-l-none"
                placeholder="98765 43210"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void sendOtp();
                }}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="otp">One-time code</Label>
            <Input
              id="otp"
              inputMode="numeric"
              pattern="\d{6}"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D+/g, '').slice(0, 6))}
              placeholder="••••••"
              className="font-mono tracking-[0.5em] text-lg"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') void verifyOtp();
              }}
            />
          </div>
        )}

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex flex-col gap-3">
          {phase === 'phone' ? (
            <Button size="lg" onClick={() => void sendOtp()} disabled={!phoneValid || busy}>
              {busy ? 'Sending…' : 'Send OTP'}
            </Button>
          ) : (
            <>
              <Button size="lg" onClick={() => void verifyOtp()} disabled={!otpValid || busy}>
                {busy ? 'Verifying…' : 'Verify and sign in'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPhase('phone');
                  setOtp('');
                }}
                disabled={busy}
              >
                Use a different number
              </Button>
            </>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Trouble signing in? Ask your Sanchalak or Guruji to confirm your phone is registered.
        </p>
      </CardContent>
    </Card>
  );
}
