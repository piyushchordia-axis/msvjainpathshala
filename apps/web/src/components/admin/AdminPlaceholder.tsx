/**
 * Shared placeholder card for admin pages whose authoring flows still
 * ship through the mobile app (or are in the next iteration). Keeps
 * the layout consistent with populated pages.
 */

import { Card } from '@/components/ui/card';

interface PlaceholderProps {
  title: string;
  subtitle: string;
  body: string;
}

export function AdminPlaceholder({ title, subtitle, body }: PlaceholderProps) {
  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-secondary">{title}</h2>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </header>

      <Card className="p-6 text-sm text-muted-foreground">{body}</Card>
    </div>
  );
}
