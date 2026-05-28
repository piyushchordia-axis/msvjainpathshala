---
name: mockup-sandbox
description: "Use when the user wants to create, preview, or iterate on web UI components in isolation. Activate for: designing or prototyping components, comparing design variants, showing responsive previews, previewing component states, comparing dark vs light mode, or any request that involves building and previewing rendered web content. Sets up a Vite dev server with isolated component preview URLs. Read the entire skill carefully — it contains critical path conventions, image handling rules, and subagent delegation patterns. For two specific workflows, also activate the companion skill: use mockup-extract when the user wants to pull an existing component from the main app for iteration, and mockup-graduate when the user approves a mockup and wants it integrated into the main app."
---
# Mockup Sandbox Skill

The **`artifacts/mockup-sandbox/`** folder is an isolated frontend sandbox for rapid UI prototyping. Components are rendered in isolation via a Vite dev server, and each component gets a `/preview/ComponentName` route accessible in the browser at `http://localhost:5173`.

## When to Use

Activate this skill when the user wants to:

- Prototype or mockup a design ("design a landing page", "mockup a dashboard")
- Compare design variants side-by-side ("show me 3 options for the hero section")
- Preview responsive behavior ("how does this look on mobile?", "show me mobile and desktop")
- Preview component states ("show me loading, error, and empty states")
- Compare themes ("dark mode vs light mode", "what about a warmer color scheme?")
- Show a multi-page flow, **only when the user explicitly requests multiple pages**
- Iterate on an existing component's design (also activates mockup-extract)

## Extract First, Then Iterate

**When the user wants to redesign, improve, or create variants of something that already exists in their app, always start by extracting the real component code** using the `mockup-extract` skill. Never rebuild an existing component from scratch by hand-coding approximations — you will get dimensions, colors, spacing, icon sizes, opacity values, and other details wrong. The real source code has the exact values; use them.

The correct workflow for redesigning existing UI:

1. **Extract** the real component into the mockup sandbox (preserves exact values)
2. **Label it "Current"** as the baseline
3. **Duplicate and modify** to create design variants

This applies whenever the component being redesigned already exists as code in the main app — even if the user doesn't explicitly say "extract".

## Gathering Requirements

If the user's request is vague (e.g., "make some variants", "create a mockup"), ask them to clarify **what specific component or page** they want to prototype. Examples: "a pricing card", "a login form", "a dashboard header", "a product listing".

## How It Works

1. A Vite dev server runs in `artifacts/mockup-sandbox/` on port 5173
2. A custom Vite plugin (`mockupPreviewPlugin`) uses `fast-glob` and file watching to discover components in `artifacts/mockup-sandbox/src/components/mockups/`
3. The plugin writes a generated component registry at `src/.generated/mockup-components.ts`
4. Each component is served at `http://localhost:5173/preview/{folder}/{ComponentName}` as a standalone page
5. Components use Tailwind and shadcn/ui — changes hot-reload instantly

## Setup

### Step 1: Start the dev server

Check if the dev server is already running:

```bash
lsof -i :5173 | grep LISTEN && echo "Already running" || echo "Not running"
```

If not running, start it:

```bash
cd artifacts/mockup-sandbox && npm install && npm run dev &
```

Wait a few seconds for Vite to start, then verify:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173
```

### Step 2: Create mockup components

**Verify the component directory first.** Before creating any files, confirm `artifacts/mockup-sandbox/src/components/mockups/` exists:

```bash
ls artifacts/mockup-sandbox/src/components/mockups/
```

Create components there:

```tsx
// artifacts/mockup-sandbox/src/components/mockups/pricing-cards/Minimal.tsx
export function Minimal() {
  return (
    <div className="min-h-screen bg-background p-8">
      <h1 className="text-2xl font-bold text-foreground">Basic Plan - $9/mo</h1>
    </div>
  );
}
```

### Step 3: Preview in browser

Preview URLs follow the pattern `http://localhost:5173/preview/{folder}/{ComponentName}`.

Open a preview:

```
mcp__Claude_in_Chrome__navigate({ url: "http://localhost:5173/preview/pricing-cards/Minimal" })
```

Take a screenshot to show the user:

```
mcp__Claude_in_Chrome__computer({ action: "screenshot" })
```

**Comparing variants:** Open multiple browser tabs — one per variant — to compare side by side. Or take a screenshot of each and show them in sequence.

**After creating components**, always tell the user the preview URL(s) so they can open them directly in their browser.

## Architecture

```text
artifacts/mockup-sandbox/                              # Isolated from main app
├── package.json                      # Dependencies (React, Tailwind, shadcn/ui)
├── vite.config.ts                    # Vite config
├── mockupPreviewPlugin.ts            # Vite plugin for component discovery
├── tsconfig.json                     # TypeScript config
├── components.json                   # shadcn/ui config
├── index.html
└── src/
    ├── main.tsx                      # Entry point
    ├── App.tsx                       # Landing page listing all previews
    ├── index.css                     # Tailwind v4 styles
    ├── .generated/
    │   └── mockup-components.ts      # Auto-generated component registry
    ├── components/
    │   ├── ui/                       # 50+ shadcn/ui components (pre-installed)
    │   └── mockups/                  # YOUR MOCKUP COMPONENTS GO HERE
    ├── lib/
    │   └── utils.ts
    └── hooks/
```

## Folder Structure

The folder structure in `mockups/` automatically organizes components:

```text
components/mockups/
├── pricing-cards/           # Single-component variants
│   ├── _group.css           # Group-level tokens + fonts (optional)
│   ├── Minimal.tsx          # imports './_group.css'
│   ├── Bold.tsx             # imports './_group.css'
│   └── Gradient.tsx         # imports './_group.css'
├── crm-dashboard/           # Multi-page project (only when user explicitly requests multiple pages)
│   ├── _shared/             # Shared layout (not preview targets)
│   │   ├── AppLayout.tsx
│   │   ├── Navbar.tsx
│   │   └── Sidebar.tsx
│   ├── _group.css
│   ├── Dashboard.tsx
│   ├── UserList.tsx
│   └── Settings.tsx
├── login-forms/
│   ├── Simple.tsx
│   └── Dark.tsx
└── QuickIdea.tsx            # Ungrouped (loose files)
```

Files prefixed with `_` are not preview targets by convention. `_shared/` holds helper components imported by sibling page files. `_group.css` holds group-level CSS overrides — tokens, font `@import`s, `@font-face` blocks — that every component in the group explicitly imports (see [Fonts](#fonts)).

## Working with Assets

### Icons

`lucide-react` is pre-installed with 1000+ icons:

```tsx
import { ShoppingCart, Star, ArrowRight } from "lucide-react";

<ShoppingCart className="w-6 h-6 text-gray-600" />
```

### Images

Two approaches — **do not mix them**:

#### Option 1: Public folder (URL reference)

Place images in `artifacts/mockup-sandbox/public/images/` and reference by URL path:

```tsx
<img src="/images/hero.png" alt="Hero" />
```

#### Option 2: Import via `@/assets/` (bundled by Vite)

Place images in `artifacts/mockup-sandbox/src/assets/` and import them:

```tsx
import heroImg from "@/assets/hero.png";

<img src={heroImg} alt="Hero" />
```

The `@` alias maps to `artifacts/mockup-sandbox/src/`, so `@/assets/hero.png` resolves to `artifacts/mockup-sandbox/src/assets/hero.png`.

**Important — pick one approach per image and do not cross them:**

- Files in `src/assets/` **must** be imported. Referencing them by URL path will 404.
- Files in `public/images/` are served as-is at `/images/…`. Do not import them.

For mockups, **prefer Option 1 (public folder)** — it is simpler.

To generate images for mockups, use the `media-generation` skill and save to:
```
artifacts/mockup-sandbox/public/images/filename.png
```

Then reference: `<img src="/images/filename.png" />`.

**Path warning:** The `outputPath` must start with `artifacts/mockup-sandbox/public/` — NOT just `public/`. Using `public/images/hero.png` (without the prefix) writes to the main app's public folder, not the sandbox.

### Fonts

**Bundled fonts.** `index.html` preloads 25+ Google Font families. Use them directly in any component:

```tsx
<h1 className="font-['Playfair_Display']">Heading</h1>
```

**Custom fonts.** For fonts outside the bundled set, add a non-blocking `<link>` tag to `artifacts/mockup-sandbox/index.html`:

```html
<link rel="stylesheet" media="print" onload="this.media='all'"
      href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;600&display=swap">
```

Or use `@import` in a `_group.css` scoped to just that component group.

Missing fonts fail silently — no console error, just a fallback font. Verify typography visually.

## Adding Packages

To add packages to the mockup sandbox:

1. Edit `artifacts/mockup-sandbox/package.json` directly and add the dependency
2. Run `npm install` from the `artifacts/mockup-sandbox/` directory
3. Restart the dev server to pick up the change

```bash
cd artifacts/mockup-sandbox && npm install <package-name>
# Then restart: kill the dev server process and re-run npm run dev
```

## shadcn/ui Components

All shadcn/ui components are pre-installed and ready to use:

```tsx
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
```

**Available components:** accordion, alert, alert-dialog, aspect-ratio, avatar, badge, breadcrumb, button, calendar, card, carousel, chart, checkbox, collapsible, command, context-menu, dialog, drawer, dropdown-menu, empty, form, hover-card, input, input-otp, label, menubar, navigation-menu, pagination, popover, progress, radio-group, resizable, scroll-area, select, separator, sheet, skeleton, slider, switch, table, tabs, textarea, toast, toggle, tooltip

## Component Best Practices

- **One preview entry point per file** — each file exports one top-level component that the preview route resolves. Define as many local helper components inside the file as needed.
- **Use design tokens for the baseline** — When recreating the app's existing look, use semantic color classes like `bg-background`, `text-foreground`, `text-muted-foreground`. When creating design variations, use whatever colors express the variant's direction — hardcoded colors like `bg-indigo-950` are expected.
- **Use realistic data** — show how the component looks with real content, not lorem ipsum.
- **Name clearly** — use descriptive names that communicate the variant's design hypothesis (e.g., `ComparisonTable.tsx`, `ProgressiveDisclosure.tsx`, `FeatureLed.tsx`).
- **Include states** — create separate mockup files for loading, empty, and error states.

## Design Variation Guidelines

When the user asks for variations, read the `design-exploration` skill first. It provides a structured comprehension → brief → delegation workflow that produces meaningfully diverse output instead of superficial reskins.

### Step 1: Analyze the component

Read the source code and determine:

- **Purpose:** What user need does this component serve?
- **Constraints:** What must stay fixed? (data shape, required actions, accessibility, brand)
- **Degrees of freedom:** What could meaningfully change without breaking the component's purpose?

### Step 2: Select variation axes

Choose 2-3 axes that give the user the most insight into their solution space:

1. **Structural:** Different layouts, information hierarchies
2. **Content strategy:** What's foregrounded vs. backgrounded
3. **Interaction model:** Different interaction patterns
4. **Conceptual:** The underlying metaphor or mental model
5. **Visual treatment:** Typography, color, spacing, mood

### Step 3: Generate variations as distinct design hypotheses

Each variation should represent a meaningfully different answer to "how should this component work?"

## Subagent Orchestration

For design variation tasks (2+ alternatives of the same component or page), use the Claude Code **Agent** tool to parallelize work. Launch all agents in a single message with `run_in_background: true`.

### When to use subagents

Use subagents when the task involves **2+ design variants** of the same component or page. Also use a single subagent for any single-page app or full-page mockup (landing pages, homepages, portfolios). For a single small component (card, button, form) or a modification to an existing mockup, do the work directly.

**Do not create multiple pages unless the user explicitly asks.** When the user says "design a dashboard" or "build a CRM", build it as a single page. Only fan out into multiple pages when the user specifically requests separate pages.

**Single-page apps are single components.** A landing page is one scrollable page rendered in one component file.

### Pattern: Direct (no subagent)

For single small components or modifications:

```
1. Create the component file
2. Tell the user the preview URL: http://localhost:5173/preview/{folder}/{Name}
3. Take a screenshot to show the result
```

### Pattern A: Design variants (parallel subagents)

Use when the user wants multiple visual options for the same component:

```
Agent({
  description: "Pricing card — Minimal variant",
  prompt: "Create artifacts/mockup-sandbox/src/components/mockups/pricing-cards/Minimal.tsx\n\n[full design brief from design-exploration]\n\nThis Variant: Minimal — clean whitespace, price secondary, feature-led.\nExported function name must match filename: export function Minimal().\nUse Tailwind + shadcn/ui.\nRun npx tsc --noEmit when done.\nReport: file created and type errors.",
  run_in_background: true
})

Agent({
  description: "Pricing card — Bold variant",
  prompt: "Create artifacts/mockup-sandbox/src/components/mockups/pricing-cards/Bold.tsx\n\n[same design brief]\n\nThis Variant: Bold — price dominant, strong color blocking, urgency.\nexport function Bold()\nUse Tailwind + shadcn/ui.\nRun npx tsc --noEmit when done.",
  run_in_background: true
})

Agent({
  description: "Pricing card — Social variant",
  prompt: "Create artifacts/mockup-sandbox/src/components/mockups/pricing-cards/Social.tsx\n\n[same design brief]\n\nThis Variant: Social proof led — testimonial quote featured, trust badges.\nexport function Social()\nUse Tailwind + shadcn/ui.\nRun npx tsc --noEmit when done.",
  run_in_background: true
})
```

After all agents complete, open previews in browser:

```
mcp__Claude_in_Chrome__navigate({ url: "http://localhost:5173/preview/pricing-cards/Minimal" })
mcp__Claude_in_Chrome__computer({ action: "screenshot" })
# Repeat for each variant
```

Tell the user: "Here are your 3 pricing card variants — preview them at:
- `http://localhost:5173/preview/pricing-cards/Minimal`
- `http://localhost:5173/preview/pricing-cards/Bold`
- `http://localhost:5173/preview/pricing-cards/Social`"

### Pattern B: Multi-page apps (only when user explicitly requests multiple pages)

Build shared layout first, then fan out pages in parallel:

```
# Parent builds _shared/ components directly, then:

Agent({
  description: "CRM Dashboard page",
  prompt: "Create artifacts/mockup-sandbox/src/components/mockups/crm-dashboard/Dashboard.tsx\nImport shared layout from './_shared/AppLayout'\nWrap content in <AppLayout>.\nexport function Dashboard()\nUse Tailwind + shadcn/ui.\nReport URL: http://localhost:5173/preview/crm-dashboard/Dashboard",
  run_in_background: true
})

Agent({
  description: "CRM UserList page",
  prompt: "Create artifacts/mockup-sandbox/src/components/mockups/crm-dashboard/UserList.tsx\n...",
  run_in_background: true
})
```

### Subagent task format

Always give subagents:
- Target file path and exported function name
- The full design brief
- The specific design hypothesis for this variant
- The preview URL to report when done
- Functional requirements (what the page must contain, not how it should look)
- A brief mood/direction seed (1-2 words: "minimal", "bold and dark", "warm editorial")

Do NOT pass specific color values, font choices, spacing values, detailed layout instructions, or CSS class names. Let the subagent apply its own design sensibility — constraining it to exact specs produces generic results.

### General orchestration rules

1. **Verify paths before delegating.** List `artifacts/mockup-sandbox/` to confirm `src/components/mockups/` exists before passing paths to subagents.

2. **Tell subagents the image path convention.** Always include: "Place images in `artifacts/mockup-sandbox/public/images/` and reference as `<img src='/images/filename.jpg' />`. Do NOT put images in `src/assets/` and reference by URL path — they will 404."

3. **Give subagents creative freedom.** Pass functional requirements, not layout prescriptions. The subagent produces better designs when given high-level direction, not line-by-line specs.

4. **For extract and graduate workflows, use GENERAL subagents** if parallelization is needed. These are engineering tasks requiring codebase navigation, not creative visual output.

| Scenario | Subagents? | Pattern |
| --- | --- | --- |
| "Design a pricing card" | No | Direct |
| "Design a landing page" | Yes (1) | Single background agent |
| "Make the header bigger" | No | In-place modification |
| "Redesign my navbar with 2 options" | Yes | Parallel variants (Pattern A) |
| "Show me 3 options for the hero" | Yes | Parallel variants (Pattern A) |
| "Design a CRM with dashboard/users/settings" | Yes | Multi-page (Pattern B) |
| "Extract / graduate component" | If parallelizing | GENERAL agent |

## Related Skills

- **`mockup-extract`** — Pull an existing component from the main app into the sandbox for redesign.
- **`mockup-graduate`** — Move an approved mockup into the main app.
- **`design-exploration`** — Structured design brief methodology for meaningful variation.

## Viewport Sizing Guide

Size screenshots and browser windows to fit the content. Use `mcp__Claude_in_Chrome__resize_window` before screenshotting:

### Viewport presets

- **Mobile:** 390 × 844 (iPhone viewport)
- **Tablet:** 768 × 1024
- **Desktop:** 1280 × 800

### Responsive comparison

To show the same component at different screen sizes, screenshot at each viewport width:

```
mcp__Claude_in_Chrome__resize_window({ width: 390, height: 844 })
mcp__Claude_in_Chrome__computer({ action: "screenshot" })  # mobile

mcp__Claude_in_Chrome__resize_window({ width: 1280, height: 800 })
mcp__Claude_in_Chrome__computer({ action: "screenshot" })  # desktop
```

### Full-page mockups

For landing pages, use a desktop-sized viewport (1280 × 800) and scroll within the browser to review the full page.

## Common Pitfalls

### Keep mockups self-contained

Each mockup component must be fully self-contained. Prefer inlining small sub-components directly in the mockup file. Exception: multi-page `_shared/` imports are intentional.

### Sync design tokens with the main app

When extracting existing components, create `_group.css` in the extraction's group folder with the main app's `:root` and `.dark` CSS variable blocks plus any font `@import`s. Do not edit the global `artifacts/mockup-sandbox/src/index.css` — that would leak one app's tokens into every other mockup group.

### Fixing broken previews

If a mockup shows a blank page or fails to render:

1. Check for TypeScript errors: `cd artifacts/mockup-sandbox && npx tsc --noEmit`
2. Check the Vite dev server console for `Failed to resolve import` errors.
3. Verify the missing file exists under `artifacts/mockup-sandbox/src/` (not the main app).
4. Ensure the file exports at least one function component (named or default).
5. Restart the dev server if you changed `vite.config.ts` or `package.json`.
