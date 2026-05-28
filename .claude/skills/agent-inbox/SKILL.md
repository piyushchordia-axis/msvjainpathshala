---
name: agent-inbox
description: Track and respond to user feedback on agent-built features. Use GitHub Issues for structured feedback tracking, or a FEEDBACK.md file for lightweight projects.
---

# Agent Inbox

Track user feedback on agent-built features.

## GitHub Issues (recommended)

If your project is on GitHub, use Issues for user feedback:

```bash
# List open issues
gh issue list

# View a specific issue
gh issue view 42

# Close an issue
gh issue close 42 --comment "Fixed in latest release"

# Create an issue from feedback
gh issue create --title "Bug: Login fails on Safari" --body "..."
```

## Simple feedback file

Create a `FEEDBACK.md` in your project root and track items there:

```markdown
# Feedback

## Pending
- [ ] Login button not working on mobile (reported 2025-01-15)
- [ ] Dark mode colors are too low contrast (reported 2025-01-14)

## Acknowledged
- [x] Loading spinner missing on submit (acknowledged 2025-01-13)

## Implemented
- [x] Add export to CSV (implemented in v1.2.0)
```

## Linear / Jira / Trello

For structured feedback management, connect to your team's issue tracker via their API (see `integrations` skill).
