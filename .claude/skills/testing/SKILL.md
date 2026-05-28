---
name: testing
description: Run automated UI tests against your application using browser automation. Use after implementing features to verify they work correctly in a real browser.
---

# Testing Skill

Run end-to-end UI tests using **Claude in Chrome** MCP tools. These tools control a real browser: navigate, click, type, screenshot, and verify.

## When to Use

- You implemented or modified a feature and want to verify it works
- Testing user flows (login, forms, navigation, modals)
- Verifying UI components render and behave correctly
- End-to-end flows spanning multiple pages
- Visual regressions (screenshot before/after)

## When NOT to Use

- Unit testing code logic — run `npm test` / `pytest` via Bash instead
- API-only testing without a UI — use `curl` via Bash
- When the application is not running (start it first using the workflows skill)

## How It Works

Use these MCP tools to drive a real browser:

| Step | Tool |
|------|------|
| Navigate to a URL | `mcp__Claude_in_Chrome__navigate` |
| Click / Type | `mcp__Claude_in_Chrome__computer` (action: left_click / type) |
| Screenshot | `mcp__Claude_in_Chrome__computer` (action: screenshot) |
| Read DOM text | `mcp__Claude_in_Chrome__get_page_text` |
| API calls | Bash: `curl -s -X POST ...` |
| DB queries | Bash: `psql "$DATABASE_URL" -c "..."` |

## Test Plan Format

Write test plans as structured steps:

```
1. [Browser] Navigate to http://localhost:3000/login
2. [Browser] Type "test@example.com" in the email field
3. [Browser] Type "password123" in the password field
4. [Browser] Click the "Sign In" button
5. [Verify]
   - URL changed to /dashboard
   - User name appears in the header
   - No error toast visible
```

## Running a Test — Step by Step

### 1. Make sure the app is running

```bash
lsof -i :3000 | grep LISTEN || echo "App not running — start it first"
```

### 2. Get an open browser tab

Use `mcp__Claude_in_Chrome__tabs_context_mcp` to get a valid `tabId`, then use it in all subsequent calls.

### 3. Navigate

```
mcp__Claude_in_Chrome__navigate({ url: "http://localhost:3000/login", tabId: <id> })
```

### 4. Interact

```
mcp__Claude_in_Chrome__computer({ action: "screenshot", tabId: <id> })
// Look at screenshot to find element coordinates, then:
mcp__Claude_in_Chrome__computer({ action: "left_click", coordinate: [x, y], tabId: <id> })
mcp__Claude_in_Chrome__computer({ action: "type", text: "test@example.com", tabId: <id> })
```

### 5. Verify

Take a screenshot and inspect the result:

```
mcp__Claude_in_Chrome__computer({ action: "screenshot", tabId: <id>, save_to_disk: true })
```

Use `mcp__Claude_in_Chrome__read_page` or `mcp__Claude_in_Chrome__get_page_text` to read DOM text for assertions.

## Building Good Test Context

Before testing, understand:

1. **Navigation path**: How to reach the feature (what URL, what login is needed)
2. **UI elements**: Button labels, form field names, expected text on success
3. **API endpoints involved**: So you can test the API layer if the UI test fails
4. **Test data**: Use unique values (e.g. `test_${Date.now()}@example.com`) to avoid conflicts

## API + DB Steps via Bash

```bash
# Create test data
curl -s -X POST http://localhost:3000/api/products \
  -H "Content-Type: application/json" \
  -d '{"name": "test-product-'$(date +%s)'", "price": 100}'

# Verify DB state
psql "$DATABASE_URL" -c "SELECT * FROM users WHERE email = 'test@example.com'"
```

## Reading Console Errors

After interactions, check for JS errors:

```
mcp__Claude_in_Chrome__read_console_messages({ tabId: <id> })
```

And network failures:

```
mcp__Claude_in_Chrome__read_network_requests({ tabId: <id> })
```

## Mobile Viewport Testing

```
mcp__Claude_in_Chrome__resize_window({ width: 400, height: 720, tabId: <id> })
```

## Example: Full Login Test

```
1. navigate to http://localhost:3000
2. screenshot → confirm landing page loaded
3. click "Sign In" link [find coordinates from screenshot]
4. type "user@example.com" in email field
5. type "password123" in password field
6. click "Sign In" button
7. screenshot → confirm redirect to /dashboard
8. get_page_text → assert "Welcome" text present
9. read_console_messages → assert no errors
```

## Application State

Tests run against your **live development database** — not a fresh environment. Always:

- **Generate unique values** for emails, titles, usernames to avoid conflicts
- **Don't assume specific counts** ("there are exactly 3 items") — other data may exist
- **Clean up** test data after tests if needed (`DELETE FROM ... WHERE email LIKE 'test_%'`)
