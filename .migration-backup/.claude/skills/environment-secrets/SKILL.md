---
name: environment-secrets
description: Manage environment variables and secrets. View, set, delete env vars and request secrets from users.
---

# Environment Secrets Skill

Manage environment variables and secrets (API keys, tokens, credentials) using a local `.env` file.

## When to Use

Use this skill when:

- You need to check what environment variables or secrets exist
- Setting configuration values (ports, hostnames, feature flags)
- Asking the user to provide API keys or tokens

## When NOT to Use

- Never hardcode secrets in source files
- Don't commit `.env` to git — ensure `.gitignore` includes `.env`

## Reading Env Vars

```bash
# View all env var keys (hides values for security)
grep -v '^#' .env 2>/dev/null | cut -d= -f1 | sort

# Check if a specific key exists
grep -q "^OPENAI_API_KEY=" .env && echo "OPENAI_API_KEY is set" || echo "OPENAI_API_KEY is NOT set"

# Check multiple keys
for key in OPENAI_API_KEY STRIPE_SECRET_KEY DATABASE_URL; do
  grep -q "^${key}=" .env && echo "$key: set" || echo "$key: MISSING"
done
```

## Setting Env Vars

For non-sensitive config values:

```bash
# Add or update a variable in .env
grep -q "^PORT=" .env && sed -i '' "s/^PORT=.*/PORT=3000/" .env || echo "PORT=3000" >> .env
grep -q "^NODE_ENV=" .env && sed -i '' "s/^NODE_ENV=.*/NODE_ENV=development/" .env || echo "NODE_ENV=development" >> .env
```

Or simply edit the `.env` file directly with the Edit tool.

## Deleting Env Vars

```bash
# Remove a variable from .env
sed -i '' "/^OLD_CONFIG=/d" .env
sed -i '' "/^DEPRECATED_FLAG=/d" .env
```

## Requesting Secrets from User

Never set secrets programmatically. Instead, ask the user directly:

1. Tell the user which secrets are needed and why
2. Ask them to add to `.env`:
   ```
   OPENAI_API_KEY=sk-...
   STRIPE_SECRET_KEY=sk_live_...
   ```
3. Verify they were added:
   ```bash
   grep -q "^OPENAI_API_KEY=" .env && echo "Found" || echo "Still missing"
   ```

Example message to user:
> "Please add your OpenAI API key to the `.env` file:
> `OPENAI_API_KEY=sk-your-key-here`
> This is needed to enable the chat feature."

## .env File Format

```bash
# .env — never commit this file
DATABASE_URL=postgresql://localhost/myproject
PORT=3000
NODE_ENV=development

# API keys (provided by user)
OPENAI_API_KEY=sk-...
STRIPE_SECRET_KEY=sk_live_...
```

## .gitignore Setup

Ensure `.env` is ignored:

```bash
grep -q "^\.env$" .gitignore || echo ".env" >> .gitignore
```

## Loading Env Vars

Different ways to load `.env` in your project:

- **Node.js**: Use `dotenv` package — `require('dotenv').config()`
- **Python**: Use `python-dotenv` — `from dotenv import load_dotenv; load_dotenv()`
- **Shell**: `export $(grep -v '^#' .env | xargs)`

## Example Workflow

```bash
# 1. Check what's configured
grep -v '^#' .env 2>/dev/null | cut -d= -f1 | sort

# 2. Check for required keys
for key in OPENAI_API_KEY DATABASE_URL; do
  grep -q "^${key}=" .env && echo "$key: OK" || echo "$key: MISSING — please add to .env"
done

# 3. Set non-sensitive config
echo "PORT=3000" >> .env
echo "NODE_ENV=development" >> .env

# 4. Verify
source .env && echo "PORT=$PORT, NODE_ENV=$NODE_ENV"
```
