import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLocale } from '@/lib/locale-context';

interface Campaign {
  id: string;
  name: string;
  description?: string | null;
  target_amount_paise?: number | null;
  raised_amount_paise?: number | null;
}

interface OrderResponse {
  donation_id: string;
  order_id: string;
  key_id: string;
  amount_paise: number;
  currency: string;
  provider: 'razorpay' | 'mock';
}

interface RazorpayResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

// Minimal Razorpay checkout typing — the script is loaded lazily on demand.
type RazorpayCtor = new (opts: Record<string, unknown>) => { open: () => void };
declare global {
  interface Window {
    Razorpay?: RazorpayCtor;
  }
}

const PRESET_AMOUNTS = [501, 1100, 2500, 5100];

function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) {
      resolve(true);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export default function DonatePage() {
  const locale = useLocale();
  const hi = locale === 'hi';

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState<string>('');

  const [amount, setAmount] = useState('1100');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [purpose, setPurpose] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [testMode, setTestMode] = useState(false);

  useEffect(() => {
    fetch('/v1/donations/campaigns', { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : { data: { items: [] } }))
      .then((json: { data?: { items?: Campaign[] } }) => setCampaigns(json.data?.items ?? []))
      .catch(() => {});
  }, []);

  async function captureMock(donationId: string) {
    const res = await fetch(`/v1/donations/${donationId}/dev-capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({}),
    });
    const json = (await res.json().catch(() => null)) as
      | { data?: { receipt_number?: string } }
      | null;
    if (res.ok && json?.data?.receipt_number) {
      setTestMode(true);
      setReceipt(json.data.receipt_number);
    } else {
      setErrorMsg(hi ? 'भुगतान पूर्ण नहीं हो सका।' : 'Could not complete the payment.');
    }
  }

  async function verifyRazorpay(donationId: string, resp: RazorpayResponse) {
    const res = await fetch('/v1/donations/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        donation_id: donationId,
        razorpay_order_id: resp.razorpay_order_id,
        razorpay_payment_id: resp.razorpay_payment_id,
        razorpay_signature: resp.razorpay_signature,
      }),
    });
    const json = (await res.json().catch(() => null)) as
      | { data?: { receipt_number?: string } }
      | null;
    if (res.ok && json?.data?.receipt_number) {
      setReceipt(json.data.receipt_number);
    } else {
      setErrorMsg(hi ? 'भुगतान सत्यापित नहीं हुआ।' : 'Payment could not be verified.');
    }
  }

  async function openRazorpay(order: OrderResponse) {
    const loaded = await loadRazorpayScript();
    if (!loaded || !window.Razorpay) {
      setErrorMsg(
        hi
          ? 'भुगतान विंडो लोड नहीं हो सकी। कृपया पुनः प्रयास करें।'
          : 'Could not load the payment window. Please try again.',
      );
      setSubmitting(false);
      return;
    }
    const rzp = new window.Razorpay({
      key: order.key_id,
      amount: order.amount_paise,
      currency: order.currency,
      name: 'Jain Pathshala',
      description: purpose.trim() || (hi ? 'दान' : 'Donation'),
      order_id: order.order_id,
      prefill: { name: name.trim(), contact: phone.trim(), email: email.trim() },
      handler: (resp: RazorpayResponse) => {
        void verifyRazorpay(order.donation_id, resp).finally(() => setSubmitting(false));
      },
      modal: {
        ondismiss: () => setSubmitting(false),
      },
    });
    rzp.open();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setErrorMsg(null);
    setReceipt(null);
    setTestMode(false);

    const rupees = Number(amount);
    if (!name.trim()) {
      setErrorMsg(hi ? 'कृपया अपना नाम भरें।' : 'Please enter your name.');
      return;
    }
    if (!Number.isFinite(rupees) || rupees < 1) {
      setErrorMsg(hi ? 'कृपया एक मान्य राशि दर्ज करें।' : 'Please enter a valid amount.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/v1/donations/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          amount_paise: Math.round(rupees * 100),
          donor_name: name.trim(),
          donor_phone: phone.trim() || undefined,
          donor_email: email.trim() || undefined,
          purpose: purpose.trim() || undefined,
          campaign_id: campaignId || undefined,
        }),
      });
      const json = (await res.json().catch(() => null)) as { data?: OrderResponse } | null;
      if (!res.ok || !json?.data) {
        setErrorMsg(hi ? 'दान आरंभ नहीं हो सका।' : 'Could not start the donation.');
        setSubmitting(false);
        return;
      }
      const order = json.data;
      if (order.provider === 'mock') {
        await captureMock(order.donation_id);
        setSubmitting(false);
      } else {
        await openRazorpay(order);
        // submitting is cleared inside the checkout handler / dismiss callback.
      }
    } catch {
      setErrorMsg(hi ? 'नेटवर्क त्रुटि। पुनः प्रयास करें।' : 'Network error. Please try again.');
      setSubmitting(false);
    }
  }

  function resetForm() {
    setReceipt(null);
    setTestMode(false);
    setErrorMsg(null);
    setName('');
    setPhone('');
    setEmail('');
    setPurpose('');
    setAmount('1100');
    setCampaignId('');
  }

  return (
    <section className="container py-12 md:py-16">
      <p className="text-sm font-medium uppercase tracking-[0.18em] text-primary">
        {hi ? 'दान' : 'Donate'}
      </p>
      <h1 className="mt-3 font-display text-4xl text-secondary md:text-5xl">
        {hi ? 'पाठशाला का सहयोग करें' : 'Support the Pathshala'}
      </h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        {hi
          ? 'आपका योगदान बच्चों की धार्मिक शिक्षा और केंद्र की सुविधाओं को सशक्त बनाता है।'
          : 'Your contribution strengthens the dharmic education of children and the facilities of our centres.'}
      </p>

      {receipt ? (
        <Card className="mt-10 max-w-xl p-8">
          <h2 className="font-display text-3xl text-secondary">
            {hi ? 'धन्यवाद!' : 'Thank you!'}
          </h2>
          {testMode ? (
            <p className="mt-2 inline-block rounded bg-amber-100 px-2 py-1 text-xs font-medium uppercase tracking-wide text-amber-800">
              {hi ? 'परीक्षण मोड' : 'Test mode'}
            </p>
          ) : null}
          <p className="mt-3 text-muted-foreground">
            {hi
              ? 'आपका दान सफलतापूर्वक प्राप्त हुआ।'
              : 'Your donation was received successfully.'}
          </p>
          <p className="mt-4 text-sm">
            <span className="text-muted-foreground">{hi ? 'रसीद संख्या' : 'Receipt number'}: </span>
            <span className="font-mono font-medium">{receipt}</span>
          </p>
          <Button className="mt-6" variant="outline" onClick={resetForm}>
            {hi ? 'एक और दान करें' : 'Donate again'}
          </Button>
        </Card>
      ) : (
        <Card className="mt-8 max-w-xl p-6 md:p-8">
          <form className="space-y-5" onSubmit={submit}>
            {campaigns.length > 0 ? (
              <div className="space-y-1">
                <Label className="text-sm font-medium">{hi ? 'अभियान' : 'Campaign'}</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={campaignId}
                  onChange={(e) => setCampaignId(e.target.value)}
                >
                  <option value="">{hi ? 'सामान्य दान' : 'General donation'}</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="space-y-1">
              <Label className="text-sm font-medium">
                {hi ? 'राशि (₹)' : 'Amount (₹)'} <span className="text-destructive">*</span>
              </Label>
              <div className="flex flex-wrap gap-2">
                {PRESET_AMOUNTS.map((a) => (
                  <Button
                    key={a}
                    type="button"
                    size="sm"
                    variant={amount === String(a) ? 'default' : 'outline'}
                    onClick={() => setAmount(String(a))}
                  >
                    ₹{a.toLocaleString('en-IN')}
                  </Button>
                ))}
              </div>
              <Input
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-2"
                required
              />
            </div>

            <div className="space-y-1">
              <Label className="text-sm font-medium">
                {hi ? 'पूरा नाम' : 'Full name'} <span className="text-destructive">*</span>
              </Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-sm font-medium">{hi ? 'फ़ोन नंबर' : 'Phone number'}</Label>
                <Input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91…"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-sm font-medium">{hi ? 'ईमेल' : 'Email'}</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-sm font-medium">{hi ? 'उद्देश्य' : 'Purpose'}</Label>
              <Input
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder={hi ? 'जैसे, भवन निर्माण' : 'e.g., building fund'}
              />
            </div>

            {errorMsg ? <p className="text-sm text-destructive">{errorMsg}</p> : null}

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting
                ? hi
                  ? 'प्रक्रिया जारी…'
                  : 'Processing…'
                : hi
                  ? 'अभी दान करें'
                  : 'Donate now'}
            </Button>

            <p className="text-xs text-muted-foreground">
              {hi
                ? 'सभी दान आयकर अधिनियम की धारा 80G के अंतर्गत कर-छूट के लिए पात्र हैं। रसीद ईमेल/फ़ोन पर भेजी जाएगी।'
                : 'All donations are eligible for tax exemption under Section 80G of the Income Tax Act. A receipt will be issued.'}
            </p>
          </form>
        </Card>
      )}
    </section>
  );
}
