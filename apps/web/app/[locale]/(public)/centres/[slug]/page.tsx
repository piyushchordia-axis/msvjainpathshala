import { PageStub } from '@/components/public/PageStub';

interface CentrePageProps {
  params: Promise<{ slug: string }>;
}

export default async function CentrePage({ params }: CentrePageProps) {
  const { slug } = await params;
  return (
    <PageStub
      kicker={`Centre · ${slug}`}
      title="Centre profile"
      body="Centre profile, current batches, sanchalak, gallery. Lands with the centres directory step."
    />
  );
}
