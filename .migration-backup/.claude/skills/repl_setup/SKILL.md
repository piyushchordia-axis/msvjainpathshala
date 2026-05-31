---
name: repl_setup
description: Set up and configure web applications for local development. Covers dev server configuration, frontend/backend connectivity, and framework-specific setup.
---

# Local Dev Setup

Guidelines for setting up and configuring web applications for local development.

## When to Use

Use this skill when:

- Setting up a new web application or frontend framework
- Configuring frontend-to-backend connectivity
- Debugging why the dev server isn't working
- Starting a new project from scratch

## When NOT to Use

- For deployment/production issues (use the deployment skill)
- For non-web applications (CLI tools, scripts)

## Starting a Dev Server

### React (Vite)

```bash
# Default port 5173
npm run dev

# Custom port
npm run dev -- --port 3000
```

Access at `http://localhost:5173`

### Next.js

```bash
npm run dev
# Runs on http://localhost:3000
```

### Vue (Vite)

```bash
npm run dev
# Runs on http://localhost:5173
```

### Angular

```bash
ng serve
# Runs on http://localhost:4200
```

### Create React App

```bash
npm start
# Runs on http://localhost:3000
```

## Frontend-Backend Connectivity

In local dev, the frontend and backend typically run on different ports. Configure the API URL based on environment.

### Approach 1: Environment Variables

In `.env.local` (for Vite/React) or `.env` (Node.js):
```
VITE_API_URL=http://localhost:8000
# or
REACT_APP_API_URL=http://localhost:8000
```

Use in code:
```typescript
const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000';
```

### Approach 2: Vite Proxy (avoids CORS)

In `vite.config.ts`:
```typescript
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      }
    }
  }
})
```

Then your fetch calls use `/api/...` with no CORS issues.

### Approach 3: Next.js API Routes

Put backend logic in `pages/api/` or `app/api/` — no separate server needed for simple cases.

## CORS Setup (Backend)

If frontend and backend run on different ports, configure CORS on the backend:

### Express (Node.js)

```bash
npm install cors
```

```typescript
import cors from 'cors';
app.use(cors({ origin: 'http://localhost:3000' }));
// Or allow all origins in dev:
app.use(cors());
```

### Flask (Python)

```bash
pip install flask-cors
```

```python
from flask_cors import CORS
CORS(app, origins=["http://localhost:3000"])
```

### FastAPI (Python)

```python
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)
```

## Debugging Connectivity Issues

```bash
# Check what's running on a port
lsof -i :3000
lsof -i :8000

# Test backend is accessible
curl http://localhost:8000/api/health

# Check for CORS errors in browser DevTools console
# Look for: "Access-Control-Allow-Origin" errors
```

## Common Port Conventions (Local)

| Service | Default Port |
|---------|-------------|
| React (CRA) | 3000 |
| Vite (React/Vue) | 5173 |
| Next.js | 3000 |
| Angular | 4200 |
| Express | 3001 or 8000 |
| FastAPI | 8000 |
| Django | 8000 |
| PostgreSQL | 5432 |

## Framework Config: Allow All Hosts

Some frameworks restrict what hostnames they respond to. In local dev this is rarely an issue, but if accessing from another device on the network:

### Vite

```typescript
// vite.config.ts
server: { host: '0.0.0.0' }
```

### Next.js

```javascript
// next.config.js
module.exports = { experimental: { appDir: true } }
// Run with: next dev -H 0.0.0.0
```

### Create React App

```bash
HOST=0.0.0.0 npm start
```

## Hot Reload

Most modern frameworks support hot module reloading (HMR) — changes to source files update the browser automatically without restarting the server. Only restart the server when:

- You change configuration files (`vite.config.ts`, `next.config.js`, etc.)
- You install new packages
- You change environment variables

## Checking Server Logs

```bash
# Follow server logs started in background
tail -f /tmp/app.log

# Check for port conflicts
lsof -i :3000
```
