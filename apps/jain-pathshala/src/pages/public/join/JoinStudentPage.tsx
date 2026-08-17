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
  STUDENT_SECTIONS,
  fieldLabel,
  fieldPlaceholder,
  fieldsForSection,
  optionLabel,
  photoField,
  type CityOption,
  type CentreOption,
  type JoinField,
  uploadJoinFile,
} from '@/lib/join';
import { JoinLangToggle, usePreferJoinHindi } from './JoinLangToggle';

// 'error' is distinct from 'closed' on purpose: a dead network used to render
// "Registration is closed" — a permanent-sounding refusal on the single
// highest-value guest conversion path, when the server was merely unreachable.
type Phase = 'loading' | 'error' | 'closed' | 'form' | 'done';

export default function JoinStudentPage() {
  usePreferJoinHindi();
  const hi = useLocale() === 'hi';
  const [phase, setPhase] = useState<Phase>('loading');
  const [sectionIdx, setSectionIdx] = useState(0);
  const [allFields, setAllFields] = useState<JoinField[]>([]);
  const [cities, setCities] = useState<CityOption[]>([]);
  const [centres, setCentres] = useState<CentreOption[]>([]);
  const [cityQuery, setCityQuery] = useState('');
  const [centreQuery, setCentreQuery] = useState('');
  const [cityId, setCityId] = useState('');
  const [centreId, setCentreId] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reg, setReg] = useState<{ id: string; display_code: string } | null>(null);

  const loadForm = useCallback(async () => {
    setPhase('loading');
    try {
      const [s, f, c, centresRes] = await Promise.all([
        apiGet<{ registration_open: boolean }>('/v1/join/settings?kind=student'),
        apiGet<{ items: JoinField[] }>('/v1/join/form-fields?kind=student'),
        apiGet<{ items: CityOption[] }>('/v1/public/cities'),
        apiGet<{ items: CentreOption[] }>('/v1/public/centres'),
      ]);
      setAllFields(f.items);
      setCities(c.items);
      setCentres(centresRes.items.filter((x) => !!x.code));
      // 'closed' is reserved for the real signal — registration_open === false.
      setPhase(s.registration_open ? 'form' : 'closed');
    } catch {
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    void loadForm();
  }, [loadForm]);

  const photo = useMemo(() => photoField(allFields), [allFields]);
  const section = STUDENT_SECTIONS[sectionIdx]!;
  const sectionFields = useMemo(
    () => fieldsForSection(allFields, section),
    [allFields, section],
  );
  // Server-side ?q= merge — beyond the clamped first page a centre was
  // unpickable however the guest spelled it (GST-PRF-03).
  const cityQ = cityQuery.trim();
  const cityExtra = usePickerSearch<CityOption>(
    cityQ.length >= 2 ? `/v1/public/cities?q=${encodeURIComponent(cityQ)}` : null,
  );
  const centreQ = centreQuery.trim();
  const centreExtra = usePickerSearch<CentreOption>(
    cityId && centreQ.length >= 2
      ? `/v1/public/centres?city_id=${encodeURIComponent(cityId)}&q=${encodeURIComponent(centreQ)}`
      : null,
  );

  const filteredCities = useMemo(() => {
    const q = cityQ.toLowerCase();
    const pool = mergeById(cities, cityExtra);
    if (!q) return pool;
    return pool.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.state_name.toLowerCase().includes(q),
    );
  }, [cities, cityExtra, cityQ]);

  const centresInCity = useMemo(() => {
    if (!cityId) return [];
    const pool = mergeById(centres, centreExtra.filter((x) => !!x.code));
    return pool.filter((c) => c.city_id === cityId);
  }, [centres, centreExtra, cityId]);

  const filteredCentres = useMemo(() => {
    const q = centreQ.toLowerCase();
    if (!q) return centresInCity;
    return centresInCity.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.code ?? '').toLowerCase().includes(q),
    );
  }, [centresInCity, centreQ]);

  const setValue = (key: string, v: string) => setValues((prev) => ({ ...prev, [key]: v }));

  const validateSection = (): string | null => {
    if (section.includeCity && !cityId) {
      return hi ? 'शहर चुनें' : 'Choose a city';
    }
    if (section.includeCentre && !centreId) {
      return hi ? 'केंद्र चुनें' : 'Choose a centre';
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
    if (sectionFields.some((f) => f.field_key === 'parent_mobile')) {
      const parentMobile = values.parent_mobile ?? '';
      if (!/^\d{10}$/.test(parentMobile)) {
        return hi
          ? 'अभिभावक का 10 अंकों का मोबाइल दर्ज करें'
          : 'Enter a valid 10-digit parent mobile';
      }
    }
    if (sectionFields.some((f) => f.field_key === 'mobile')) {
      const mobile = values.mobile ?? '';
      if (mobile && !/^\d{10}$/.test(mobile)) {
        return hi ? '10 अंकों का मोबाइल दर्ज करें' : 'Enter a valid 10-digit mobile';
      }
    }
    if (sectionFields.some((f) => f.field_key === 'age') && values.age) {
      const age = Number(values.age);
      if (!Number.isFinite(age) || age < 3 || age > 35) {
        return hi ? 'आयु 3 से 35 के बीच होनी चाहिए' : 'Age must be between 3 and 35';
      }
    }
    return null;
  };

  const goNext = () => {
    const v = validateSection();
    if (v) {
      setError(v);
      return;
    }
    setError(null);
    if (sectionIdx < STUDENT_SECTIONS.length - 1) {
      setSectionIdx((i) => i + 1);
      return;
    }
    void submitForm();
  };

  const submitForm = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await apiPost<{ id: string; display_code: string }>(
        '/v1/join/registrations',
        {
          kind: 'student',
          city_id: cityId,
          centre_id: centreId,
          name: values.name,
          parent_mobile: values.parent_mobile,
          mobile: values.mobile || null,
          email: values.email || null,
          father_name: values.father_name || null,
          age: values.age ? Number(values.age) : null,
          sex: values.sex || null,
          education: values.education || null,
          address: values.address || null,
          family_members: 1,
          will_attend: 'yes',
          special_note: values.special_note || null,
          photo_url: photoUrl,
        },
      );
      setReg(created);
      setPhase('done');
    } catch (e) {
      // Bilingual copy keyed off error.code (GST-API-05).
      setError(apiErrorMessage(e, hi));
    } finally {
      setBusy(false);
    }
  };

  const onPickPhoto = async (file: File | undefined) => {
    if (!file) return;
    const localUrl = URL.createObjectURL(file);
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    setPhotoPreviewUrl(localUrl);
    setBusy(true);
    setError(null);
    try {
      const up = await uploadJoinFile(file);
      setPhotoUrl(up.url);
    } catch (err) {
      setPhotoPreviewUrl(null);
      setPhotoUrl(null);
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
  };

  const renderField = (f: JoinField) => (
    <div key={f.id} className="space-y-2">
      <Label>
        {fieldLabel(f, hi)}
        {f.is_required ? ' *' : ''}
      </Label>
      {f.field_type === 'textarea' ? (
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
            <Button onClick={() => void loadForm()}>
              {hi ? 'पुनः प्रयास करें' : 'Try again'}
            </Button>
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

  if (phase === 'done' && reg) {
    return (
      <div className="container py-16">
        <Card className="mx-auto max-w-lg space-y-4 p-8 text-center">
          <div className="flex justify-end">
            <JoinLangToggle />
          </div>
          <h1 className="font-display text-2xl text-secondary">
            {hi ? 'अनुरोध भेज दिया गया' : 'Request sent for approval'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {hi
              ? 'आपका पंजीकरण स्वीकृति के लिए भेज दिया गया है। अनुमोदन के बाद अभिभावक मोबाइल से लॉगिन कर सकते हैं।'
              : 'Your registration has been sent for approval. After approval, the parent can log in with the parent mobile.'}
          </p>
          <p className="font-mono text-2xl text-primary">{reg.display_code}</p>
          <p className="text-xs text-muted-foreground">
            {hi ? 'इस कोड को सुरक्षित रखें' : 'Keep this code safe'}
          </p>
          {/* Carry the code + mobile the family just typed — the CTA used to
              land them on an empty form to retype both (GST-API-02). */}
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link
                href={`/join/student/complete-payment?code=${encodeURIComponent(reg.display_code)}&mobile=${encodeURIComponent(values.parent_mobile ?? '')}`}
              >
                {hi ? 'शुल्क भुगतान करें' : 'Complete payment'}
              </Link>
            </Button>
            <Button asChild variant="outline">
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
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              {hi ? 'विद्यार्थी पंजीकरण' : 'Student registration'}
            </p>
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
            {STUDENT_SECTIONS.map((s, i) => (
              <div
                key={s.id}
                className={`h-2 flex-1 rounded-full ${
                  i <= sectionIdx ? 'bg-primary' : 'bg-muted'
                }`}
                title={hi ? s.title_hi : s.title_en}
              />
            ))}
          </div>
          <p className="mb-4 text-xs text-muted-foreground">
            {hi
              ? `चरण ${sectionIdx + 1} / ${STUDENT_SECTIONS.length}`
              : `Step ${sectionIdx + 1} of ${STUDENT_SECTIONS.length}`}
          </p>

          <Card className="space-y-5 p-6 md:p-8">
            {section.includeCity ? (
              <div className="space-y-2">
                <Label>{hi ? 'शहर *' : 'City *'}</Label>
                <Input
                  value={cityQuery}
                  onChange={(e) => setCityQuery(e.target.value)}
                  placeholder={hi ? 'शहर खोजें…' : 'Search city…'}
                />
                <Select
                  value={cityId}
                  onValueChange={(v) => {
                    setCityId(v);
                    setCentreId('');
                    setCentreQuery('');
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={hi ? 'शहर चुनें' : 'Select city'} />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredCities.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} ({c.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {section.includeCentre ? (
              <div className="space-y-2">
                <Label>{hi ? 'पाठशाला केंद्र *' : 'Pathshala centre *'}</Label>
                <Input
                  value={centreQuery}
                  onChange={(e) => setCentreQuery(e.target.value)}
                  placeholder={hi ? 'केंद्र खोजें…' : 'Search centre…'}
                  disabled={!cityId}
                />
                <Select value={centreId} onValueChange={setCentreId} disabled={!cityId}>
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        !cityId
                          ? hi
                            ? 'पहले शहर चुनें'
                            : 'Choose a city first'
                          : hi
                            ? 'केंद्र चुनें'
                            : 'Select centre'
                      }
                    />
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
                  onChange={(e) => void onPickPhoto(e.target.files?.[0])}
                />
                {photoPreviewUrl || photoUrl ? (
                  <div className="flex items-center gap-3">
                    <img
                      src={photoPreviewUrl ?? photoUrl!}
                      alt=""
                      className="h-24 w-24 rounded-md object-cover border border-border"
                    />
                    <p className="text-xs text-muted-foreground">
                      {photoUrl
                        ? hi
                          ? 'अपलोड हो गया'
                          : 'Uploaded'
                        : hi
                          ? 'अपलोड हो रहा है…'
                          : 'Uploading…'}
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
                  : sectionIdx < STUDENT_SECTIONS.length - 1
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
