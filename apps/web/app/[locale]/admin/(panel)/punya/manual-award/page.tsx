/**
 * Admin → Manual Punya award (`/admin/punya/manual-award`).
 *
 * Form matches `jp-design-system/preview/admin-forms.html` — two-column
 * grid (student_id / feature_key, points / MSV-track, reason spanning
 * both columns). Server fetches the catalogue so the feature dropdown
 * is populated with bounds the user can see inline.
 */

import { listFeatures, type PunyaFeature } from '@/api/punya';
import { Card } from '@/components/ui/card';

import { ManualAwardForm } from './manual-award-form';

export default async function AdminManualAwardPage() {
  let features: PunyaFeature[] = [];
  let error: string | null = null;
  try {
    const res = await listFeatures();
    features = res.items;
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not load the catalogue.';
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-secondary">Award Punya</h2>
        <p className="text-sm text-muted-foreground">
          Manual award — used for seva, festival participation, or to correct a missed niyam credit.
          Reason is mandatory for manual rows.
        </p>
      </header>

      {error ? (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </Card>
      ) : (
        <ManualAwardForm features={features} />
      )}
    </div>
  );
}
