import { useEffect, useMemo, useState } from 'react';
import { Link, useSearch } from 'wouter';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useLocale } from '@/lib/locale-context';
import { messageForCode } from '@/lib/api-error-copy';
import { GuestError, GuestLoading } from '@/components/public/GuestLoadState';

const VALID_KINDS = ['student', 'parent', 'shikshak', 'sanchalak', 'city_admin'];

const KIND_LABELS: Record<string, { en: string; hi: string }> = {
  student: { en: 'Student', hi: 'विद्यार्थी' },
  parent: { en: 'Parent', hi: 'अभिभावक' },
  shikshak: { en: 'Shikshak', hi: 'शिक्षक' },
  sanchalak: { en: 'Sanchalak', hi: 'संचालक' },
  city_admin: { en: 'City admin', hi: 'सिटी एडमिन' },
};

interface FieldOption { value: string; label_en: string; label_hi?: string | null }
interface FieldDef {
  key: string;
  label_en: string;
  label_hi?: string | null;
  type: 'text' | 'number' | 'date' | 'select' | 'tel' | 'email' | 'textarea';
  required: boolean;
  options?: FieldOption[] | null;
}
interface FormConfig {
  id: string;
  form_kind: string;
  title_en: string;
  title_hi?: string | null;
  fields: FieldDef[];
}

export default function RegisterPage() {
  const locale = useLocale();
  const hi = locale === 'hi';
  const search = useSearch();
  const kind = useMemo(() => {
    const k = new URLSearchParams(search).get('kind') ?? 'student';
    return VALID_KINDS.includes(k) ? k : 'student';
  }, [search]);

  const [config, setConfig] = useState<FormConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);

  useEffect(() => {
    setLoading(true);
    setNotFound(false);
    setConfig(null);
    setSubmitted(false);
    setErrorMsg(null);
    setMissing([]);
    setValues({});
    setLoadError(false);
    fetch(`/v1/registration/forms/${kind}`, { headers: { Accept: 'application/json' } })
      .then((r) => {
        // Only a real 404 means "no form for this category". A 5xx or a dead
        // network used to render the same card, telling guests the programme
        // doesn't take registrations (GST-ERR-02).
        if (r.status === 404) { setNotFound(true); return null; }
        if (!r.ok) { setLoadError(true); return null; }
        return r.json();
      })
      .then((json: { data?: FormConfig } | null) => {
        if (json?.data) setConfig(json.data);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [kind, reloadKey]);

  function setField(key: string, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  function label(f: { label_en: string; label_hi?: string | null }): string {
    return (hi ? f.label_hi : f.label_en) || f.label_en;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!config || submitting) return;
    setErrorMsg(null);
    setMissing([]);

    // Client-side required check mirrors the server.
    const clientMissing = config.fields
      .filter((f) => f.required && !(values[f.key] ?? '').trim())
      .map((f) => f.key);
    if (!fullName.trim() || clientMissing.length > 0) {
      setMissing(clientMissing);
      if (!fullName.trim()) {
        setErrorMsg(hi ? 'कृपया अपना नाम भरें।' : 'Please enter your name.');
      } else {
        setErrorMsg(hi ? 'कृपया सभी आवश्यक फ़ील्ड भरें।' : 'Please fill all required fields.');
      }
      return;
    }

    setSubmitting(true);
    try {
      const responses: Record<string, string> = {};
      for (const f of config.fields) {
        const v = (values[f.key] ?? '').trim();
        if (v) responses[f.key] = v;
      }
      const res = await fetch(`/v1/registration/forms/${kind}/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          full_name: fullName.trim(),
          phone: phone.trim() || undefined,
          responses,
        }),
      });
      if (res.ok) {
        setSubmitted(true);
        return;
      }
      const json = (await res.json().catch(() => null)) as
        | { error?: { code?: string; message?: string; details?: { missing?: string[] } } }
        | null;
      if (res.status === 422 && json?.error?.details?.missing) {
        setMissing(json.error.details.missing);
        setErrorMsg(hi ? 'कृपया सभी आवश्यक फ़ील्ड भरें।' : 'Please fill all required fields.');
        return;
      }
      // Bilingual copy keyed off error.code — the raw server message is
      // English-only, which stranded Hindi visitors mid-error (GST-API-05).
      setErrorMsg(messageForCode(json?.error?.code, hi, json?.error?.message));
    } catch {
      setErrorMsg(hi ? 'नेटवर्क त्रुटि। पुनः प्रयास करें।' : 'Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="container py-12 md:py-16">
      <p className="text-sm font-medium uppercase tracking-[0.18em] text-primary">
        {hi ? 'पंजीकरण' : 'Registration'}
      </p>

      {/* The server supports five form kinds, but every link in the app pointed
          at bare /register (= student) — the other four were unreachable dead
          capability (GST-API-06). */}
      <div className="mt-6 flex flex-wrap gap-2">
        {VALID_KINDS.map((k) => {
          const active = k === kind;
          return (
            <Link
              key={k}
              href={`/register?kind=${k}`}
              className={
                active
                  ? 'rounded-full border border-primary bg-primary px-3 py-1.5 text-sm text-primary-foreground'
                  : 'rounded-full border border-border bg-card px-3 py-1.5 text-sm text-secondary hover:border-primary/40'
              }
              aria-current={active ? 'page' : undefined}
            >
              {KIND_LABELS[k] ? (hi ? KIND_LABELS[k].hi : KIND_LABELS[k].en) : k}
            </Link>
          );
        })}
      </div>

      {loading ? (
        <GuestLoading hi={hi} />
      ) : loadError ? (
        <GuestError
          hi={hi}
          what="the registration form"
          whatHi="पंजीकरण फ़ॉर्म"
          onRetry={() => setReloadKey((n) => n + 1)}
        />
      ) : notFound || !config ? (
        <Card className="mt-10 p-6 text-muted-foreground">
          {hi
            ? 'इस श्रेणी के लिए अभी कोई पंजीकरण फ़ॉर्म उपलब्ध नहीं है।'
            : 'No registration form is available for this category yet.'}
        </Card>
      ) : submitted ? (
        <Card className="mt-10 max-w-xl p-8">
          <h1 className="font-display text-3xl text-secondary">{hi ? 'धन्यवाद!' : 'Thank you!'}</h1>
          <p className="mt-3 text-muted-foreground">
            {hi
              ? 'आपका पंजीकरण जमा हो गया है। हमारी टीम शीघ्र ही समीक्षा करेगी।'
              : 'Your registration has been submitted. Our team will review it shortly.'}
          </p>
          <Button className="mt-6" variant="outline" onClick={() => { setSubmitted(false); setFullName(''); setPhone(''); setValues({}); }}>
            {hi ? 'एक और भरें' : 'Submit another'}
          </Button>
        </Card>
      ) : (
        <>
          <h1 className="mt-3 font-display text-4xl text-secondary md:text-5xl">
            {(hi ? config.title_hi : config.title_en) || config.title_en}
          </h1>

          <Card className="mt-8 max-w-xl p-6 md:p-8">
            <form className="space-y-5" onSubmit={submit}>
              <div className="space-y-1">
                <Label className="text-sm font-medium">
                  {hi ? 'पूरा नाम' : 'Full name'} <span className="text-destructive">*</span>
                </Label>
                <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
              </div>
              <div className="space-y-1">
                <Label className="text-sm font-medium">{hi ? 'फ़ोन नंबर' : 'Phone number'}</Label>
                <Input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91…"
                />
              </div>

              {config.fields.map((f) => {
                const isMissing = missing.includes(f.key);
                return (
                  <div key={f.key} className="space-y-1">
                    <Label className="text-sm font-medium">
                      {label(f)}
                      {f.required ? <span className="text-destructive"> *</span> : null}
                    </Label>
                    {f.type === 'textarea' ? (
                      <Textarea
                        value={values[f.key] ?? ''}
                        onChange={(e) => setField(f.key, e.target.value)}
                        aria-invalid={isMissing}
                      />
                    ) : f.type === 'select' ? (
                      <Select value={values[f.key] ?? ''} onValueChange={(v) => setField(f.key, v)}>
                        <SelectTrigger aria-invalid={isMissing}>
                          <SelectValue placeholder={hi ? 'चुनें' : 'Select'} />
                        </SelectTrigger>
                        <SelectContent>
                          {(f.options ?? []).map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {(hi ? o.label_hi : o.label_en) || o.label_en}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        type={
                          f.type === 'number'
                            ? 'number'
                            : f.type === 'date'
                              ? 'date'
                              : f.type === 'tel'
                                ? 'tel'
                                : f.type === 'email'
                                  ? 'email'
                                  : 'text'
                        }
                        value={values[f.key] ?? ''}
                        onChange={(e) => setField(f.key, e.target.value)}
                        aria-invalid={isMissing}
                      />
                    )}
                  </div>
                );
              })}

              {errorMsg ? <p className="text-sm text-destructive">{errorMsg}</p> : null}

              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? (hi ? 'जमा हो रहा है…' : 'Submitting…') : hi ? 'जमा करें' : 'Submit'}
              </Button>
            </form>
          </Card>
        </>
      )}
    </section>
  );
}
