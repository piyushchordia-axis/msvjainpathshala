/**
 * Admin → Settings (`/admin/settings`).
 *
 * Platform-wide toggles. Q3: enabling 80G requires registration number,
 * trust name and trust address; certificates are never deleted when toggled
 * off. super_admin gets the editable form; lower admin roles see a
 * read-only summary (the backend also enforces super_admin on the PATCH).
 */

import { getPlatformSettings, type PlatformSettings } from '@/api/admin-misc';
import { Card } from '@/components/ui/card';
import { readSessionUser } from '@/lib/auth-cookies';

import { EightyGForm } from './eighty-g-form';

export default async function AdminSettingsPage() {
  const user = await readSessionUser();
  const isSuperAdmin = user?.role === 'super_admin';

  let settings: PlatformSettings | null = null;
  let error: string | null = null;
  try {
    settings = await getPlatformSettings();
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not load platform settings.';
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-secondary">Settings</h2>
        <p className="text-sm text-muted-foreground">
          Platform-wide configuration. 80G certificates are gated by the toggle below (Q3).
        </p>
      </header>

      {error ? (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </Card>
      ) : null}

      {settings && isSuperAdmin ? <EightyGForm settings={settings} /> : null}

      {settings && !isSuperAdmin ? (
        <Card className="space-y-4 p-6">
          <h3 className="font-display text-lg text-secondary">80G donation certificates</h3>
          <p className="text-sm text-muted-foreground">
            Only a super admin can change these settings.
          </p>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Enabled</dt>
              <dd className="mt-1 text-sm font-semibold">
                {settings.eighty_g_enabled ? (
                  <span className="rounded-pill bg-emerald-500/10 px-2 py-0.5 text-emerald-700">
                    On
                  </span>
                ) : (
                  <span className="rounded-pill bg-muted px-2 py-0.5 text-muted-foreground">
                    Off
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Section</dt>
              <dd className="mt-1 text-sm">{settings.eighty_g_section}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Registration #
              </dt>
              <dd className="mt-1 text-sm">{settings.eighty_g_registration_number ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Trust name</dt>
              <dd className="mt-1 text-sm">{settings.eighty_g_trust_name ?? '—'}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Trust address
              </dt>
              <dd className="mt-1 text-sm">{settings.eighty_g_trust_address ?? '—'}</dd>
            </div>
          </dl>
        </Card>
      ) : null}

      {settings ? (
        <p className="text-xs text-muted-foreground">
          Last updated {new Date(settings.last_updated_at).toLocaleString('en-IN')}
        </p>
      ) : null}
    </div>
  );
}
