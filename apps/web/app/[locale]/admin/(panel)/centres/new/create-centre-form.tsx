'use client';

/**
 * Create-centre form (city_admin+). Posts to /api/admin/centres/create which
 * proxies POST /v1/centres. Surfaces the result via the global toaster.
 */

import { useState, useTransition } from 'react';

import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/toast';

interface CityOpt {
  id: string;
  label: string;
}

export function CreateCentreForm({ cities }: { cities: CityOpt[] }) {
  const [cityId, setCityId] = useState(cities[0]?.id ?? '');
  const [name, setName] = useState('');
  const [locality, setLocality] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [pincode, setPincode] = useState('');
  const [radius, setRadius] = useState('200');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [pending, startTransition] = useTransition();

  const radiusNum = Number(radius);
  const pincodeOk = pincode === '' || /^\d{4,10}$/.test(pincode);
  const radiusOk = Number.isInteger(radiusNum) && radiusNum >= 10 && radiusNum <= 5000;
  const valid = !!cityId && name.trim().length > 0 && pincodeOk && radiusOk;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) {
      toast.error(
        'Check the form',
        'Pick a city, a name, a valid pincode and a radius (10–5000m).',
      );
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/centres/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            city_id: cityId,
            name: name.trim(),
            gps_radius_m: radiusNum,
            ...(locality.trim() ? { locality: locality.trim() } : {}),
            ...(addressLine.trim() ? { address_line: addressLine.trim() } : {}),
            ...(pincode.trim() ? { pincode: pincode.trim() } : {}),
            ...(phone.trim() ? { contact_phone: phone.trim() } : {}),
            ...(email.trim() ? { contact_email: email.trim() } : {}),
          }),
        });
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        if (!res.ok)
          throw new Error(j?.error?.message ?? `Could not create centre (${res.status})`);
        toast.success('Centre created', `${name.trim()} is on the map.`);
        setName('');
        setLocality('');
        setAddressLine('');
        setPincode('');
        setPhone('');
        setEmail('');
      } catch (err) {
        toast.error(
          'Could not create centre',
          err instanceof Error ? err.message : 'Unknown error',
        );
      }
    });
  }

  if (cities.length === 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">No cities available to you yet.</Card>
    );
  }

  return (
    <Card className="p-6">
      <form onSubmit={submit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <Label className="mb-1 block text-xs font-semibold text-muted-foreground">City</Label>
          <select
            value={cityId}
            onChange={(e) => setCityId(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
          >
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label className="mb-1 block text-xs font-semibold text-muted-foreground">Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Vasna Centre"
          />
        </div>
        <div>
          <Label className="mb-1 block text-xs font-semibold text-muted-foreground">Locality</Label>
          <Input
            value={locality}
            onChange={(e) => setLocality(e.target.value)}
            placeholder="Vasna"
          />
        </div>
        <div>
          <Label className="mb-1 block text-xs font-semibold text-muted-foreground">Pincode</Label>
          <Input
            value={pincode}
            onChange={(e) => setPincode(e.target.value)}
            placeholder="380007"
          />
        </div>
        <div className="md:col-span-2">
          <Label className="mb-1 block text-xs font-semibold text-muted-foreground">Address</Label>
          <Input
            value={addressLine}
            onChange={(e) => setAddressLine(e.target.value)}
            placeholder="Street, landmark"
          />
        </div>
        <div>
          <Label className="mb-1 block text-xs font-semibold text-muted-foreground">
            Geo-fence radius (m)
          </Label>
          <Input type="number" value={radius} onChange={(e) => setRadius(e.target.value)} />
        </div>
        <div>
          <Label className="mb-1 block text-xs font-semibold text-muted-foreground">
            Contact phone
          </Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91…" />
        </div>
        <div className="md:col-span-2">
          <Label className="mb-1 block text-xs font-semibold text-muted-foreground">
            Contact email
          </Label>
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="centre@example.com"
          />
        </div>
        <div className="md:col-span-2 flex items-center justify-end">
          <button
            type="submit"
            disabled={pending || !valid}
            className="rounded-md bg-saffron px-4 py-2 text-sm font-semibold text-white hover:bg-saffron-700 disabled:opacity-60"
          >
            {pending ? 'Creating…' : 'Create centre'}
          </button>
        </div>
      </form>
    </Card>
  );
}
