import { Link } from 'wouter';
import { useLocale } from '@/lib/locale-context';
import { PageStub } from '@/components/public/PageStub';

/**
 * /about and /msv — bilingual info pages (GST-DSN-02).
 * Copy mirrors the mobile app's `app/info/[slug].tsx` CONTENT map so the two
 * surfaces tell the same story. Contact/Donate/Enquire have real pages under
 * pages/public and are routed there, not here.
 */

export function AboutPage() {
  const hi = useLocale() === 'hi';
  return (
    <PageStub
      kicker={hi ? 'हमारे बारे में' : 'About'}
      title={hi ? 'जैन पाठशाला के बारे में' : 'About Jain Pathshala'}
      body={
        hi
          ? 'जैन पाठशाला केंद्र, शिविर, सूचनाएँ, पुस्तकालय और आपके बच्चे का पुण्य एक ही स्थान पर लाती है — ताकि परिवार और गुरुजी पूरे वर्ष जुड़े रहें। हमारे केंद्र प्रतिष्ठाता परिवारों के सहयोग से चलते हैं, संचालक उनका संचालन करते हैं, और गुरुजी व दीदी उसी परंपरा में पढ़ाते हैं जिसमें वे स्वयं पले-बढ़े हैं।'
          : "Jain Pathshala brings centres, shivirs, notices, library and your child's Punya together in one place — so families and Gurujis stay connected throughout the year. Our centres are sustained by Pratishthatha families, run by Sanchalaks, and taught by Gurujis and Didis who have come up through the same tradition they now share."
      }
    >
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/centres"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          {hi ? 'केंद्र देखें' : 'Browse centres'}
        </Link>
        <Link
          href="/enquire"
          className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-secondary hover:border-primary/40"
        >
          {hi ? 'पूछताछ करें' : 'Enquire'}
        </Link>
      </div>
    </PageStub>
  );
}

export function MsvPage() {
  const hi = useLocale() === 'hi';
  return (
    <PageStub
      kicker={hi ? 'मेघ संस्कार वाटिका' : 'Megh Sanskar Vatika'}
      title={hi ? 'मेघ संस्कार वाटिका की कहानी' : 'The Megh Sanskar Vatika story'}
      body={
        hi
          ? 'मेघ संस्कार वाटिका पाठशालाओं का एक नेटवर्क है जो जैन परिवारों की अगली पीढ़ी को हमारे पूर्वजों की कोमल, अनुशासित परंपरा में पालता है। MSV कार्यक्रम विशेष विद्यार्थियों को गहन जैन आध्यात्मिक शिक्षा की ओर ले जाता है — प्रवेश आपके केंद्र के माध्यम से होता है।'
          : 'Megh Sanskar Vatika is a network of Pathshalas nurturing the next generation of Jain families in the gentle, disciplined tradition of our ancestors. The MSV programme guides exceptional students into deeper Jain spiritual study — entry is through your centre.'
      }
    >
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/centres"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          {hi ? 'अपना केंद्र खोजें' : 'Find your centre'}
        </Link>
        <Link
          href="/enquire"
          className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-secondary hover:border-primary/40"
        >
          {hi ? 'पूछताछ करें' : 'Enquire'}
        </Link>
      </div>
    </PageStub>
  );
}
