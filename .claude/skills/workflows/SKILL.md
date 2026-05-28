---
name: workflows
description: Manage application background processes — start, stop, restart servers and services. Use when the user asks to start, stop, restart the application, or when you need to run a background server process.
---

# Workflows Skill

Manage long-running background processes (web servers, backend APIs, watchers) using the Bash tool.

## When to Use

Use this skill when:

- Starting or restarting the application after code changes
- Running a background server process
- Checking if a process is running and on which port
- Stopping a process
- Checking server logs

## When NOT to Use

- One-off commands that don't need to stay running (use Bash directly)
- Build scripts (use Bash)
- Test runs (use Bash)

## Starting a Process

```bash
# Start a Node.js dev server
npm run dev &

# Start a Python server
python app.py &

# Start and save PID for later management
npm run dev > /tmp/app.log 2>&1 & echo $! > /tmp/app.pid
echo "Server started with PID $(cat /tmp/app.pid)"
```

When using the Bash tool with `run_in_background: true`, the process runs in the background automatically.

## Checking Process Status

```bash
# Check if something is listening on a port
lsof -i :3000 2>/dev/null | grep LISTEN || echo "Nothing on port 3000"

# Check if app process is running
pgrep -f "node.*dev" && echo "Running" || echo "Not running"

# View recent logs
tail -50 /tmp/app.log 2>/dev/null || echo "No log file found"

# Check all background processes you started
jobs -l
```

## Restarting a Process

```bash
# Kill process on a port and restart
kill $(lsof -t -i:3000) 2>/dev/null; sleep 1; npm run dev > /tmp/app.log 2>&1 &

# Or kill by name and restart
pkill -f "node.*dev" 2>/dev/null; sleep 1; npm run dev > /tmp/app.log 2>&1 &
echo "Restarted. Waiting for port..."
sleep 3
lsof -i :3000 | grep LISTEN && echo "Server is up" || echo "Server may still be starting"
```

## Stopping a Process

```bash
# Stop by port
kill $(lsof -t -i:3000) 2>/dev/null && echo "Stopped" || echo "Nothing to stop"

# Stop by process name
pkill -f "npm run dev" 2>/dev/null
pkill -f "python app.py" 2>/dev/null

# Stop using saved PID
kill $(cat /tmp/app.pid) 2>/dev/null && rm /tmp/app.pid
```

## Checking Port Usage

```bash
# See all listening ports
lsof -i -P | grep LISTEN

# Check a specific port
lsof -i :5000
```

## Common Project Types

### Node.js / React / Next.js

```bash
# Start dev server (background)
npm run dev > /tmp/app.log 2>&1 &
echo "Started. Check logs: tail -f /tmp/app.log"
```

### Python / Flask / FastAPI

```bash
# Flask
python app.py > /tmp/app.log 2>&1 &

# FastAPI with uvicorn
uvicorn main:app --reload --port 8000 > /tmp/app.log 2>&1 &
```

### Frontend + Backend (two processes)

```bash
# Start backend
python server.py > /tmp/backend.log 2>&1 &
echo "Backend started"

# Start frontend
npm run dev > /tmp/frontend.log 2>&1 &
echo "Frontend started"
```

## Port Conventions

| Purpose | Common Port |
|---------|------------|
| Frontend dev server | 3000, 5173 (Vite), 5000 |
| Backend API | 8000, 8080, 3001 |
| Database | 5432 (PostgreSQL), 3306 (MySQL) |

## Checking Startup Success

After starting, verify it's listening:

```bash
# Wait up to 10s for port to open
for i in $(seq 1 10); do
  lsof -i :3000 | grep LISTEN && echo "Server ready!" && break
  echo "Waiting... ($i/10)"
  sleep 1
done
```

## Viewing Logs

```bash
# Follow logs in real-time (use run_in_background if needed)
tail -f /tmp/app.log

# Last 100 lines
tail -100 /tmp/app.log

# Show errors only
grep -i "error\|exception\|fail" /tmp/app.log | tail -20
```
