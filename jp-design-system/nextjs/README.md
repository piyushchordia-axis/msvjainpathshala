# Next.js + shadcn/ui — Jain Pathshala component pack

13 hi-fi components, ready to drop into a Next.js + Tailwind + shadcn/ui project.

## What's here

```
nextjs/
├── tailwind.config.ts          # tokens registered as `bg-primary`, `bg-status-*`, `bg-age-*`, `bg-tier-*`
├── app/globals.css             # font imports + shadcn CSS variables (HSL)
├── lib/utils.ts                # `cn()` — clsx + tailwind-merge
└── components/jp/
    ├── StatusPill.tsx          # success / warning / error / info / neutral
    ├── KpiCard.tsx             # big stat + delta chip + caption
    ├── StatCard.tsx            # icon + label + value (smaller, horizontal)
    ├── DataGrid.tsx            # generic table on shadcn <Table />, with sort + empty state
    ├── AttendanceToggle.tsx    # present / absent / late radio group
    ├── CalendarHeatmapCell.tsx # single 0–4 intensity cell, 3 color ramps
    ├── PunyaTierBadge.tsx      # Jigyasu → Tirthankar
    ├── StreakBadge.tsx         # flame + day count + live/broken/milestone states
    ├── OfflineBanner.tsx       # soft (amber) / hard (red) connectivity warning
    ├── NotificationItem.tsx    # row in notif list with read state + kind dot
    ├── RoleBadge.tsx           # super / cityAdmin / sanchalak / didi / parent / student
    ├── ConfirmDialog.tsx       # built on shadcn <Dialog />, async-aware
    └── BilingualText.tsx       # primary + secondary script, stacked or inline
```

> The spec listed one of these as `BillingualText`. That's a typo — the file is `BilingualText.tsx`, and it re-exports `BillingualText` as an alias so either import works.

## Prerequisites in your Replit

```bash
npx create-next-app@latest --typescript --tailwind --app
cd your-app
npx shadcn-ui@latest init           # accept the defaults

# add the shadcn primitives the pack imports:
npx shadcn-ui@latest add button card badge dialog input table

# helpers used by these components:
npm i clsx tailwind-merge lucide-react tailwindcss-animate
```

## Wiring

1. **Tokens** — replace your generated `tailwind.config.ts` with `nextjs/tailwind.config.ts`. Keep your own `content` globs if they differ.
2. **CSS variables** — paste the `:root { … }` block from `nextjs/app/globals.css` into your `app/globals.css`, above `@tailwind base;`.
3. **Helper** — copy `nextjs/lib/utils.ts` into `lib/utils.ts` (shadcn will have created this already; this version is identical to the default).
4. **Components** — copy `components/jp/*.tsx` into `components/jp/`.

Imports assume the standard shadcn path alias:

```ts
import { StatusPill } from '@/components/jp/StatusPill';
import { Button } from '@/components/ui/button';
```

## Conventions every component in this pack follows

| Rule | Why |
|---|---|
| **Named export, PascalCase, one per file.** | Matches token name; easy tree-shaking and `@/` imports. |
| **No hardcoded strings.** Every visible label is a prop. | i18n. The component never decides what to say. |
| **`className` prop merged via `cn()`.** | Lets callers override layout without forking the file. |
| **shadcn primitives as the base** (`Card`, `Button`, `Dialog`, `Table`). | Inherits a11y, keyboard nav, theming. |
| **Semantic Tailwind tokens first** (`bg-primary`, `text-status-error`). Brand tokens (`bg-saffron`) only where the spec explicitly calls for a non-semantic identity color (e.g. `KpiCard accent="primary"` is saffron-on-cream by design). | Theme-switching stays cheap. |
| **All sizes go through size props** (`sm` / `md` / `lg`), never magic numbers in callers. | Consistency. |

## Quick usage

```tsx
import { StatusPill }     from '@/components/jp/StatusPill';
import { KpiCard }        from '@/components/jp/KpiCard';
import { DataGrid }       from '@/components/jp/DataGrid';
import { PunyaTierBadge } from '@/components/jp/PunyaTierBadge';
import { useTranslations } from 'next-intl';

export default function Dashboard() {
  const t = useTranslations('dashboard');

  return (
    <div className="grid gap-4 p-6">
      <KpiCard
        label={t('kpi.activeStudents')}
        value="1,248"
        delta={t('kpi.delta', { n: '+8.2%' })}
        caption={t('kpi.vsLastMonth')}
      />

      <DataGrid
        emptyLabel={t('students.empty')}
        sortKey="name"
        sortDirection="asc"
        onSortChange={(k) => /* update query */ null}
        columns={[
          { key: 'name',   header: t('table.name'), sortable: true,
            cell: r => <span className="font-semibold">{r.name}</span> },
          { key: 'tier',   header: t('table.tier'),
            cell: r => <PunyaTierBadge tier={r.tier} label={t(`tier.${r.tier}`)} /> },
          { key: 'status', header: t('table.status'),
            cell: r => <StatusPill variant={r.status} label={t(`status.${r.status}`)} /> },
        ]}
        rows={students}
      />
    </div>
  );
}
```

## What's intentionally NOT in this pack

- **Layout chrome** (Sidebar, Topbar) — too app-specific. Port from `ui_kits/admin/components.jsx` as a starting point.
- **Forms** — use shadcn's `Form` + `react-hook-form` + `zod`; field-level adapters are trivial once the primitives are in.
- **Real icons for Punya / age groups** — placeholders use `lucide-react`. Swap when you have the custom SVG set.
