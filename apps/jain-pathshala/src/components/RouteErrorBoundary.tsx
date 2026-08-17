/**
 * Route-level error boundary (XC-WEB-01).
 *
 * The SPA had none, so any render-time throw blanked the entire panel — a
 * single bad row turned "Edit exam" into a white screen (CTY-ERR-01's
 * amplifier). Mount once per shell; `resetKey` (the current location) clears
 * the error when the user navigates away.
 */
import { Component, type ReactNode } from 'react';

interface Props {
  resetKey: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <section className="container py-16">
          <div className="mx-auto max-w-md rounded-lg border border-border bg-card p-8 text-center">
            <h1 className="font-display text-2xl text-secondary">Something went wrong</h1>
            <p className="mt-3 text-sm text-muted-foreground">
              This page hit an unexpected error — the rest of the app is fine. Reload the page,
              or go back and try again.
            </p>
            <button
              type="button"
              className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              onClick={() => window.location.reload()}
            >
              Reload page
            </button>
          </div>
        </section>
      );
    }
    return this.props.children;
  }
}
