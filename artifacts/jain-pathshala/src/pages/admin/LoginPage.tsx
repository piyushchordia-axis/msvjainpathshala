import { useEffect, useMemo, useState } from 'react';
import { ulid } from 'ulid';
import { useLocation } from 'wouter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/toast-jp';
import { useAuth } from '@/lib/auth-context';
import { canAccessAdminPanel, type SessionUser } from '@/lib/auth';
import { apiPost } from '@/lib/api-client';

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

interface OtpSendResponse { otp_token: string; expires_in_seconds: number; }
interface OtpVerifyResponse { user: SessionUser; tokens: { access_token: string; refresh_token: string; access_expires_at: string; refresh_expires_at: string; } }

export default function LoginPage() {
  const [, navigate] = useLocation();
  const { setUser } = useAuth();
  const [phase, setPhase] = useState<Phase>('phone');
  const [digits, setDigits] = useState('');
  const [otp, setOtp] = useState('');
  const [otpToken, setOtpToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const e164 = useMemo(() => `+91${digits}`, [digits]);
  const phoneValid = digits.length === 10;
  const otpValid = otp.length === 6;

  useEffect(() => { setError(null); }, [phase]);

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
      if (!canAccessAdminPanel(res.user?.role)) {
        toast.error('Not an admin account', 'Parents and students use the mobile app.');
        setPhase('phone');
        return;
      }
      setUser(res.user);
      navigate('/admin');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid OTP. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen bg-background md:grid-cols-2">
      <aside className="relative hidden bg-primary text-primary-foreground md:flex md:items-end md:p-12">
        <div className="absolute inset-0 opacity-25" aria-hidden>
          <img src="/motif-mandala.svg" alt="" className="h-full w-full object-cover" />
        </div>
        <div className="relative max-w-md">
          <div className="font-display text-3xl leading-tight">Jain Pathshala admin</div>
          <p className="mt-3 text-primary-foreground/80">
            Sign in with the phone number registered with your centre. One-time codes are sent by SMS.
          </p>
        </div>
      </aside>

      <main className="flex items-center justify-center p-6 md:p-12">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <img src="/logo-mark.svg" alt="" className="h-10 w-10 mb-2" />
            <CardTitle className="font-display text-2xl text-secondary">
              {phase === 'phone' ? 'Sign in' : 'Enter OTP'}
            </CardTitle>
            <CardDescription>
              {phase === 'phone'
                ? 'Enter your +91 mobile number to receive a one-time code.'
                : `We sent a 6-digit code to ${e164}. Enter it below.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error ? (
              <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            ) : null}

            {phase === 'phone' ? (
              <div className="space-y-2">
                <Label htmlFor="phone">Mobile number</Label>
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
                    onKeyDown={(e) => e.key === 'Enter' && sendOtp()}
                    className="rounded-l-none"
                    autoComplete="tel-national"
                  />
                </div>
                <Button onClick={sendOtp} disabled={!phoneValid || busy} className="w-full">
                  {busy ? 'Sending…' : 'Send OTP'}
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="otp">One-time code</Label>
                <Input
                  id="otp"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="123456"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  onKeyDown={(e) => e.key === 'Enter' && verifyOtp()}
                  autoComplete="one-time-code"
                />
                <Button onClick={verifyOtp} disabled={!otpValid || busy} className="w-full">
                  {busy ? 'Verifying…' : 'Verify'}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => { setPhase('phone'); setOtp(''); setOtpToken(null); }}
                  className="w-full text-sm"
                >
                  ← Back
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
