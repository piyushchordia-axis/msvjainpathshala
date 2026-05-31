/**
 * Admin → Punya configs (`/admin/punya/configs`).
 *
 * City_admin tunes per-feature point values within the super_admin-set
 * envelope (SPEC §6.9). Layout mirrors `jp-design-system/preview/admin-table.html`
 * — rows of (feature key, default, override, min, max) with an inline
 * "Save" button per row.
 *
 * The form posts to `POST /v1/admin/punya/configs`; server returns 422
 * `ERR_PUNYA_CONFIG_OUT_OF_BOUNDS` if the override falls outside the
 * envelope, which the client surfaces inline.
 */

import { listFeatures, type PunyaFeature } from '@/api/punya';
import { Card } from '@/components/ui/card';

import { PunyaConfigsForm } from './punya-configs-form';

export default async function AdminPunyaConfigsPage() {
  let features: PunyaFeature[] = [];
  let error: string | null = null;
  try {
    const res = await listFeatures();
    features = res.items;
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not load Punya catalogue.';
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-secondary">Punya configuration</h2>
        <p className="text-sm text-muted-foreground">
          Per-city overrides on point values. Stays within the super-admin envelope.
        </p>
      </header>

      {error ? (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </Card>
      ) : (
        <PunyaConfigsForm features={features} />
      )}
    </div>
  );
}
