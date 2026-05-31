---
name: external_apis
description: Access external APIs. Use for web search (Brave), image search, or other third-party API calls.
---

# External APIs

Access external APIs using direct HTTP calls via the Bash tool or WebSearch/WebFetch tools.

## Web Search

**Option 1: Claude Code's built-in WebSearch tool** (no API key needed)

Use the WebSearch tool directly — it searches the web and returns results without any configuration.

**Option 2: Brave Search API** (requires `BRAVE_API_KEY` in `.env`)

Get a key at search.brave.com/search/api

```bash
# Search the web
curl -s "https://api.search.brave.com/res/v1/web/search?q=best+python+web+frameworks&count=5" \
  -H "Accept: application/json" \
  -H "X-Subscription-Token: $BRAVE_API_KEY" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for r in data.get('web', {}).get('results', []):
    print(f\"{r['title']}: {r['url']}\")
    print(f\"  {r.get('description', '')}\")
    print()
"
```

```bash
# Image search
curl -s "https://api.search.brave.com/res/v1/images/search?q=mountain+landscape&count=3" \
  -H "Accept: application/json" \
  -H "X-Subscription-Token: $BRAVE_API_KEY" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for img in data.get('results', []):
    print(img['url'])
"
```

## General API Pattern

For any external API, use curl via Bash:

```bash
# GET request
curl -s "https://api.example.com/v1/endpoint" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json"

# POST request
curl -s -X POST "https://api.example.com/v1/endpoint" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"key": "value"}'

# Download and save response
curl -s "https://api.example.com/data" \
  -H "Authorization: Bearer $API_KEY" \
  -o attached_assets/response.json
```

## Available Reference Docs

- `references/brave.md` — Brave Search API details
