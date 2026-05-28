---
name: delegation
description: Delegate tasks to specialized subagents for autonomous or parallel execution. Use when you have multiple independent tasks, need deep focused work done in isolation, or want to run tasks in the background.
---

# Delegation Skill

Delegate tasks to Claude Code subagents using the built-in **Agent** tool.

## When to Use

- You have 2+ independent tasks that can run in parallel
- A task requires deep focused execution (e.g. writing a whole feature)
- You want to run a task in the background while you do other work
- You need an isolated code review or analysis

## When NOT to Use

- Simple tasks you can complete directly
- Read-only operations (use grep/glob/read tools)
- Quick single-file edits
- Tasks that require restarting the server or checking logs (do those yourself)

---

## Synchronous Subagent

Blocks until the subagent finishes. Use when you need the result before continuing.

```
Agent({
  description: "Fix auth bug in UserAuthService",
  prompt: "Fix the bug in src/services/UserAuthService.ts where validateSession()
           returns false for valid tokens after 1 hour.
           Read the file, identify the issue, fix it, verify with tsc --noEmit.
           Report: what you changed and why."
})
```

The result is returned to you directly. Always tell the agent what to **report back** so you get useful output.

---

## Background Subagent

Returns immediately. You are auto-notified when it completes. Use for independent tasks.

```
Agent({
  description: "Write user profile tests",
  prompt: "Write Jest unit tests for src/services/UserService.ts.
           Cover: createUser, updateUser, deleteUser.
           Use existing test patterns from src/services/__tests__/AuthService.test.ts.
           Run tests with: npm test -- UserService
           Report: test file path and pass/fail count.",
  run_in_background: true
})
```

---

## Parallel Execution

Launch multiple agents in the same message — they run simultaneously:

```
// Send both at once in a single message:
Agent({ description: "Fix auth bug", prompt: "...", run_in_background: true })
Agent({ description: "Write profile tests", prompt: "...", run_in_background: true })
```

Both run in parallel. You'll be notified as each one finishes.

---

## Follow-up Messages

After spawning an agent, use **SendMessage** with the agent's ID or name to continue:

```
// Async follow-up (fire-and-forget)
SendMessage({
  to: "agent-name-or-id",
  message: "After the fix, also add regression tests for the edge case."
})

// Sync follow-up (wait for response)
SendMessage({
  to: "agent-name-or-id",
  message: "Summarize root cause and list exact files changed.",
  wait_for_response: true
})
```

---

## Session Plans

For complex multi-task sessions, write a plan file and include its content in each agent's prompt:

```markdown
# .local/session_plan.md

## T001 - Add authentication
Files: src/auth/AuthService.ts, src/routes/auth.ts
Task: Implement JWT login/register endpoints with bcrypt password hashing.

## T002 - Add user profile CRUD
Files: src/services/UserService.ts, src/routes/users.ts
Depends on: T001
Task: Add GET/PUT /users/:id endpoints. Use authenticated user from JWT.

## T003 - Write tests for T001 and T002
Files: src/services/__tests__/
Depends on: T001, T002
Task: Write Jest tests covering auth and user profile flows.
```

Then delegate by reading the plan and passing task context:

```
// Read the plan first, then delegate each task
Agent({
  description: "Implement authentication (T001)",
  prompt: "[paste T001 section from plan here]
           Files to work on: src/auth/AuthService.ts, src/routes/auth.ts
           When done, run: npx tsc --noEmit
           Report: files created/modified and any issues found."
})
```

---

## Isolated Worktree (for risky changes)

Use `isolation: "worktree"` to give the agent its own git branch — no risk to your working tree:

```
Agent({
  description: "Refactor database layer",
  prompt: "Refactor src/db/ to use connection pooling.
           Run: npm test to verify nothing breaks.
           Report: what changed, test results, and the branch name.",
  isolation: "worktree"
})
```

The branch name is returned in the result. Review it before merging.

---

## Subagent Capabilities

The subagent **CAN**:
- Read, write, edit files
- Run Bash commands (npm, pip, tsc, jest, etc.)
- Use grep/glob for code search
- Access skills if you paste skill content into the prompt

The subagent **CANNOT**:
- Restart the dev server or check workflow logs
- Take browser screenshots (do that in the main session)
- See the UI or browser state

---

## Writing Good Delegation Prompts

Bad (vague):
```
"Fix the login bug"
```

Good (specific):
```
"The login endpoint at POST /api/auth/login in src/routes/auth.ts returns 401
 even for valid credentials. The JWT secret is read from process.env.JWT_SECRET.
 Read src/routes/auth.ts and src/services/AuthService.ts, find the issue, fix it.
 Run: npx tsc --noEmit to verify no type errors.
 Report: root cause, files changed, and whether tsc passed."
```

Always include:
1. **What's broken or what to build** — specific, not vague
2. **Which files to look at** — don't make the agent guess
3. **How to verify** — what command to run to confirm it works
4. **What to report** — what output you need back
