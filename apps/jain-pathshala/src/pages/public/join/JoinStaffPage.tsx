import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useLocale } from '@/lib/locale-context';
import { apiGet, apiPost } from '@/lib/api-client';
import { apiErrorMessage } from '@/lib/api-error-copy';
import { mergeById, usePickerSearch } from '@/lib/picker-search';
import {
  STAFF_SECTIONS,
  dobProblem,
  fieldLabel,
  fieldPlaceholder,
  fieldsForSection,
  optionLabel,
  photoField,
  type CentreOption,
  type JoinField,
  type JoinKind,
  type JoinSettings,
  uploadJoinFile,
} from '@/lib/join';
import { JoinLangToggle, usePreferJoinHindi } from './JoinLangToggle';

/** Age band the staff join form accepts, mirrored by staffCreateSchema. */
const STAFF_MIN_AGE = 15;
const STAFF_MAX_AGE = 90;

/** Bounds for the native date input, so the picker opens near the right decade. */
function dobBounds(minAge: number, maxAge: number): { min: string; max: string } {
  const now = new Date();
  const iso = (y: number) =>
    new Date(Date.UTC(y, now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0, 10);
  return { min: iso(now.getUTCFullYear() - maxAge), max: iso(now.getUTCFullYear() - minAge) };
}

const STAFF_DOB_BOUNDS = dobBounds(STAFF_MIN_AGE, STAFF_MAX_AGE);

export default function JoinStaffPage({ kind }: { kind: 'shikshak' | 'sanchalak' }) {
  usePreferJoinHindi();
  const hi = useLocale() === 'hi';
  const [phase, setPhase] = useState<'loading' | 'error' | 'closed' | 'form' | 'done'>('loading');
  const [sectionIdx, setSectionIdx] = useState(0);
  const [allFields, setAllFields] = useState<JoinField[]>([]);
  const [centres, setCentres] = useState<CentreOption[]>([]);
  const [centreQuery, setCentreQuery] = useState('');
  const [centreId, setCentreId] = useState('');
  const [role, setRole] = useState(kind === 'sanchalak' ? 'संचालक' : '');
  const [values, setValues] = useState<Record<string, string>>({});
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [displayCode, setDisplayCode] = useState<string | null>(null);

  const loadForm = useCallback(async () => {
    setPhase('loading');
    try {
      const [s, f, c] = await Promise.all([
        apiGet<JoinSettings>(`/v1/join/settings?kind=${kind}`),
        apiGet<{ items: JoinField[] }>(`/v1/join/form-fields?kind=${kind}`),
        apiGet<{ items: CentreOption[] }>('/v1/public/centres'),
      ]);
      setAllFields(f.items);
      setCentres(c.items.filter((x) => !!x.code));
      // 'closed' only when the server actually says so — a load failure used to
      // masquerade as "registration is closed" (GST-API-01).
      setPhase(s.registration_open ? 'form' : 'closed');
    } catch {
      setPhase('error');
    }
  }, [kind]);

  useEffect(() => {
    void loadForm();
  }, [loadForm]);

  const photo = useMemo(() => photoField(allFields), [allFields]);
  const section = STAFF_SECTIONS[sectionIdx]!;
  const sectionFields = useMemo(
    () => fieldsForSection(allFields, section).filter((f) => f.field_key !== 'role'),
    [allFields, section],
  );
  // Server-side ?q= merge — beyond the clamped first page a centre was
  // unpickable however the applicant spelled it (GST-PRF-03).
  const centreQ = centreQuery.trim();
  const centreExtra = usePickerSearch<CentreOption>(
    centreQ.length >= 2 ? `/v1/public/centres?q=${encodeURIComponent(centreQ)}` : null,
  );

  const filteredCentres = useMemo(() => {
    const q = centreQ.toLowerCase();
    const pool = mergeById(centres, centreExtra.filter((x) => !!x.code));
    if (!q) return pool;
    return pool.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.code ?? '').toLowerCase().includes(q) ||
        c.city_name.toLowerCase().includes(q),
    );
  }, [centres, centreExtra, centreQ]);

  const setValue = (key: string, v: string) => setValues((prev) => ({ ...prev, [key]: v }));

  const title =
    kind === 'shikshak'
      ? hi
        ? 'शिक्षक पंजीकरण'
        : 'Shikshak registration'
      : hi
        ? 'संचालक पंजीकरण'
        : 'Sanchalak registration';

  const validateSection = (): string | null => {
    if (section.includeCentre && !centreId) {
      return hi ? 'केंद्र चुनें' : 'Choose a centre';
    }
    if (section.includeRole && kind === 'shikshak' && !role) {
      return hi ? 'भूमिका चुनें' : 'Choose a role';
    }
    for (const f of sectionFields) {
      if (!f.is_required) continue;
      if (!values[f.field_key]?.trim()) {
        return hi
          ? `${fieldLabel(f, true)} आवश्यक है`
          : `${fieldLabel(f, false)} is required`;
      }
    }
    if (section.includePhoto && photo?.is_required && !photoUrl) {
      return hi ? 'फ़ोटो अपलोड करें' : 'Please upload a photo';
    }
    // The staff form never validated age at all; the DOB it replaces is what
    // the whole registration is dated from, so check it here.
    if (sectionFields.some((f) => f.field_key === 'date_of_birth')) {
      const problem = dobProblem(values.date_of_birth, STAFF_MIN_AGE, STAFF_MAX_AGE, hi);
      if (problem) return problem;
    }
    if (sectionFields.some((f) => f.field_key === 'whatsapp_contact')) {
      const wa = values.whatsapp_contact ?? '';
      if (wa && !/^\d{10}$/.test(wa)) {
        return hi
          ? '10 अंकों का WhatsApp नंबर दर्ज करें'
          : 'Enter a valid 10-digit WhatsApp number';
      }
    }
    return null;
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await apiPost<{ display_code: string }>('/v1/join/registrations', {
        kind: kind as JoinKind,
        centre_id: centreId,
        name: values.name,
        whatsapp_contact: values.whatsapp_contact,
        s_o: values.s_o || null,
        date_of_birth: values.date_of_birth || null,
        sex: values.sex || null,
        school_qualification: values.school_qualification || null,
        address: values.address || null,
        religious_education: values.religious_education || null,
        years_at_pathshala: values.years_at_pathshala
          ? Number(values.years_at_pathshala)
          : null,
        current_pathshala: values.current_pathshala || null,
        vision: values.vision || null,
        pathshala_timing: values.pathshala_timing || null,
        pathshala_name: values.pathshala_name || null,
        role: role || 'संचालक',
        photo_url: photoUrl,
      });
      setDisplayCode(created.display_code);
      setPhase('done');
    } catch (e) {
      // Bilingual copy keyed off error.code (GST-API-05).
      setError(apiErrorMessage(e, hi));
    } finally {
      setBusy(false);
    }
  };

  const goNext = () => {
    const v = validateSection();
    if (v) {
      setError(v);
      return;
    }
    setError(null);
    if (sectionIdx < STAFF_SECTIONS.length - 1) {
      setSectionIdx((i) => i + 1);
      return;
    }
    void submit();
  };

  const renderField = (f: JoinField) => (
    <div key={f.id} className="space-y-2">
      <Label>
        {fieldLabel(f, hi)}
        {f.is_required ? ' *' : ''}
      </Label>
      {f.field_type === 'date' ? (
        <Input
          type="date"
          value={values[f.field_key] ?? ''}
          min={STAFF_DOB_BOUNDS.min}
          max={STAFF_DOB_BOUNDS.max}
          onChange={(e) => setValue(f.field_key, e.target.value)}
        />
      ) : f.field_type === 'textarea' ? (
        <Textarea
          value={values[f.field_key] ?? ''}
          placeholder={fieldPlaceholder(f, hi)}
          onChange={(e) => setValue(f.field_key, e.target.value)}
        />
      ) : f.field_type === 'yesno' ? (
        <div className="flex gap-2">
          {(['yes', 'no'] as const).map((v) => (
            <Button
              key={v}
              type="button"
              variant={values[f.field_key] === v ? 'default' : 'outline'}
              onClick={() => setValue(f.field_key, v)}
            >
              {optionLabel(v, hi)}
            </Button>
          ))}
        </div>
      ) : f.field_type === 'dropdown' ? (
        <Select
          value={values[f.field_key] ?? ''}
          onValueChange={(v) => setValue(f.field_key, v)}
        >
          <SelectTrigger>
            <SelectValue placeholder={hi ? 'चुनें' : 'Choose'} />
          </SelectTrigger>
          <SelectContent>
            {(f.options ?? []).map((o) => (
              <SelectItem key={o} value={o}>
                {optionLabel(o, hi)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          type={f.field_type === 'number' ? 'number' : 'text'}
          value={values[f.field_key] ?? ''}
          placeholder={fieldPlaceholder(f, hi)}
          onChange={(e) => setValue(f.field_key, e.target.value)}
        />
      )}
    </div>
  );

  if (phase === 'loading') {
    return (
      <div className="container py-16 text-muted-foreground">
        {hi ? 'लोड हो रहा है…' : 'Loading…'}
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="container py-16">
        <Card className="mx-auto max-w-lg space-y-4 p-8">
          <div className="flex justify-end">
            <JoinLangToggle />
          </div>
          <h1 className="font-display text-2xl text-secondary">
            {hi ? 'फ़ॉर्म लोड नहीं हो सका' : "Couldn't load the form"}
          </h1>
          <p className="text-muted-foreground">
            {hi
              ? 'अपना कनेक्शन जाँचें और पुनः प्रयास करें — पंजीकरण अभी भी खुला हो सकता है।'
              : 'Check your connection and try again — registration may well still be open.'}
          </p>
          <div className="flex gap-2">
            <Button onClick={() => void loadForm()}>{hi ? 'पुनः प्रयास करें' : 'Try again'}</Button>
            <Button asChild variant="outline">
              <Link href="/join">{hi ? 'मार्ग चुनें' : 'Choose path'}</Link>
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (phase === 'closed') {
    return (
      <div className="container py-16">
        <Card className="mx-auto max-w-lg space-y-4 p-8">
          <div className="flex justify-end">
            <JoinLangToggle />
          </div>
          <h1 className="font-display text-2xl text-secondary">
            {hi ? 'पंजीकरण बंद है' : 'Registration is closed'}
          </h1>
          <p className="text-muted-foreground">
            {hi ? 'कृपया बाद में पुनः प्रयास करें।' : 'Please check back later.'}
          </p>
          <Button asChild variant="outline">
            <Link href="/join">{hi ? 'मार्ग चुनें' : 'Choose path'}</Link>
          </Button>
        </Card>
      </div>
    );
  }

  if (phase === 'done' && displayCode) {
    return (
      <div className="container py-16">
        <Card className="mx-auto max-w-lg space-y-4 p-8 text-center">
          <div className="flex justify-end">
            <JoinLangToggle />
          </div>
          <h1 className="font-display text-2xl text-secondary">
            {hi ? 'पंजीकरण पूर्ण' : 'Registration complete'}
          </h1>
          <p className="font-mono text-2xl text-primary">{displayCode}</p>
          <p className="text-sm text-muted-foreground">
            {hi ? 'इस कोड को सुरक्षित रखें' : 'Keep this code safe'}
          </p>
          {/* No payment step: seva as a Guruji or Sanchalak carries no fee. */}
          <div className="flex flex-wrap justify-center gap-3">
            <Button asChild>
              <Link href="/join">{hi ? 'होम' : 'Done'}</Link>
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="bg-background">
      <div className="border-b border-border bg-primary/5">
        <div className="container flex items-center justify-between gap-3 py-6">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{title}</p>
            <h1 className="mt-1 font-display text-2xl text-secondary md:text-3xl">
              {hi ? section.title_hi : section.title_en}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {hi ? section.sub_hi : section.sub_en}
            </p>
          </div>
          <JoinLangToggle />
        </div>
      </div>

      <div className="container py-8">
        <div className="mx-auto max-w-lg">
          <div className="mb-6 flex items-center gap-2">
            {STAFF_SECTIONS.map((s, i) => (
              <div
                key={s.id}
                className={`h-2 flex-1 rounded-full ${i <= sectionIdx ? 'bg-primary' : 'bg-muted'}`}
              />
            ))}
          </div>
          <p className="mb-4 text-xs text-muted-foreground">
            {hi
              ? `चरण ${sectionIdx + 1} / ${STAFF_SECTIONS.length}`
              : `Step ${sectionIdx + 1} of ${STAFF_SECTIONS.length}`}
          </p>

          <Card className="space-y-5 p-6 md:p-8">
            {section.includeRole && kind === 'shikshak' ? (
              <div className="space-y-2">
                <Label>{hi ? 'भूमिका *' : 'Role *'}</Label>
                <div className="flex gap-2">
                  {['गुरुजी', 'दीदी'].map((r) => (
                    <Button
                      key={r}
                      type="button"
                      variant={role === r ? 'default' : 'outline'}
                      onClick={() => setRole(r)}
                    >
                      {r}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}

            {section.includeCentre ? (
              <div className="space-y-2">
                <Label>{hi ? 'पाठशाला केंद्र *' : 'Pathshala centre *'}</Label>
                <Input
                  value={centreQuery}
                  onChange={(e) => setCentreQuery(e.target.value)}
                  placeholder={hi ? 'केंद्र खोजें…' : 'Search centre…'}
                />
                <Select value={centreId} onValueChange={setCentreId}>
                  <SelectTrigger>
                    <SelectValue placeholder={hi ? 'केंद्र चुनें' : 'Select centre'} />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredCentres.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} ({c.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {sectionFields.map(renderField)}

            {section.includePhoto ? (
              <div className="space-y-2">
                <Label>
                  {photo ? fieldLabel(photo, hi) : hi ? 'फ़ोटो' : 'Photo'}
                  {photo?.is_required ? ' *' : ''}
                </Label>
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
                      setPhotoUrl(up.url);
                    } catch (err) {
                      setError(
        apiErrorMessage(err, hi, {
          ERR_VALIDATION_FAILED: {
            en: 'Upload failed — choose a clear image and try again.',
            hi: 'अपलोड विफल रहा — साफ़ छवि चुनकर पुनः प्रयास करें।',
          },
        }),
      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
                {photoUrl ? (
                  <div className="flex items-center gap-3">
                    <img
                      src={photoUrl}
                      alt=""
                      className="h-16 w-16 rounded-md border border-border object-cover"
                    />
                    <p className="text-xs text-muted-foreground">
                      {hi ? 'अपलोड हो गया' : 'Uploaded'}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            <div className="flex flex-wrap gap-3 pt-2">
              {sectionIdx > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setError(null);
                    setSectionIdx((i) => i - 1);
                  }}
                >
                  {hi ? 'पीछे' : 'Back'}
                </Button>
              ) : null}
              <Button
                type="button"
                size="lg"
                className="min-w-[8rem] flex-1"
                onClick={goNext}
                disabled={busy}
              >
                {busy
                  ? hi
                    ? 'जमा हो रहा है…'
                    : 'Submitting…'
                  : sectionIdx < STAFF_SECTIONS.length - 1
                    ? hi
                      ? 'आगे'
                      : 'Next'
                    : hi
                      ? 'जमा करें'
                      : 'Submit'}
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
