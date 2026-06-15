import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useLocale } from '@/lib/locale-context';

const STATS = [
  { v: '120+', k: 'Active centres' },
  { v: '14,000+', k: 'Children learning every week' },
  { v: '800+', k: 'Gurujis and Didis teaching' },
];

export default function HomePage() {
  const locale = useLocale();
  const isHindi = locale === 'hi';

  const copy = isHindi
    ? {
        kicker: 'मेघ संस्कार वाटिका नेटवर्क',
        heading: 'जहाँ जैन शिक्षा एक आधुनिक पाठशाला से मिलती है।',
        lede: 'अपने पास का केंद्र खोजें, अपने बच्चे का पुण्य देखें, शिविरों के लिए नाम लिखाएँ, और अपने गुरुजी से जुड़े रहें — सब एक ही जगह।',
        ctaCentres: 'केंद्र खोजें',
        ctaSignin: 'मेरी पाठशाला में लॉगिन करें',
        missionTitle: 'हमारा उद्देश्य',
        missionBody: 'हम जैन परिवारों की अगली पीढ़ी को हमारे पूर्वजों की कोमल, अनुशासित परंपरा में पालने में मदद करते हैं — पाठशाला की पारंपरिक शिक्षा को आज के परिवारों की आवश्यक गर्मजोशी और संरचना के साथ जोड़ते हुए।',
      }
    : {
        kicker: 'Megh Sanskar Vatika network',
        heading: 'Where Jain education meets a modern Pathshala.',
        lede: "Find a centre near you, track your child's Punya, sign up for shivirs, and stay in touch with your Guruji — all in one place.",
        ctaCentres: 'Find a centre',
        ctaSignin: 'Sign in to my Pathshala',
        missionTitle: 'Our mission',
        missionBody: 'We help Jain families raise the next generation in the gentle, disciplined tradition of our ancestors — combining classical Pathshala learning with the warmth and structure modern families need.',
      };

  return (
    <>
      <section
        aria-labelledby="hero-title"
        className="relative isolate overflow-hidden bg-primary text-primary-foreground"
      >
        <div className="absolute inset-y-0 right-0 hidden md:block pointer-events-none">
          <img
            src="/motif-mandala.svg"
            alt=""
            width={520}
            height={520}
            className="h-full w-auto opacity-25"
          />
        </div>
        <div className="container relative grid gap-10 py-20 md:grid-cols-2 md:py-28">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-primary-foreground/70">
              {copy.kicker}
            </p>
            <h1
              id="hero-title"
              className="mt-4 font-display text-4xl leading-tight md:text-5xl text-primary-foreground"
            >
              {copy.heading}
            </h1>
            <p className="mt-5 max-w-xl text-lg text-primary-foreground/90">{copy.lede}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button
                asChild
                size="lg"
                variant="secondary"
                className="bg-white text-secondary hover:bg-white/90"
              >
                <Link href="/centres">{copy.ctaCentres}</Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="ghost"
                className="text-primary-foreground hover:bg-white/10"
              >
                <Link href="/admin/login">{copy.ctaSignin}</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="stats-title" className="container py-16">
        <h2 id="stats-title" className="sr-only">By the numbers</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {STATS.map((s) => (
            <Card key={s.k} className="p-6">
              <div className="font-mono text-3xl text-secondary">{s.v}</div>
              <div className="mt-2 text-sm text-muted-foreground">{s.k}</div>
            </Card>
          ))}
        </div>
      </section>

      <section className="container pb-24">
        <Card className="bg-muted/50 p-8 md:p-12">
          <h2 className="font-display text-2xl text-secondary">{copy.missionTitle}</h2>
          <p className="mt-3 max-w-2xl text-base text-muted-foreground">{copy.missionBody}</p>
        </Card>
      </section>
    </>
  );
}
