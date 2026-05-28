---
name: diagnostics
description: Check for code errors using type checkers and linters, and help users revert changes. Use for debugging static errors and helping users undo changes.
---

# Diagnostics Skill

Tools for checking code quality and managing project state.

## When to Use

Use this skill when:

- Checking for type errors, syntax errors, or import issues after code changes
- User wants to undo changes or revert to a previous state
- Debugging static errors

## When NOT to Use

- Runtime errors or logic bugs (use logs and debugging instead)
- Small changes that don't need validation
- Code search (use grep/glob tools)

## Checking Errors

Run the appropriate type checker or linter for the project's language via the Bash tool.

### TypeScript

```bash
# Check all TypeScript errors
npx tsc --noEmit 2>&1

# Check a specific file
npx tsc --noEmit --file src/auth.ts 2>&1

# With eslint
npx eslint src/ --ext .ts,.tsx 2>&1 | head -50
```

### Python

```bash
# Type checking with mypy
mypy src/ 2>&1 | head -50

# Linting with ruff (fast)
ruff check . 2>&1 | head -50

# Or with flake8
flake8 . 2>&1 | head -50
```

### JavaScript

```bash
# ESLint
npx eslint src/ 2>&1 | head -50
```

### Rust

```bash
# Check without building (fast)
cargo check 2>&1 | head -50
```

### Go

```bash
go vet ./... 2>&1
```

## When to Check

- After refactoring >100 lines of code
- User reports "errors" or "something's not working"
- After adding imports or dependencies
- Before completing a task with significant changes

## Skip When

- Making small changes (<10 lines)
- Adding comments or documentation
- Debugging runtime errors (type checkers won't show these)

## Reverting Changes

When the user wants to undo changes, use git:

```bash
# See what changed
git diff --stat
git status

# Undo last commit (keeps changes staged)
git reset HEAD~1

# Undo last commit (discards changes entirely)
git reset --hard HEAD~1

# Revert a specific file to last commit
git checkout HEAD -- src/auth.ts

# Revert all unstaged changes
git restore .

# Show recent commits to find a good checkpoint
git log --oneline -20

# Revert to a specific commit (creates a new revert commit)
git revert abc1234

# Reset to a specific commit (destructive)
git reset --hard abc1234
```

**When user says** "undo what you just did", "revert the last changes", "go back to how it was":

1. Show `git status` and `git diff --stat` to confirm what changed
2. Offer the appropriate git command (reset, restore, or revert)
3. Ask user to confirm before running destructive operations

**When user says** "everything is broken, start over":

```bash
# Show recent commits
git log --oneline -10
# Let user pick which commit to revert to
git reset --hard <sha>
```

## Example: TypeScript Error Check

```bash
# After editing TypeScript files
npx tsc --noEmit 2>&1

# If errors, read the output carefully:
# src/services/user.ts:45:10 - error TS2345: Argument of type 'string'
# is not assignable to parameter of type 'number'.
# Fix each error, then re-run to verify
```

## Example: Python Error Check

```bash
# Run mypy for type errors
mypy . --ignore-missing-imports 2>&1 | head -30

# Run ruff for lint issues
ruff check . 2>&1 | head -30

# Fix automatically where possible
ruff check --fix .
```
