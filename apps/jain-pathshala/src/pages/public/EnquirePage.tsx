import { useState } from 'react';
import { Link } from 'wouter';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useLocale } from '@/lib/locale-context';

export default function EnquirePage() {
  const locale = useLocale();
  const hi = locale === 'hi';

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [message, setMessage] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setErrorMsg(null);
    if (!name.trim() || !message.trim()) {
      setErrorMsg(hi ? 'कृपया नाम और संदेश भरें।' : 'Please enter your name and message.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/v1/enquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          kind: 'enquire',
          name: name.trim(),
          phone: phone.trim() || undefined,
          city: city.trim() || undefined,
          message: message.trim(),
        }),
      });
      if (res.ok) {
        setSubmitted(true);
        return;
      }
      const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      setErrorMsg(json?.error?.message ?? (hi ? 'पूछताछ भेजने में त्रुटि हुई।' : 'Could not send your enquiry.'));
    } catch {
      setErrorMsg(hi ? 'नेटवर्क त्रुटि। पुनः प्रयास करें।' : 'Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="container py-12 md:py-16">
      <p className="text-sm font-medium uppercase tracking-[0.18em] text-primary">
        {hi ? 'पूछताछ' : 'Enquire'}
      </p>
      <h1 className="mt-3 font-display text-4xl text-secondary md:text-5xl">
        {hi ? 'नामांकन के बारे में पूछें' : 'Ask about enrolling'}
      </h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        {hi
          ? 'अपने बच्चे के नामांकन या किसी केंद्र में रुचि के बारे में बताएं — हमारी टीम आपसे संपर्क करेगी। पूर्ण पंजीकरण के लिए तैयार हैं?'
          : 'Tell us about enrolling your child or your interest in a centre, and our team will reach out. Ready for full registration?'}{' '}
        <Link href="/register" className="font-medium text-primary hover:underline">
          {hi ? 'अभी पंजीकरण करें' : 'Register now'}
        </Link>
        .
      </p>

      {submitted ? (
        <Card className="mt-10 max-w-xl p-8">
          <h2 className="font-display text-3xl text-secondary">{hi ? 'धन्यवाद!' : 'Thank you!'}</h2>
          <p className="mt-3 text-muted-foreground">
            {hi
              ? 'आपकी पूछताछ प्राप्त हो गई है। हमारी टीम शीघ्र ही आपसे संपर्क करेगी।'
              : 'Your enquiry has been received. Our team will be in touch shortly.'}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setSubmitted(false);
                setName(''); setPhone(''); setCity(''); setMessage('');
              }}
            >
              {hi ? 'एक और भेजें' : 'Send another'}
            </Button>
            <Button asChild>
              <Link href="/register">{hi ? 'पूर्ण पंजीकरण' : 'Full registration'}</Link>
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="mt-8 max-w-xl p-6 md:p-8">
          <form className="space-y-5" onSubmit={submit}>
            <div className="space-y-1">
              <Label className="text-sm font-medium">
                {hi ? 'पूरा नाम' : 'Full name'} <span className="text-destructive">*</span>
              </Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label className="text-sm font-medium">{hi ? 'फ़ोन नंबर' : 'Phone number'}</Label>
              <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91…" />
            </div>
            <div className="space-y-1">
              <Label className="text-sm font-medium">{hi ? 'शहर' : 'City'}</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-sm font-medium">
                {hi ? 'संदेश' : 'Message'} <span className="text-destructive">*</span>
              </Label>
              <Textarea
                rows={5}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={hi ? 'अपनी पूछताछ के बारे में बताएं…' : 'Tell us about your enquiry…'}
                required
              />
            </div>

            {errorMsg ? <p className="text-sm text-destructive">{errorMsg}</p> : null}

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? (hi ? 'भेजा जा रहा है…' : 'Sending…') : hi ? 'पूछताछ भेजें' : 'Send enquiry'}
            </Button>
          </form>
        </Card>
      )}
    </section>
  );
}
