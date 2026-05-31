/**
 * Admin → Competition results entry (`/admin/competitions/:id/results`).
 *
 * One row per registered student with a position dropdown (none / 1 / 2 / 3 /
 * other). Save is two-step:
 *   1. "Save ranks" → POST /api/admin/competitions/results (no Punya yet)
 *   2. "Publish results" → POST /api/admin/competitions/publish (Punya + push)
 *
 * Server-side fetched data + small client component for the form.
 */

import { notFound } from 'next/navigation';

import {
  listAdminCompetitions,
  listAdminRegistrations,
  type CompetitionRow,
  type RegistrationWithStudent,
} from '@/api/competitions';
import { Card } from '@/components/ui/card';

import ResultsForm from './results-form';

export default async function CompetitionResultsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let competition: CompetitionRow | null = null;
  let registrations: RegistrationWithStudent[] = [];
  let error: string | null = null;
  try {
    const [all, regs] = await Promise.all([listAdminCompetitions(), listAdminRegistrations(id)]);
    competition = all.items.find((c) => c.id === id) ?? null;
    registrations = regs.items;
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not load competition.';
  }
  if (!competition) return notFound();

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-secondary">{competition.name_en}</h2>
        <p className="text-sm text-muted-foreground">{competition.name_hi}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          Status: <strong>{competition.status}</strong>
        </p>
      </header>
      {error ? (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </Card>
      ) : null}
      {registrations.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">No students are registered yet.</Card>
      ) : (
        <ResultsForm
          competitionId={competition.id}
          status={competition.status}
          rows={registrations}
        />
      )}
    </div>
  );
}
