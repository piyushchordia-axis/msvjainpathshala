/**
 * StatusBadge — maps the application's lifecycle statuses onto the
 * shadcn Badge variant set. Mirrors `jp-design-system/ui_kits/admin/components.jsx`
 * StatusBadge.
 *
 * Adding a status: drop it in the `STATUS_MAP` below. Unknown statuses
 * fall through to the neutral variant so a typo is loud-ish but not
 * crashing.
 */

import { Badge } from '@/components/ui/badge';

type Variant = 'success' | 'warning' | 'error' | 'info' | 'neutral';

const STATUS_MAP: Record<string, { label: string; variant: Variant }> = {
  pending: { label: 'Pending', variant: 'warning' },
  approved: { label: 'Approved', variant: 'success' },
  rejected: { label: 'Rejected', variant: 'error' },
  active: { label: 'Active', variant: 'success' },
  inactive: { label: 'Inactive', variant: 'neutral' },
  waitlisted: { label: 'Waitlisted', variant: 'info' },
  in_review: { label: 'In review', variant: 'info' },
  resolved: { label: 'Resolved', variant: 'success' },
  expired: { label: 'Expired', variant: 'neutral' },
  cancelled: { label: 'Cancelled', variant: 'neutral' },
};

interface StatusBadgeProps {
  status: string;
  /** Override the label (e.g. when the i18n string differs from the key). */
  label?: string;
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const mapped = STATUS_MAP[status.toLowerCase()];
  return <Badge variant={mapped?.variant ?? 'neutral'}>{label ?? mapped?.label ?? status}</Badge>;
}
