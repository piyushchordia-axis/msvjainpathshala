/**
 * Admin → New donation campaign (city_admin+). Loads the city list (optional
 * scoping) then renders the client form.
 */

import { authenticatedServerClient } from '@/api/server-client';

import { CreateCampaignForm } from './create-campaign-form';

interface NamedRow {
  id: string;
  name: string;
}

async function loadCities(): Promise<{ id: string; label: string }[]> {
  try {
    const client = await authenticatedServerClient();
    const statesRes = await client.get<{ data: { items: NamedRow[] } }>('/v1/geography/states');
    const out: { id: string; label: string }[] = [];
    for (const s of statesRes.data.data.items) {
      const c = await client.get<{ data: { items: NamedRow[] } }>(
        `/v1/geography/states/${s.id}/cities`,
      );
      for (const city of c.data.data.items)
        out.push({ id: city.id, label: `${city.name} — ${s.name}` });
    }
    return out;
  } catch {
    return [];
  }
}

export default async function NewCampaignPage() {
  const cities = await loadCities();

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-secondary">New donation campaign</h2>
        <p className="text-sm text-muted-foreground">
          Campaigns appear on the public donate page when marked public.
        </p>
      </header>
      <CreateCampaignForm cities={cities} />
    </div>
  );
}
