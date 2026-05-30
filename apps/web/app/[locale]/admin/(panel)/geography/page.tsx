/**
 * Admin → Geography (state_admin / super_admin). Manage states and cities.
 */

import { authenticatedServerClient } from '@/api/server-client';

import { CreateCityForm, CreateStateForm } from './geography-forms';

interface NamedRow {
  id: string;
  name: string;
}

async function loadStates(): Promise<NamedRow[]> {
  try {
    const client = await authenticatedServerClient();
    const res = await client.get<{ data: { items: NamedRow[] } }>('/v1/geography/states');
    return res.data.data.items;
  } catch {
    return [];
  }
}

export default async function GeographyPage() {
  const states = await loadStates();

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-secondary">Geography</h2>
        <p className="text-sm text-muted-foreground">
          Add states (super admin) and cities. Cities are the primary scoping unit for the network.
        </p>
      </header>
      <CreateStateForm />
      <CreateCityForm states={states} />
    </div>
  );
}
