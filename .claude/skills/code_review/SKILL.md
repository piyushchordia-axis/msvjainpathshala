---
name: code_review
description: Spawn a subagent for deep code analysis, architecture review, and debugging. Use after building major features or when you need an independent analysis of code quality, design, or a bug's root cause.
---

# Code Review Skill

Spawn a Claude Code subagent for deep architectural analysis, planning, and debugging.

## When to Use

Use this skill when:

- You need deep architectural analysis or code understanding
- You want strategic recommendations about system design or patterns
- You need comprehensive analysis of code quality or technical debt
- You want root cause analysis and debugging assistance for complex bugs

## When NOT to Use

- Simple tasks you can complete directly
- Tasks that require file edits (read the files yourself and act)
- Small focused questions (just answer them inline)

Spawn a subagent using the **Agent** tool:

```
Agent({
  description: "Architectural analysis of auth system",
  prompt: "Analyze the authentication flow in src/services/UserAuthService.ts and src/utils/jwt.ts. 
           The issue: validateSession() returns false for valid tokens after ~1 hour.
           Responsibility: debug. Include git diff context if available.
           Report: root cause, reproduction steps, recommended fix."
})
```

## Responsibility Types

- **evaluate_task**: Assess completed or ongoing work against goals
- **plan**: Create implementation plans with task decomposition
- **debug**: Root cause analysis, reproduction steps, and recommended fixes

## Example: Plan a Feature

```
Agent({
  description: "Rate limiting implementation plan",
  prompt: "Create an implementation plan for adding rate limiting to API endpoints.
           Relevant files: src/middleware/index.ts, src/routes/api.ts
           Responsibility: plan.
           The plan should cover: middleware design, storage (Redis vs in-memory), 
           per-user vs per-IP limits, and error response format."
})
```

## Example: Debug an Issue

```
Agent({
  description: "Debug session validation failure",
  prompt: "The UserAuthService.validateSession() returns false for valid tokens.
           Relevant files: src/services/UserAuthService.ts, src/utils/jwt.ts
           Responsibility: debug.
           Provide: root cause, steps to reproduce, and recommended fix."
})
```

## Example: Architecture Review

```
Agent({
  description: "Review payment integration architecture",
  prompt: "Review the payment integration in src/payments/ for:
           1. Security concerns (PCI compliance issues)
           2. Error handling completeness
           3. Webhook idempotency
           Responsibility: evaluate_task.
           Report findings in priority order with specific file:line references."
})
```

## Best Practices

1. **Be specific**: Include concrete function names, error messages, or design goals
2. **List relevant files**: The subagent reads the files you reference
3. **Choose the right responsibility**: plan / debug / evaluate_task
4. **Include git context when debugging regressions**: "Run `git diff HEAD~3` and include it in analysis"
5. **Ask for structured output**: Specify the format you want (priority list, numbered steps, etc.)
