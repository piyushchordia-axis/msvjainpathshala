'use client';

/**
 * Form builder (SPEC §5.4 / Step 6) — client island.
 *
 * Pick a persona, load its current active config, edit the custom fields
 * (add / remove / reorder is out of scope — order is array order), and
 * publish a new version. Publishing creates a versioned config the
 * registration screens resolve at runtime.
 */

import { useCallback, useEffect, useState } from 'react';

import { toast } from '@/components/ui/toast';

const PERSONAS = ['student', 'parent', 'shikshak', 'sanchalak', 'city_admin'] as const;
type Persona = (typeof PERSONAS)[number];

const FIELD_TYPES = [
  'text',
  'multiline',
  'number',
  'date',
  'select',
  'multiselect',
  'boolean',
  'phone',
  'email',
  'file',
] as const;
type FieldType = (typeof FIELD_TYPES)[number];

interface CustomField {
  key: string;
  label_en: string;
  label_hi: string;
  type: FieldType;
  required: boolean;
  options?: string[];
}

interface FormConfig {
  id: string;
  form_kind: string;
  version_no: number;
  custom_fields: CustomField[] | null;
}

function emptyField(): CustomField {
  return { key: '', label_en: '', label_hi: '', type: 'text', required: false };
}

async function errorMessage(res: Response): Promise<string> {
  const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return j?.error?.message ?? `Request failed (${res.status})`;
}

export function FormBuilder() {
  const [persona, setPersona] = useState<Persona>('student');
  const [fields, setFields] = useState<CustomField[]>([]);
  const [version, setVersion] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (p: Persona) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/form-configs?persona=${p}`);
      if (!res.ok) throw new Error(await errorMessage(res));
      const j = (await res.json()) as { data: FormConfig | null };
      setFields(j.data?.custom_fields ?? []);
      setVersion(j.data?.version_no ?? null);
    } catch (err) {
      toast.error('Could not load form', err instanceof Error ? err.message : 'Try again');
      setFields([]);
      setVersion(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(persona);
  }, [persona, load]);

  function updateField(i: number, patch: Partial<CustomField>) {
    setFields((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }

  function removeField(i: number) {
    setFields((prev) => prev.filter((_, idx) => idx !== i));
  }

  function addField() {
    setFields((prev) => [...prev, emptyField()]);
  }

  function validate(): string | null {
    const seen = new Set<string>();
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (!f.key.trim()) return `Field ${i + 1}: key is required.`;
      if (!/^[a-z][a-z0-9_]*$/.test(f.key.trim()))
        return `Field ${i + 1}: key must be snake_case (letters, digits, underscore).`;
      if (seen.has(f.key.trim())) return `Field ${i + 1}: duplicate key "${f.key.trim()}".`;
      seen.add(f.key.trim());
      if (!f.label_en.trim()) return `Field ${i + 1}: English label is required.`;
      if (!f.label_hi.trim()) return `Field ${i + 1}: Hindi label is required.`;
    }
    return null;
  }

  async function publish() {
    const problem = validate();
    if (problem) {
      toast.error('Check the fields', problem);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/admin/form-configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          form_kind: persona,
          city_id: null,
          custom_fields: fields.map((f) => ({
            key: f.key.trim(),
            label_en: f.label_en.trim(),
            label_hi: f.label_hi.trim(),
            type: f.type,
            required: f.required,
            ...(f.options && f.options.length ? { options: f.options } : {}),
          })),
        }),
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      toast.success('Form published', `${persona} form is now live.`);
      await load(persona);
    } catch (err) {
      toast.error('Could not publish', err instanceof Error ? err.message : 'Try again');
    } finally {
      setBusy(false);
    }
  }

  const needsOptions = (t: FieldType) => t === 'select' || t === 'multiselect';

  return (
    <div className="mt-6 space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <div className="max-w-xs">
          <label className="block text-sm font-medium text-secondary" htmlFor="persona">
            Persona
          </label>
          <select
            id="persona"
            value={persona}
            onChange={(e) => setPersona(e.target.value as Persona)}
            className="mt-1 w-full rounded-md border border-border bg-cream-dark px-3 py-2 text-ink"
          >
            {PERSONAS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <p className="text-sm text-muted-foreground">
          {version === null ? 'No published version yet' : `Current version: v${version}`}
        </p>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-4">
          {fields.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No custom fields. Add one below — base fields (name, DOB, etc.) are always present.
            </p>
          ) : (
            fields.map((f, i) => (
              <div key={i} className="rounded-lg border border-border bg-cream-dark p-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground">
                      Key (snake_case)
                    </label>
                    <input
                      value={f.key}
                      onChange={(e) => updateField(i, { key: e.target.value })}
                      placeholder="blood_group"
                      className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-ink"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground">
                      Type
                    </label>
                    <select
                      value={f.type}
                      onChange={(e) => updateField(i, { type: e.target.value as FieldType })}
                      className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-ink"
                    >
                      {FIELD_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground">
                      Label (English)
                    </label>
                    <input
                      value={f.label_en}
                      onChange={(e) => updateField(i, { label_en: e.target.value })}
                      placeholder="Blood group"
                      className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-ink"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground">
                      Label (Hindi)
                    </label>
                    <input
                      value={f.label_hi}
                      onChange={(e) => updateField(i, { label_hi: e.target.value })}
                      placeholder="रक्त समूह"
                      className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-ink"
                    />
                  </div>
                  {needsOptions(f.type) ? (
                    <div className="md:col-span-2">
                      <label className="block text-xs font-semibold text-muted-foreground">
                        Options (comma-separated)
                      </label>
                      <input
                        value={(f.options ?? []).join(', ')}
                        onChange={(e) =>
                          updateField(i, {
                            options: e.target.value
                              .split(',')
                              .map((s) => s.trim())
                              .filter(Boolean),
                          })
                        }
                        placeholder="A+, A-, B+, O+"
                        className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-ink"
                      />
                    </div>
                  ) : null}
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={f.required}
                      onChange={(e) => updateField(i, { required: e.target.checked })}
                    />
                    Required
                  </label>
                  <button
                    type="button"
                    onClick={() => removeField(i)}
                    className="text-sm font-semibold text-destructive hover:underline"
                  >
                    Remove field
                  </button>
                </div>
              </div>
            ))
          )}

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={addField}
              className="rounded-md border border-border px-3 py-2 text-sm font-semibold text-secondary hover:bg-muted/40"
            >
              + Add field
            </button>
            <button
              type="button"
              onClick={() => void publish()}
              disabled={busy}
              className="rounded-md bg-saffron px-4 py-2 text-sm font-semibold text-white hover:bg-saffron-700 disabled:opacity-60"
            >
              {busy ? 'Publishing…' : 'Publish new version'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
