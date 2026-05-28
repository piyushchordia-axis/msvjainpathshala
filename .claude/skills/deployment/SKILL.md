---
name: deployment
description: Configure and prepare the project for deployment. Use when the user asks to deploy, publish, or set up production configuration.
---

# Deployment Skill

Configure production deployment settings and prepare the project for deployment.

## When to Use

Use this skill when:

- The project is ready and the user wants to deploy
- Configuring production run/build commands
- Setting up deployment for different project types
- Checking deployment logs

## When NOT to Use

- Project has known errors or incomplete features
- Just prototyping or testing locally

## Step 1: Prepare for Production

### Ensure a production build exists

```bash
# Node.js / React / Next.js
npm run build

# Python — no build needed, but check dependencies
pip freeze > requirements.txt

# Rust
cargo build --release

# Go
go build -o ./bin/app .
```

### Verify the production server command

Choose a production-grade server, not the dev server:

| Stack | Dev (avoid in prod) | Production |
|-------|---------------------|------------|
| Node.js | `npm run dev` | `node server.js` or `npm start` |
| Python Flask | `flask run` | `gunicorn -w 4 -b 0.0.0.0:$PORT main:app` |
| Python FastAPI | `uvicorn main:app --reload` | `uvicorn main:app --host 0.0.0.0 --port $PORT` |
| Static site | vite dev server | serve `dist/` with nginx or CDN |

## Step 2: Choose a Deployment Platform

### Static sites (React, Vue, plain HTML)

**Vercel** (recommended):
```bash
npm i -g vercel
vercel
```

**Netlify**:
```bash
npm i -g netlify-cli
netlify deploy --prod --dir=dist
```

**GitHub Pages**:
```bash
npm run build
# Push dist/ to gh-pages branch
```

### Node.js / Python web apps

**Railway** (easiest — detects framework automatically):
- Push to GitHub, connect repo at railway.app

**Render**:
- Connect GitHub repo at render.com
- Set build command and start command

**Fly.io**:
```bash
fly launch
fly deploy
```

**Heroku**:
```bash
heroku create myapp
git push heroku main
```

### Always-running processes (bots, workers)

**Railway** or **Render** background workers are ideal.

**Docker (any VPS)**:
```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
CMD ["node", "server.js"]
```

### Scheduled jobs

**GitHub Actions** (cron):
```yaml
on:
  schedule:
    - cron: '0 0 * * *'  # daily at midnight
```

**Railway** or **Render** cron jobs.

## Step 3: Set Environment Variables

Set secrets in your hosting platform's dashboard (not in code):

- Vercel: Project Settings → Environment Variables
- Render: Environment tab in service settings
- Railway: Variables tab
- Fly.io: `fly secrets set KEY=value`

Never commit secrets to git. Verify `.env` is in `.gitignore`.

## Step 4: Production Checklist

```bash
# 1. Check for hardcoded localhost URLs
grep -r "localhost\|127\.0\.0\.1" src/ --include="*.ts" --include="*.js" --include="*.py" | grep -v test | grep -v ".env"

# 2. Check NODE_ENV handling
grep -r "NODE_ENV" src/ | head -10

# 3. Ensure no dev dependencies in runtime
# For Node.js: npm ci --only=production should work

# 4. Check that PORT env var is respected
grep -r "process\.env\.PORT\|os\.environ.*PORT" src/ | head -5
```

## Reading Production Logs

Check your platform's dashboard for logs, or use CLI:

```bash
# Fly.io
fly logs

# Heroku
heroku logs --tail

# Railway / Render
# Check the dashboard → Logs tab
```

## Procfile (for Heroku, Railway, Render)

Create a `Procfile` at project root:

```
web: gunicorn -w 4 -b 0.0.0.0:$PORT main:app
```

or for Node.js:

```
web: node server.js
```

## Docker Compose (local multi-service)

```yaml
version: '3.8'
services:
  app:
    build: .
    ports:
      - "${PORT:-3000}:3000"
    environment:
      - DATABASE_URL=${DATABASE_URL}
    depends_on:
      - db
  db:
    image: postgres:15
    environment:
      POSTGRES_PASSWORD: password
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
```

```bash
docker-compose up -d
```
