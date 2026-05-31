---
name: canvas
description: Infinite canvas for visual collaboration, diagrams, and sticky notes. Use Excalidraw for diagrams, Storybook for component previews, or the browser for live app previews.
---

# Canvas

An infinite canvas is not built into Claude Code. Use these alternatives depending on your goal:

| Goal | Tool |
|------|------|
| Live component previews | Run mockup-sandbox dev server, open `http://localhost:5173/preview/ComponentName` in browser |
| Side-by-side design variants | Open multiple browser tabs or use split-screen |
| Diagrams, flowcharts, sticky notes | [Excalidraw](https://excalidraw.com) (free, no install) or [tldraw.com](https://tldraw.com) |
| Wireframes / mockups | Figma Community (free tier) |
| Live app preview | Open `http://localhost:3000` in browser |
| Screenshots of components | `mcp__Claude_in_Chrome__computer` with `action: "screenshot"` |

## Mockup Workflow

For prototyping and comparing UI components locally:

1. **Create components** in `artifacts/mockup-sandbox/src/components/mockups/`
2. **Preview** at `http://localhost:5173/preview/ComponentName`
3. **Screenshot** using `mcp__Claude_in_Chrome__computer` with `action: "screenshot"`
4. **Compare** by opening multiple preview tabs in your browser
5. **Graduate** the approved design using the mockup-graduate skill

See the `mockup-sandbox` skill for the full workflow.
