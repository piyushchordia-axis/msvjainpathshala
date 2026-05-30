/**
 * Admin → New exam (city_admin+). Renders the dynamic question-builder form.
 */

import { CreateExamForm } from './create-exam-form';

export default function NewExamPage() {
  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-secondary">New exam</h2>
        <p className="text-sm text-muted-foreground">
          Build an online exam. Generate the class OTP and release results from the exam&apos;s
          page.
        </p>
      </header>
      <CreateExamForm />
    </div>
  );
}
