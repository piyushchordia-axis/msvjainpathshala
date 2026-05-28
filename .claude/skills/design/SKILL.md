---
name: design
description: Delegate design and frontend generation tasks to a specialised subagent. Use for initial frontend builds, design iterations, component redesigns, and tasks involving image generation or visual polish.
---

# Design Skill

Delegate design-focused work to a Claude Code subagent using the **Agent** tool.

## Two Approaches

### 1. Full Frontend Generation

For building a complete frontend from scratch, delegate to a background agent and keep working on the backend:

```
Agent({
  description: "Generate full React frontend",
  prompt: "Build a complete React + Vite frontend for this app.

Design style: clean minimal with dark mode, professional feel.

Backend context:
- REST API at /api, JWT auth via Authorization header
- Key endpoints: POST /api/auth/login, GET /api/users/me, GET /api/products

Generate:
- All pages (landing, login, dashboard, product list, product detail)
- Shared components (Navbar, Sidebar, Button, Card, Modal)
- API hooks using @tanstack/react-query
- Tailwind CSS with shadcn/ui components
- Proper routing with react-router-dom

Write files to: src/

When done, run: npx tsc --noEmit
Report: list of files created and any type errors found.",
  run_in_background: true
})
```

Keep working on backend while the agent generates the frontend. You'll be notified when it completes.

### 2. Design Iterations

For redesigning specific components or adding visual polish, use a foreground agent:

```
Agent({
  description: "Redesign hero section with gradient + animation",
  prompt: "Redesign the landing page hero section in src/pages/Landing.tsx.

Current state: plain white background, black text, no animation.

Required changes:
- Add a dark gradient background (indigo → purple → black)
- Use Inter font, 64px bold headline
- Add a subtle fade-in animation on load (use framer-motion)
- Generate a hero illustration and save to src/assets/hero.png
  (prompt: 'abstract tech illustration, dark blue tones, minimalist')
- Make it fully responsive (mobile breakpoint at 640px)

Reference the existing color tokens in src/styles/globals.css.
Run: npx tsc --noEmit when done.
Report: exactly what changed and screenshot URL if available."
})
```

## Parallel Design Variants

To generate 3 variants simultaneously — launch all agents in one message:

```
Agent({
  description: "Pricing card variant A — feature-led",
  prompt: "Create src/components/mockups/PricingCardA.tsx.
  Design: feature list leads, price secondary, blue CTA.
  Use Tailwind + shadcn/ui Card. Export as default.",
  run_in_background: true
})

Agent({
  description: "Pricing card variant B — price-led",  
  prompt: "Create src/components/mockups/PricingCardB.tsx.
  Design: large price hero, 'most popular' badge, minimal features.
  Use Tailwind + shadcn/ui Card. Export as default.",
  run_in_background: true
})

Agent({
  description: "Pricing card variant C — social proof",
  prompt: "Create src/components/mockups/PricingCardC.tsx.
  Design: testimonial quote featured, price subtle, trust badges.
  Use Tailwind + shadcn/ui Card. Export as default.",
  run_in_background: true
})
```

All three run in parallel. You'll be notified as each finishes.

## Design Agent Capabilities

A design agent spawned via the Agent tool **can**:
- Read, write, and edit files
- Run Bash commands (npm, tsc, vite build, etc.)
- Generate images via API calls (if you include API key instructions in the prompt)
- Search the web for design references (if you ask it to)
- Install packages via npm/pip

A design agent **cannot**:
- Restart the dev server or check workflow logs (do that yourself)
- Take browser screenshots (use `mcp__Claude_in_Chrome__computer` in the main session)
- See the current UI state (describe what exists in the prompt)

## What to Include in Design Prompts

1. **File paths** — which files to read and where to write output
2. **Design direction** — mood words, not product names ("clean minimal", "bold energetic", not "like Linear")
3. **Technical constraints** — which CSS framework, component library, existing tokens/vars
4. **Verification step** — `npx tsc --noEmit` or `npm run lint`
5. **What to report** — files changed, any errors found

## Design Tokens / Theme Files

Always pass your main CSS/theme file so the agent uses your existing tokens:

```
"Read src/styles/globals.css for the existing color tokens and spacing scale.
 Match these exactly — do not introduce new CSS variables."
```
