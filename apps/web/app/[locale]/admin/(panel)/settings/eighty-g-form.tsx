'use client';

/**
 * 80G certificate settings form (super_admin only). Q3:
 *   - enabling requires registration number, trust name AND trust address
 *   - existing certificates are never deleted when toggled off
 *
 * Posts to `/api/admin/platform-settings/80g` and surfaces the result via
 * the global toaster.
 */

import { useState, useTransition } from 'react';

import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/toast';

import type { PlatformSettings } from '@/api/admin-misc';

export function EightyGForm({ settings }: { settings: PlatformSettings }) {
  const [enabled, setEnabled] = useState(settings.eighty_g_enabled);
  const [reg, setReg] = useState(settings.eighty_g_registration_number ?? '');
  const [trust, setTrust] = useState(settings.eighty_g_trust_name ?? '');
  const [address, setAddress] = useState(settings.eighty_g_trust_address ?? '');
  const [section, setSection] = useState(settings.eighty_g_section || '80G');
  const [pending, startTransition] = useTransition();

  const missingForEnable = enabled && (!reg.trim() || !trust.trim() || !address.trim());

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (missingForEnable) {
      toast.error(
        'Cannot enable 80G',
        'Registration number, trust name and trust address are all required.',
      );
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/platform-settings/80g', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            enabled,
            eighty_g_registration_number: reg.trim() || null,
            eighty_g_trust_name: trust.trim() || null,
            eighty_g_trust_address: address.trim() || null,
            eighty_g_section: section.trim() || '80G',
          }),
        });
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        if (!res.ok) {
          throw new Error(j?.error?.message ?? `Update failed (${res.status})`);
        }
        toast.success(
          'Settings saved',
          enabled
            ? '80G certificates are now enabled.'
            : '80G certificates are now disabled. Existing certificates are kept.',
        );
      } catch (err) {
        toast.error(
          'Could not save settings',
          err instanceof Error ? err.message : 'Unknown error',
        );
      }
    });
  }

  return (
    <Card className="space-y-4 p-6">
      <div>
        <h3 className="font-display text-lg text-secondary">80G donation certificates</h3>
        <p className="text-sm text-muted-foreground">
          Q3: enabling requires the registration number, trust name and trust address. Existing
          certificates are never deleted when you turn this off.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <label className="flex items-center gap-3 text-sm font-medium">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4"
          />
          Enable 80G certificate generation
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Registration number" value={reg} onChange={setReg} required={enabled} />
          <Field label="Section" value={section} onChange={setSection} />
          <Field label="Trust name" value={trust} onChange={setTrust} required={enabled} />
          <Field label="Trust address" value={address} onChange={setAddress} required={enabled} />
        </div>

        <div className="flex items-center justify-end">
          <button
            type="submit"
            disabled={pending || missingForEnable}
            className="rounded-md bg-saffron px-4 py-2 text-sm font-semibold text-white hover:bg-saffron-700 disabled:opacity-60"
          >
            {pending ? 'Saving…' : 'Save 80G settings'}
          </button>
        </div>
      </form>
    </Card>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <div>
      <Label className="mb-1 block text-xs font-semibold text-muted-foreground">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
