/**
 * PageStub — uniform "this page lands in a later step" container so
 * every public route renders cleanly while we wait for content.
 *
 * Voice: warm and direct (DESIGN_GUIDE.md). Never apologetic.
 */

import type { ReactNode } from 'react';

interface PageStubProps {
  title: string;
  kicker?: string;
  body?: ReactNode;
  children?: ReactNode;
}

export function PageStub({ title, kicker, body, children }: PageStubProps) {
  return (
    <section className="container py-16 md:py-24">
      <div className="max-w-3xl">
        {kicker ? (
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-primary">{kicker}</p>
        ) : null}
        <h1 className="mt-3 font-display text-4xl text-secondary md:text-5xl">{title}</h1>
        {body ? <p className="mt-5 text-lg text-muted-foreground">{body}</p> : null}
        {children}
      </div>
    </section>
  );
}
