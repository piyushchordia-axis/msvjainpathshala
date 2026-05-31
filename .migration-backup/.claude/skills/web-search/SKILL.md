---
name: web-search
description: Search the web and fetch content from URLs. Use for real-time information, API documentation, and current events.
---

# Web Search Skill

Search the web and retrieve content from URLs using Claude Code's built-in WebSearch and WebFetch tools.

## When to Use

Use this skill when:

- You need real-time information (news, prices, events)
- Looking up API documentation or SDK guides
- Accessing current technical information beyond training data
- Verifying facts from authoritative sources

## When NOT to Use

- Image/media downloads (use media-generation skill or curl)
- Code search within the project (use grep/glob tools)

## Web Search

Use the WebSearch tool directly. Phrase queries as complete questions:

```
Query: "OpenAI API rate limits 2025"
Query: "FastAPI dependency injection best practices"
Query: "React 19 breaking changes from React 18"
```

The tool returns a search answer summary and a list of result pages with titles, URLs, and snippets.

## Fetching a URL

Use the WebFetch tool with any HTTPS URL to get the page content as markdown:

```
URL: https://platform.openai.com/docs/guides/rate-limits
URL: https://docs.python.org/3/library/asyncio.html
```

## Best Practices

1. **Use natural language queries**: Write queries as complete questions with context
2. **Chain search and fetch**: Search first to find relevant URLs, then fetch for full details
3. **Be specific**: Include version numbers, dates, or framework names in queries
4. **Verify with fetch**: Don't rely solely on search snippets for critical implementation decisions

## Example Workflow

1. Search: "FastAPI background tasks tutorial 2024"
2. Review results to find the most relevant documentation URL
3. Fetch: `https://fastapi.tiangolo.com/tutorial/background-tasks/`
4. Implement based on the full documentation content

## Limitations

- Cannot access social media platforms (LinkedIn, Twitter, Instagram, Facebook, Reddit, YouTube)
- Cannot download binary files (images, videos, audio) — use curl via Bash for that
- Paywalled or authenticated content may be inaccessible

## Downloading Files via curl (when WebFetch isn't enough)

For downloading actual files (PDFs, images, etc.):

```bash
# Download a file
curl -L -o output.pdf "https://example.com/document.pdf"

# Download and inspect headers
curl -I "https://example.com/api"

# POST request
curl -s -X POST "https://api.example.com/v1/data" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"key": "value"}'
```
