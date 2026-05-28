---
name: skill-authoring
description: Create reusable skills that extend agent capabilities. Use when the user asks to create a skill, teach you something reusable, or save instructions for future tasks.
---

# Skill Authoring

Create skills to save reusable knowledge, procedures, and workflows that persist across sessions. Skills are instructions for future versions of yourself — write them as if teaching a fresh instance how to handle a task.

## When to Use

- User asks to "create a skill" or "teach you how to do X"
- User wants to save instructions for repeated future use
- A workflow should be reusable across sessions

## How to Create a Skill

1. Choose a skill name (lowercase, hyphens only, e.g. `code-review`)
2. Create the directory and write the SKILL.md file

## Skill Location

Skills live in **`.claude/skills/SKILLNAME/SKILL.md`** inside the project root.

```bash
mkdir -p .claude/skills/my-skill
# Then write the SKILL.md file there
```

## SKILL.md Format

```markdown
---
name: skill-name
description: What this skill does. When to use it.
---

# Skill Title

Instructions, examples, and workflows go here.
```

### Frontmatter Requirements

- `name`: lowercase letters/numbers/hyphens only, max 64 chars
- `description`: max 1024 chars — include WHAT it does and WHEN to trigger it

## Writing Tips

- **Be concise**: Only include info the agent wouldn't already know
- **Match specificity to fragility**: Exact commands for fragile ops, general guidance for flexible tasks
- **Include examples**: Input/output pairs improve output quality significantly
- **Keep under 500 lines**: For longer skills, split into reference files in a subfolder
- **Use standard tools**: Reference the Bash tool, Claude Code Agent tool, and standard CLIs — not proprietary platform functions

## Description Is Critical for Triggering

The description determines when Claude will automatically use this skill. Be specific:

```yaml
# Bad (too vague)
description: Processes documents

# Good (clear triggers)
description: Extracts text and images from PDF files. Use when the user asks to read, parse, or convert PDF documents.

# Good (explicit "when to use")
description: Reviews pull requests for code quality and security. Use when the user asks to review a PR, check code changes, or run a code review.
```

## Skill Locations Reference

| Path | Scope | Notes |
|------|-------|-------|
| `.claude/skills/SKILLNAME/SKILL.md` | Project-level | Committed to repo, shared with team |
| `~/.claude/skills/SKILLNAME/SKILL.md` | Global (all projects) | Personal, not committed |

## Reference Files

For large content, create sub-files and link from SKILL.md:

```
.claude/skills/my-skill/
  SKILL.md              ← main entry point
  references/
    api.md              ← API reference
    examples.md         ← code examples
```

In SKILL.md: `See [API reference](references/api.md) for full details.`

## Complete Example

```markdown
---
name: pr-review
description: Reviews pull requests for code quality and security. Use when the user asks to review a PR or check code changes.
---

# PR Review

## Process

1. Run `git diff main...HEAD` to see all changes
2. Read each changed file for issues
3. Check for test coverage gaps
4. Look for security vulnerabilities
5. Summarize findings with file:line references

## What to Check

- Logic errors and edge cases
- Security issues (injection, XSS, auth bypass)
- Performance concerns
- Missing error handling

## Output Format

\`\`\`markdown
## Summary
[1-2 sentence overview]

## Issues Found
- **[severity]** file:line — description

## Verdict
[Approve / Request Changes / Comment]
\`\`\`
```

## Skills Can Reference Other Skills

A skill can build on other skills. Reference them by name in the description or body:

```markdown
## Prerequisites
This skill assumes the project is set up (see `repl_setup` skill) and
dependencies are installed (see `package-management` skill).
```

## Keeping Skills Updated

Skills in `.claude/skills/` are fully mutable. Update them as you discover better patterns — don't treat them as permanent. Good times to update:

- After completing a task in a new way that worked better
- When the user corrects your approach ("no, always use X instead of Y")
- When dependencies or APIs change and the instructions are stale
