import { useEffect, useMemo, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { ulid } from 'ulid';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/auth-context';
import { apiPost } from '@/lib/api-client';
import { safeReturnTo } from '@/lib/auth-return';
import { useLocale } from '@/lib/locale-context';
import type { SessionUser } from '@/lib/auth';

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

interface OtpSendResponse {
  otp_token: string;
  expires_in_seconds: number;
}
interface OtpVerifyResponse {
  user: SessionUser;
  tokens: {
    access_token: string;
    refresh_token: string;
    access_expires_at: string;
    refresh_expires_at: string;
  };
}

/**
 * Public OTP sign-in for every role (parents, students, admins).
 * Honours `?return=/path` so gated library (and similar) can resume after verify.
 */
export default function PublicLoginPage() {
  const locale = useLocale();
  const hi = locale === 'hi';
  const [, navigate] = useLocation();
  const search = useSearch();
  const returnTo = useMemo(() => {
    const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    return safeReturnTo(q.get('return'));
  }, [search]);

  const { setUser, user } = useAuth();
  const [phase, setPhase] = useState<Phase>('phone');
  const [digits, setDigits] = useState('');
  const [otp, setOtp] = useState('');
  const [otpToken, setOtpToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const e164 = useMemo(() => `+91${digits}`, [digits]);
  const phoneValid = digits.length === 10;
  const otpValid = otp.length === 6;

  useEffect(() => {
    setError(null);
  }, [phase]);

  // Already signed in — honour return immediately.
  useEffect(() => {
    if (user) navigate(returnTo ?? '/library');
  }, [user, returnTo, navigate]);

  const sendOtp = async () => {
    if (!phoneValid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<OtpSendResponse>('/api/auth/login', { phase: 'send', phone: e164 });
      setOtpToken(res.otp_token);
      setPhase('otp');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send OTP. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async () => {
    if (!otpValid || !otpToken || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<OtpVerifyResponse>('/api/auth/login', {
        phase: 'verify',
        otp_token: otpToken,
        code: otp,
        device_id: getDeviceId(),
      });
      setUser(res.user);
      navigate(returnTo ?? '/library');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid OTP. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <img src={`${import.meta.env.BASE_URL}logo-mark.svg`} alt="" className="mb-2 h-10 w-10" />
          <CardTitle className="font-display text-2xl text-secondary">
            {phase === 'phone'
              ? hi
                ? 'साइन इन'
                : 'Sign in'
              : hi
                ? 'ओटीपी दर्ज करें'
                : 'Enter OTP'}
          </CardTitle>
          <CardDescription>
            {phase === 'phone'
              ? hi
                ? 'कोड पाने के लिए अपना +91 मोबाइल नंबर दर्ज करें।'
                : 'Enter your +91 mobile number to receive a one-time code.'
              : hi
                ? `हमने ${e164} पर एक 6-अंकीय कोड भेजा।`
                : `We sent a 6-digit code to ${e164}.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          {phase === 'phone' ? (
            <div className="space-y-2">
              <Label htmlFor="phone">{hi ? 'मोबाइल नंबर' : 'Mobile number'}</Label>
              <div className="flex">
                <span className="inline-flex h-10 items-center rounded-l-md border border-r-0 border-input bg-muted px-3 text-sm text-muted-foreground">
                  +91
                </span>
                <Input
                  id="phone"
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="98765 43210"
                  value={digits}
                  onChange={(e) => setDigits(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  onKeyDown={(e) => e.key === 'Enter' && void sendOtp()}
                  className="rounded-l-none"
                  autoComplete="tel-national"
                />
              </div>
              <Button onClick={() => void sendOtp()} disabled={!phoneValid || busy} className="w-full">
                {busy ? (hi ? 'भेजा जा रहा…' : 'Sending…') : hi ? 'ओटीपी भेजें' : 'Send OTP'}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="otp">{hi ? 'एक बार का कोड' : 'One-time code'}</Label>
              <Input
                id="otp"
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="123456"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={(e) => e.key === 'Enter' && void verifyOtp()}
                autoComplete="one-time-code"
                className="font-mono tracking-[0.35em]"
              />
              <Button onClick={() => void verifyOtp()} disabled={!otpValid || busy} className="w-full">
                {busy ? (hi ? 'जाँच हो रही…' : 'Verifying…') : hi ? 'सत्यापित करें' : 'Verify'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setPhase('phone');
                  setOtp('');
                  setOtpToken(null);
                }}
                className="w-full text-sm"
              >
                ← {hi ? 'नंबर बदलें' : 'Change number'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
