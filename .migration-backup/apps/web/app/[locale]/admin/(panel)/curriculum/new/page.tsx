/**
 * Admin → New curriculum (`/admin/curriculum/new`).
 *
 * Bilingual composer. MSV type option is hidden in the dropdown for
 * non-super_admin (UI level) — but the SERVICE LAYER also returns 403 with
 * ERR_RBAC_FORBIDDEN_MSV_CURRICULUM (Q2). The UI hide is convenience; the
 * service is the real gate.
 */

import { readSessionUser } from '@/lib/auth-cookies';

import NewCurriculumForm from './new-form';

export default async function NewCurriculumPage() {
  const user = await readSessionUser();
  const isSuper = user?.role === 'super_admin';
  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-secondary">New curriculum</h2>
        <p className="text-sm text-muted-foreground">
          Pick a kind, name it, and choose whether to start in draft or active. Sections and items
          can be added once the curriculum exists.
        </p>
      </header>
      <NewCurriculumForm allowMsv={isSuper} />
    </div>
  );
}
