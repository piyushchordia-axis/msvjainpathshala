/**
 * Admin → New niyam. Renders the client create-niyam form (no server data
 * needed; audience is 'all' or 'msv_only', resolved server-side by scope).
 */

import { CreateNiyamForm } from './create-niyam-form';

export default function NewNiyamPage() {
  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-secondary">New niyam</h2>
        <p className="text-sm text-muted-foreground">
          Create a niyam (task) for your scope. Submissions auto-approve and award Punya.
        </p>
      </header>
      <CreateNiyamForm />
    </div>
  );
}
