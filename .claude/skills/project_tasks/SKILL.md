---
name: project_tasks
description: Create and manage project tasks to track work. Use to break down complex work into trackable steps.
---

# Project Tasks

Manage tasks to track and coordinate work across sessions using Claude Code's built-in task system.

## When to Use

- Breaking a complex project into visible milestones
- Tracking progress on multi-step work
- When the user asks to "create a task" or "track this work"

## When NOT to Use

- Very small changes that take under a minute
- Internal steps that don't need user visibility

## Creating Tasks

Use the TaskCreate tool:

```
TaskCreate({
  name: "Add authentication",
  description: "Implement JWT-based login and registration with email/password",
})
```

For multiple related tasks, create them sequentially with TaskCreate.

## Listing Tasks

Use TaskList to see all current tasks and their status:

```
TaskList()
```

## Updating Tasks

Use TaskUpdate with the task ID:

```
TaskUpdate({ id: "task-123", status: "in_progress" })
TaskUpdate({ id: "task-123", status: "completed" })
```

## Task States

| State | Meaning |
|-------|---------|
| `pending` | Not started yet |
| `in_progress` | Currently being worked on |
| `completed` | Done |

## Task Format

When writing a task description, include:

1. **What to build** — brief description of the feature/change
2. **Done looks like** — observable outcomes when complete
3. **Out of scope** — what is explicitly NOT included

Example:

```
Name: Payment Integration
Description:
Add Stripe payment processing so users can subscribe.

Done: Users can enter payment info and subscribe to a plan.
Successful payments activate the paid tier immediately.
Failed payments show a clear error message.

Out of scope: Invoicing, multiple payment methods.
```

## Best Practices

1. **One task per user request** by default — don't over-split
2. **Keep titles short**: 3-6 words
3. **Mark in_progress when starting**: So the user sees active work
4. **Mark completed immediately**: Don't batch completions
5. **Use descriptions for detail**: Put implementation notes there, not in the title
