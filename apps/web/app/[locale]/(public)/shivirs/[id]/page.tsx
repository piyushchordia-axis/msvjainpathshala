import { PageStub } from '@/components/public/PageStub';

interface ShivirPageProps {
  params: Promise<{ id: string }>;
}

export default async function ShivirPage({ params }: ShivirPageProps) {
  const { id } = await params;
  return (
    <PageStub
      kicker={`Shivir · ${id}`}
      title="Shivir details"
      body="Shivir programme, accommodation, fees, registration form. Lands with the shivirs step."
    />
  );
}
