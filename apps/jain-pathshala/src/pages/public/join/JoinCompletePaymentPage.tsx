import { useEffect, useRef, useState } from 'react';
import { Link, useSearch } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLocale } from '@/lib/locale-context';
import { apiGet, apiPatch } from '@/lib/api-client';
import { apiErrorMessage } from '@/lib/api-error-copy';
import { type JoinKind, type JoinSettings, uploadJoinFile } from '@/lib/join';
import { JoinLangToggle, usePreferJoinHindi } from './JoinLangToggle';

type LookupItem = {
  id: string;
  display_code: string;
  name: string;
  has_paid: string;
  father_name?: string | null;
};

const MAX_LOOKUP_FAILURES = 5;

export default function JoinCompletePaymentPage({ kind }: { kind: JoinKind }) {
  usePreferJoinHindi();
  const hi = useLocale() === 'hi';
  // Prefill from the done screen's CTA (GST-API-02) — the family had just
  // typed both and was handed an empty form.
  const search = useSearch();
  const params = new URLSearchParams(search);
  const [mobile, setMobile] = useState(() => params.get('mobile') ?? '');
  const [code, setCode] = useState(() => (params.get('code') ?? '').toUpperCase());
  const [item, setItem] = useState<LookupItem | null>(null);
  const [matches, setMatches] = useState<LookupItem[]>([]);
  const [settings, setSettings] = useState<JoinSettings | null>(null);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [failures, setFailures] = useState(0);

  const locked = failures >= MAX_LOOKUP_FAILURES;

  // When the done screen handed us both values, run the lookup once so the
  // family lands on their record, not a form.
  const autoLooked = useRef(false);
  useEffect(() => {
    if (autoLooked.current) return;
    if (params.get('mobile') && params.get('code')) {
      autoLooked.current = true;
      void lookup();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lookup = async () => {
    if (locked) return;
    setBusy(true);
    setError(null);
    setItem(null);
    setMatches([]);
    try {
      // Mobile is the required key (the server refuses code-only lookups);
      // the code only narrows the match (GST-API-11).
      const params = new URLSearchParams({ kind, mobile: mobile.trim() });
      const trimmedCode = code.trim().toUpperCase();
      if (trimmedCode) params.set('display_code', trimmedCode);
      const [look, s] = await Promise.all([
        apiGet<{ items: LookupItem[] }>(`/v1/join/registrations/lookup?${params.toString()}`),
        apiGet<JoinSettings>(`/v1/join/settings?kind=${kind}`),
      ]);
      if (look.items.length === 0) {
        setFailures((n) => n + 1);
        setError(
          hi
            ? 'पंजीकरण नहीं मिला — वही मोबाइल नंबर डालें जो पंजीकरण में दिया था।'
            : 'Registration not found — use the same mobile number you registered with.',
        );
        return;
      }
      setFailures(0);
      setSettings(s);
      if (look.items.length > 1) {
        // Same mobile can hold several registrations (siblings) — let the
        // family pick instead of silently taking the first.
        setMatches(look.items);
        return;
      }
      const found = look.items[0];
      if (found.has_paid === 'yes') {
        setError(hi ? 'भुगतान पहले से दर्ज है' : 'Payment already recorded');
      }
      setItem(found);
    } catch (e) {
      setFailures((n) => n + 1);
      setError(
        apiErrorMessage(e, hi, {
          ERR_NOT_FOUND: {
            en: 'Registration not found — use the same mobile number you registered with.',
            hi: 'पंजीकरण नहीं मिला — वही मोबाइल नंबर डालें जो पंजीकरण में दिया था।',
          },
        }),
      );
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
        // The registered mobile is the shared secret — the id alone no longer
        // authorises the write.
        mobile: mobile.trim(),
      });
      setDone(true);
    } catch (e) {
      // Bilingual copy keyed off error.code (GST-API-05).
      setError(apiErrorMessage(e, hi));
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
          <Label>{hi ? 'पंजीकृत मोबाइल नंबर' : 'Registered mobile number'}</Label>
          <Input
            className="mt-2"
            type="tel"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            placeholder="98765 43210"
          />
        </div>
        <div>
          <Label>
            {hi ? 'पंजीकरण कोड (वैकल्पिक)' : 'Registration code (optional)'}
          </Label>
          <Input
            className="mt-2 font-mono"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={kind === 'student' ? 'MUM-STU-00042' : 'MUM-GHK-SHK-00003'}
          />
        </div>
        {locked ? (
          <p className="text-sm text-destructive">
            {hi
              ? 'कई प्रयास विफल रहे — कुछ मिनट रुककर पेज रिफ़्रेश करें, या अपने केंद्र से संपर्क करें।'
              : 'Too many failed attempts — wait a few minutes and refresh the page, or contact your centre.'}
          </p>
        ) : (
          <Button onClick={() => void lookup()} disabled={busy || !mobile.trim()}>
            {hi ? 'खोजें' : 'Look up'}
          </Button>
        )}

        {matches.length > 0 && !item ? (
          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-sm text-muted-foreground">
              {hi
                ? 'इस नंबर पर एक से अधिक पंजीकरण हैं — अपना चुनें:'
                : 'More than one registration uses this number — pick yours:'}
            </p>
            {matches.map((m) => (
              <button
                key={m.id}
                type="button"
                className="flex w-full items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-left text-sm hover:border-primary/40"
                onClick={() => {
                  if (m.has_paid === 'yes') {
                    setError(hi ? 'भुगतान पहले से दर्ज है' : 'Payment already recorded');
                  } else {
                    setError(null);
                  }
                  setItem(m);
                }}
              >
                <span>
                  <span className="font-medium text-secondary">{m.name}</span>
                  {m.father_name ? (
                    <span className="text-muted-foreground"> · {m.father_name}</span>
                  ) : null}
                </span>
                <span className="font-mono text-xs text-primary">{m.display_code}</span>
              </button>
            ))}
          </div>
        ) : null}

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
                  setError(
                    hi
                      ? 'अपलोड विफल रहा — साफ़ छवि चुनकर पुनः प्रयास करें।'
                      : 'Upload failed — choose a clear image and try again.',
                  );
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
