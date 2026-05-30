/**
 * Admin → Form builder (`/admin/forms`, SPEC §5.4 / Step 6).
 *
 * Lets city_admin+ edit the per-persona registration form: add custom fields
 * (bilingual labels, type, required) on top of the always-present base fields,
 * and publish a new version. The registration screens resolve the active
 * config at runtime.
 */

import { FormBuilder } from './form-builder';

export default function FormsPage() {
  return (
    <div className="space-y-2">
      <h2 className="font-display text-2xl text-secondary">Form builder</h2>
      <p className="max-w-2xl text-sm text-muted-foreground">
        Customise the registration form for each persona. Base fields like name and date of birth
        are always collected; add any extra fields your network needs.
      </p>
      <FormBuilder />
    </div>
  );
}
