import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useLocale } from '@/lib/locale-context';
import { messageForCode } from '@/lib/api-error-copy';

export default function ContactPage() {
  const locale = useLocale();
  const hi = locale === 'hi';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
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
          kind: 'contact',
          name: name.trim(),
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          message: message.trim(),
        }),
      });
      if (res.ok) {
        setSubmitted(true);
        return;
      }
      const json = (await res.json().catch(() => null)) as
        | { error?: { code?: string; message?: string } }
        | null;
      // Bilingual copy keyed off error.code (GST-API-05).
      setErrorMsg(messageForCode(json?.error?.code, hi, json?.error?.message));
    } catch {
      setErrorMsg(hi ? 'नेटवर्क त्रुटि। पुनः प्रयास करें।' : 'Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="container py-12 md:py-16">
      <p className="text-sm font-medium uppercase tracking-[0.18em] text-primary">
        {hi ? 'संपर्क करें' : 'Contact'}
      </p>
      <h1 className="mt-3 font-display text-4xl text-secondary md:text-5xl">
        {hi ? 'MSV टीम से बात करें' : 'Talk to the MSV team'}
      </h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        {hi
          ? 'कोई प्रश्न या सुझाव है? नीचे दिए गए फ़ॉर्म के माध्यम से हमें संदेश भेजें, हमारी टीम शीघ्र ही उत्तर देगी।'
          : 'Have a question or feedback? Send us a message below and our team will get back to you soon.'}
      </p>

      {submitted ? (
        <Card className="mt-10 max-w-xl p-8">
          <h2 className="font-display text-3xl text-secondary">{hi ? 'धन्यवाद!' : 'Thank you!'}</h2>
          <p className="mt-3 text-muted-foreground">
            {hi
              ? 'आपका संदेश प्राप्त हो गया है। हमारी टीम शीघ्र ही आपसे संपर्क करेगी।'
              : 'Your message has been received. Our team will be in touch shortly.'}
          </p>
          <Button
            className="mt-6"
            variant="outline"
            onClick={() => {
              setSubmitted(false);
              setName(''); setEmail(''); setPhone(''); setMessage('');
            }}
          >
            {hi ? 'एक और संदेश भेजें' : 'Send another message'}
          </Button>
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
              <Label className="text-sm font-medium">{hi ? 'ईमेल' : 'Email'}</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            <div className="space-y-1">
              <Label className="text-sm font-medium">{hi ? 'फ़ोन नंबर' : 'Phone number'}</Label>
              <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91…" />
            </div>
            <div className="space-y-1">
              <Label className="text-sm font-medium">
                {hi ? 'संदेश' : 'Message'} <span className="text-destructive">*</span>
              </Label>
              <Textarea rows={5} value={message} onChange={(e) => setMessage(e.target.value)} required />
            </div>

            {errorMsg ? <p className="text-sm text-destructive">{errorMsg}</p> : null}

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? (hi ? 'भेजा जा रहा है…' : 'Sending…') : hi ? 'संदेश भेजें' : 'Send message'}
            </Button>
          </form>
        </Card>
      )}
    </section>
  );
}
