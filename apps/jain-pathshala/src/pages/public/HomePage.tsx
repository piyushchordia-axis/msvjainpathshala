import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/lib/locale-context';

/**
 * Public home — brand-first first viewport, calm sections below.
 * One primary CTA (Join); Sign in and Find a centre as secondary text links.
 */
export default function HomePage() {
  const locale = useLocale();
  const isHindi = locale === 'hi';

  const copy = isHindi
    ? {
        brand: 'Jain Pathshala',
        kicker: 'मेघ संस्कार वाटिका',
        lede: 'जैन शिक्षा और आधुनिक पाठशाला — एक ही जगह।',
        ctaJoin: 'पाठशाला से जुड़ें',
        ctaSignin: 'पहले से सदस्य हैं? लॉगिन करें',
        ctaCentres: 'पास का केंद्र खोजें',
        highlightsTitle: 'आपके परिवार के लिए',
        highlights: [
          { t: 'पास के केंद्र', d: 'अपने शहर और आस-पास के पाठशाला केंद्र खोजें।' },
          { t: 'साप्ताहिक शिक्षा', d: 'बच्चे नियमित रूप से गुरुजी और दीदी से सीखते हैं।' },
          { t: 'समर्पित शिक्षक', d: 'गुरुजी और दीदी इसी परंपरा में पले-बढ़े हैं।' },
        ],
        missionTitle: 'हमारा उद्देश्य',
        missionBody:
          'हम जैन परिवारों की अगली पीढ़ी को हमारे पूर्वजों की कोमल, अनुशासित परंपरा में पालने में मदद करते हैं — पाठशाला की शिक्षा को आज के परिवारों की आवश्यक गर्मजोशी के साथ जोड़ते हुए।',
        nextTitle: 'शुरू करें',
        nextBody: 'अपने पास का केंद्र देखें, या जुड़ने का मार्ग चुनें।',
        nextCta: 'केंद्र खोजें',
      }
    : {
        brand: 'Jain Pathshala',
        kicker: 'Megh Sanskar Vatika',
        lede: 'Jain education and a modern Pathshala — in one place.',
        ctaJoin: 'Join Pathshala',
        ctaSignin: 'Already a member? Sign in',
        ctaCentres: 'Find a centre near you',
        highlightsTitle: 'For your family',
        highlights: [
          { t: 'Centres near you', d: 'Find Pathshala centres in your city and nearby.' },
          { t: 'Weekly learning', d: 'Children learn regularly with a Guruji or Didi.' },
          { t: 'Dedicated teachers', d: 'Gurujis and Didis raised in the same tradition.' },
        ],
        missionTitle: 'Our mission',
        missionBody:
          'We help Jain families raise the next generation in the gentle, disciplined tradition of our ancestors — classical Pathshala learning with the warmth modern families need.',
        nextTitle: 'Get started',
        nextBody: 'See a centre near you, or choose how to join.',
        nextCta: 'Find a centre',
      };

  return (
    <>
      {/* Brand-first hero — cream atmosphere, no cards, one primary CTA */}
      <section
        aria-labelledby="hero-brand"
        className="relative isolate overflow-hidden border-b border-border bg-background"
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage: `url(${import.meta.env.BASE_URL}motif-mandala.svg)`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: '120% 40%',
            backgroundSize: 'min(70vw, 42rem)',
          }}
          aria-hidden
        />
        <div className="container relative flex min-h-[70vh] flex-col justify-center py-16 md:min-h-[78vh] md:py-24">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-primary">
            {copy.kicker}
          </p>
          <h1
            id="hero-brand"
            className="mt-4 max-w-3xl font-display text-5xl leading-[1.15] text-secondary md:text-6xl lg:text-7xl"
          >
            {copy.brand}
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted-foreground md:text-xl">{copy.lede}</p>
          <div className="mt-10 flex max-w-md flex-col gap-4 sm:max-w-none sm:flex-row sm:flex-wrap sm:items-center">
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link href="/join">{copy.ctaJoin}</Link>
            </Button>
            <Link
              href="/login"
              className="text-center text-base font-medium text-secondary underline-offset-4 hover:underline sm:text-left"
            >
              {copy.ctaSignin}
            </Link>
          </div>
          <Link
            href="/centres"
            className="mt-4 inline-flex text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {copy.ctaCentres}
          </Link>
        </div>
      </section>

      {/* Quiet highlights — no bordered cards */}
      <section aria-labelledby="highlights-title" className="bg-background py-16 md:py-20">
        <div className="container">
          <h2
            id="highlights-title"
            className="font-display text-2xl text-secondary md:text-3xl"
          >
            {copy.highlightsTitle}
          </h2>
          <ul className="mt-10 grid gap-10 md:grid-cols-3 md:gap-12">
            {copy.highlights.map((h) => (
              <li key={h.t} className="border-t border-border pt-6">
                <div className="font-display text-lg text-secondary">{h.t}</div>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{h.d}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Mission — plain cream section */}
      <section aria-labelledby="mission-title" className="border-y border-border bg-muted/40 py-16 md:py-20">
        <div className="container max-w-3xl">
          <h2 id="mission-title" className="font-display text-2xl text-secondary md:text-3xl">
            {copy.missionTitle}
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground md:text-lg">
            {copy.missionBody}
          </p>
        </div>
      </section>

      {/* Single next-step band */}
      <section aria-labelledby="next-title" className="bg-background py-16 md:py-20">
        <div className="container flex flex-col items-start gap-6 md:flex-row md:items-end md:justify-between">
          <div className="max-w-xl">
            <h2 id="next-title" className="font-display text-2xl text-secondary">
              {copy.nextTitle}
            </h2>
            <p className="mt-2 text-muted-foreground">{copy.nextBody}</p>
          </div>
          <Button asChild size="lg" variant="secondary">
            <Link href="/centres">{copy.nextCta}</Link>
          </Button>
        </div>
      </section>
    </>
  );
}
