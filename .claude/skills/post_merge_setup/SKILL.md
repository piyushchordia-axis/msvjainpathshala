---
name: post_merge_setup
description: Maintain the post-merge setup script that runs after merging branches or pulling changes — installs dependencies, runs migrations, rebuilds assets.
---

# Post-Merge Setup

After merging a branch or pulling changes, a setup script should run automatically to install dependencies, apply migrations, and rebuild assets.

## The Post-Merge Script

Create at `scripts/post-merge.sh`:

```bash
#!/bin/bash
set -e

echo "Running post-merge setup..."

# Install dependencies
npm install          # or: pip install -r requirements.txt / pnpm install

# Run database migrations
npm run db:migrate   # or: alembic upgrade head / npx prisma migrate deploy

# Rebuild assets (if needed)
# npm run build

echo "Post-merge setup complete."
```

**Rules for the script:**
- **Idempotent** — safe to run multiple times without side effects
- **Non-interactive** — use `--yes` / `--force` / `-y` flags; never prompts
- **Fail fast** — use `set -e` so errors are caught immediately
- **Fast** — keep under 2 minutes; the developer is waiting

## Installing the Git Hook

```bash
# Create the hook (runs automatically after git merge / git pull)
cat > .git/hooks/post-merge << 'EOF'
#!/bin/bash
exec bash scripts/post-merge.sh
EOF

chmod +x .git/hooks/post-merge
echo "Post-merge hook installed."
```

To share the hook with the team, use `husky`:

```bash
npm install --save-dev husky
npx husky init
echo "bash scripts/post-merge.sh" > .husky/post-merge
chmod +x .husky/post-merge
```

## Running Manually

```bash
bash scripts/post-merge.sh
```

## Running with a Timeout

```bash
# Run with timeout (replace 180 with your desired seconds)
timeout 180 bash scripts/post-merge.sh || echo "Setup timed out or failed"
```

## Fixing Failures

When setup fails:

1. **Read the error output** — `bash scripts/post-merge.sh` prints directly to terminal
2. **Fix the script** — edit `scripts/post-merge.sh`
3. **If it timed out** — optimize slow commands or split them into separate steps
4. **If a command prompts for input** — add `--yes` / `--force` / `-y` flags
5. **Re-run** — `bash scripts/post-merge.sh` to confirm fix

## Common Patterns by Stack

### Node.js

```bash
#!/bin/bash
set -e
npm ci                          # Faster than npm install for CI
npx prisma migrate deploy       # Prisma migrations
npm run build 2>/dev/null || true  # Build (optional, skip if slow)
```

### Python

```bash
#!/bin/bash
set -e
pip install -r requirements.txt -q
alembic upgrade head             # or: python manage.py migrate
```

### Full-stack (Node + Python)

```bash
#!/bin/bash
set -e
npm ci
pip install -r requirements.txt -q
npm run db:migrate
```

## Committing the Script

```bash
git add scripts/post-merge.sh
git commit -m "Add post-merge setup script"
```

Note: `.git/hooks/` is **not committed** to git. To share hooks, use husky (above) or document the manual install step in your README.
