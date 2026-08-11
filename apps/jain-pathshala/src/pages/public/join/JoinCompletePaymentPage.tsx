import { useState } from 'react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLocale } from '@/lib/locale-context';
import { ApiError, apiGet, apiPatch } from '@/lib/api-client';
import { type JoinKind, type JoinSettings, uploadJoinFile } from '@/lib/join';
import { JoinLangToggle, usePreferJoinHindi } from './JoinLangToggle';

type LookupItem = {
  id: string;
  display_code: string;
  name: string;
  has_paid: string;
};

export default function JoinCompletePaymentPage({ kind }: { kind: JoinKind }) {
  usePreferJoinHindi();
  const hi = useLocale() === 'hi';
  const [code, setCode] = useState('');
  const [item, setItem] = useState<LookupItem | null>(null);
  const [settings, setSettings] = useState<JoinSettings | null>(null);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const lookup = async () => {
    setBusy(true);
    setError(null);
    setItem(null);
    try {
      const [look, s] = await Promise.all([
        apiGet<{ items: LookupItem[] }>(
          `/v1/join/registrations/lookup?kind=${kind}&display_code=${encodeURIComponent(code.trim().toUpperCase())}`,
        ),
        apiGet<JoinSettings>(`/v1/join/settings?kind=${kind}`),
      ]);
      const found = look.items[0];
      if (!found) {
        setError(hi ? 'पंजीकरण नहीं मिला' : 'Registration not found');
        return;
      }
      if (found.has_paid === 'yes') {
        setError(hi ? 'भुगतान पहले से दर्ज है' : 'Payment already recorded');
        setItem(found);
        return;
      }
      setItem(found);
      setSettings(s);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Lookup failed');
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!item || !screenshotUrl) {
      setError(hi ? 'स्क्रीनशॉट अपलोड करें' : 'Upload a screenshot');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/v1/join/registrations/${item.id}/payment`, {
        kind,
        payment_screenshot_url: screenshotUrl,
        has_paid: 'yes',
      });
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Payment failed');
    } finally {
      setBusy(false);
    }
  };

  if (done && item) {
    return (
      <div className="container py-16">
        <Card className="max-w-lg space-y-4 p-8">
          <div className="flex justify-end">
            <JoinLangToggle />
          </div>
          <h1 className="font-display text-2xl text-secondary">
            {hi ? 'भुगतान दर्ज हो गया' : 'Payment recorded'}
          </h1>
          <p className="mt-3 font-mono text-xl text-primary">{item.display_code}</p>
          <Button asChild className="mt-6">
            <Link href="/join">{hi ? 'होम' : 'Done'}</Link>
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="container py-12">
      <Card className="mx-auto max-w-lg space-y-4 p-8">
        <div className="flex items-start justify-between gap-3">
          <h1 className="font-display text-2xl text-secondary">
            {hi ? 'भुगतान पूरा करें' : 'Complete payment'}
          </h1>
          <JoinLangToggle />
        </div>
        <div>
          <Label>{hi ? 'पंजीकरण कोड' : 'Registration code'}</Label>
          <Input
            className="mt-2 font-mono"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={kind === 'student' ? 'MUM-STU-00042' : 'MUM-GHK-SHK-00003'}
          />
        </div>
        <Button onClick={() => void lookup()} disabled={busy || !code.trim()}>
          {hi ? 'खोजें' : 'Look up'}
        </Button>

        {item && settings && item.has_paid !== 'yes' ? (
          <div className="space-y-3 border-t border-border pt-4">
            <p className="font-medium">{item.name}</p>
            <p className="font-mono text-primary">{item.display_code}</p>
            <p className="text-sm text-muted-foreground">
              ₹{settings.payment_amount}
              {settings.payment_upi_id ? ` · ${settings.payment_upi_id}` : ''}
            </p>
            {settings.payment_qr_image ? (
              <img
                src={settings.payment_qr_image}
                alt="UPI QR"
                className="mx-auto h-40 w-40 object-contain"
              />
            ) : null}
            <Input
              type="file"
              accept="image/*"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setBusy(true);
                setError(null);
                try {
                  const up = await uploadJoinFile(file);
                  setScreenshotUrl(up.url);
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Upload failed');
                } finally {
                  setBusy(false);
                }
              }}
            />
            {screenshotUrl ? (
              <div className="flex items-center gap-3">
                <img
                  src={screenshotUrl}
                  alt=""
                  className="h-16 w-16 rounded-md border border-border object-cover"
                />
                <p className="text-xs text-muted-foreground">
                  {hi ? 'अपलोड हो गया' : 'Uploaded'}
                </p>
              </div>
            ) : null}
            <Button onClick={() => void submit()} disabled={busy || !screenshotUrl}>
              {hi ? 'भुगतान जमा करें' : 'Submit payment'}
            </Button>
          </div>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </Card>
    </div>
  );
}
