import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { GraduationCap, Users, UserCog, Lock } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/lib/locale-context';
import { apiGet } from '@/lib/api-client';
import type { JoinKind, JoinSettings } from '@/lib/join';
import { JoinLangToggle, usePreferJoinHindi } from './JoinLangToggle';

const PATHS: Array<{
  kind: JoinKind;
  href: string;
  icon: typeof GraduationCap;
  title_en: string;
  title_hi: string;
  sub_en: string;
  sub_hi: string;
}> = [
  {
    kind: 'student',
    href: '/join/student',
    icon: GraduationCap,
    title_en: 'Student',
    title_hi: 'विद्यार्थी',
    sub_en: 'Join the MSV student journey',
    sub_hi: 'MSV विद्यार्थी यात्रा में जुड़ें',
  },
  {
    kind: 'shikshak',
    href: '/join/shikshak',
    icon: Users,
    title_en: 'Shikshak Gan',
    title_hi: 'शिक्षक गण',
    sub_en: 'For Guruji and Didi seva',
    sub_hi: 'गुरुजी और दीदी की सेवा के लिए',
  },
  {
    kind: 'sanchalak',
    href: '/join/sanchalak',
    icon: UserCog,
    title_en: 'Sanchalak Gan',
    title_hi: 'संचालक गण',
    sub_en: 'For Pathshala Sanchalaks',
    sub_hi: 'पाठशाला संचालकों के लिए',
  },
];

export default function JoinLandingPage() {
  usePreferJoinHindi();
  const hi = useLocale() === 'hi';
  const [openMap, setOpenMap] = useState<Record<JoinKind, boolean>>({
    student: true,
    shikshak: true,
    sanchalak: true,
  });

  useEffect(() => {
    void Promise.all(
      PATHS.map(async (p) => {
        try {
          const s = await apiGet<JoinSettings>(`/v1/join/settings?kind=${p.kind}`);
          return [p.kind, s.registration_open] as const;
        } catch {
          return [p.kind, false] as const;
        }
      }),
    ).then((rows) => {
      setOpenMap(Object.fromEntries(rows) as Record<JoinKind, boolean>);
    });
  }, []);

  return (
    <div className="bg-background">
      <section className="bg-primary text-primary-foreground">
        <div className="container py-16 md:py-24">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-[0.18em] text-primary-foreground/70">
                {hi ? 'शुभ स्वागतम्' : 'Welcome'}
              </p>
              <h1 className="mt-3 font-display text-4xl md:text-5xl">
                {hi ? 'मेघ संस्कार वाटिका' : 'Megh Sanskar Vatika'}
              </h1>
              <p className="mt-4 max-w-2xl text-lg text-primary-foreground/90">
                {hi
                  ? 'अपना मार्ग चुनें और पाठशाला परिवार से जुड़ें।'
                  : 'Choose your path and join the Pathshala family.'}
              </p>
            </div>
            <JoinLangToggle />
          </div>
        </div>
      </section>

      <section className="container py-12 md:py-16">
        <h2 className="font-display text-2xl text-secondary">
          {hi ? 'अपना मार्ग चुनें' : 'Choose your path'}
        </h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {PATHS.map((p) => {
            const open = openMap[p.kind];
            const Icon = p.icon;
            const body = (
              <Card
                className={`h-full p-6 transition ${open ? 'hover:border-primary' : 'opacity-70'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <Icon className="h-8 w-8 text-primary" />
                  <span
                    className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                      open ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {open ? (hi ? 'खुला' : 'Open') : (hi ? 'बंद' : 'Closed')}
                  </span>
                </div>
                <div className="mt-4 font-display text-xl text-secondary">
                  {hi ? p.title_hi : p.title_en}
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {hi ? p.sub_hi : p.sub_en}
                </p>
                {!open && (
                  <p className="mt-4 flex items-center gap-1 text-xs text-muted-foreground">
                    <Lock className="h-3 w-3" />
                    {hi ? 'पंजीकरण बंद है' : 'Registration is closed'}
                  </p>
                )}
              </Card>
            );
            return open ? (
              <Link key={p.kind} href={p.href}>
                {body}
              </Link>
            ) : (
              <div key={p.kind}>{body}</div>
            );
          })}
        </div>
        <div className="mt-10">
          <Button asChild variant="outline">
            <Link href="/">{hi ? 'मुखपृष्ठ पर लौटें' : 'Back to home'}</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
