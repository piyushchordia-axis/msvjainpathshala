/**
 * Admin → New competition. Renders the client create-competition form.
 */

import { CreateCompetitionForm } from './create-competition-form';

export default function NewCompetitionPage() {
  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-secondary">New competition</h2>
        <p className="text-sm text-muted-foreground">
          Create a competition. Results and publishing happen from the competition&apos;s page.
        </p>
      </header>
      <CreateCompetitionForm />
    </div>
  );
}
