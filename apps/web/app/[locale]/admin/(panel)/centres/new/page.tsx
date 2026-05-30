/**
 * Admin → New centre. Server component: loads the city list (geography is
 * public) for the picker, then renders the client create-centre form.
 */

import { authenticatedServerClient } from '@/api/server-client';
import { Card } from '@/components/ui/card';

import { CreateCentreForm } from './create-centre-form';

interface NamedRow {
  id: string;
  name: string;
}

async function loadCities(): Promise<{ id: string; label: string }[]> {
  try {
    const client = await authenticatedServerClient();
    const statesRes = await client.get<{ data: { items: NamedRow[] } }>('/v1/geography/states');
    const states = statesRes.data.data.items;
    const out: { id: string; label: string }[] = [];
    for (const s of states) {
      const citiesRes = await client.get<{ data: { items: NamedRow[] } }>(
        `/v1/geography/states/${s.id}/cities`,
      );
      for (const c of citiesRes.data.data.items) {
        out.push({ id: c.id, label: `${c.name} — ${s.name}` });
      }
    }
    return out;
  } catch {
    return [];
  }
}

export default async function NewCentrePage() {
  const cities = await loadCities();

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-secondary">New centre</h2>
        <p className="text-sm text-muted-foreground">
          Add a Pathshala location. The geo-fence radius bounds attendance check-ins.
        </p>
      </header>
      {cities.length === 0 ? (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          Could not load the city list. Try again shortly.
        </Card>
      ) : (
        <CreateCentreForm cities={cities} />
      )}
    </div>
  );
}
