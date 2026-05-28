---
name: integrations
description: Connect external services and APIs. Use when the user wants to integrate a third-party service (Slack, GitHub, Google, HubSpot, etc.) or set up OAuth.
---

# Integrations Skill

Connect external services and APIs to your project.

## When to Use

Use this skill when:

- Connecting a third-party service (Slack, GitHub, Google Workspace, HubSpot, etc.)
- Setting up OAuth authentication with an external provider
- Configuring API keys for external services

## When NOT to Use

- General HTTP API calls that don't require OAuth (just use the API key in `.env`)
- Database connections (use the database skill)

## Getting API Credentials

Every service has a developer console:

| Service | Console URL |
|---------|-------------|
| Slack | api.slack.com/apps |
| GitHub | github.com/settings/developers |
| Google | console.cloud.google.com |
| HubSpot | developers.hubspot.com |
| Discord | discord.com/developers |
| Stripe | dashboard.stripe.com/apikeys |
| Twilio | console.twilio.com |
| SendGrid | app.sendgrid.com/settings/api_keys |
| Linear | linear.app/settings/api |

## Storing Credentials

Add to `.env` (never commit this file):

```bash
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
STRIPE_SECRET_KEY=sk_live_...
```

## Requesting Credentials from User

Always ask the user to provide secrets rather than looking them up yourself:

> "To integrate with Slack, please:
> 1. Go to api.slack.com/apps and create a new app
> 2. Add Bot Token Scopes: `chat:write`, `channels:read`
> 3. Install the app to your workspace
> 4. Copy the **Bot User OAuth Token** to `.env`:
>    `SLACK_BOT_TOKEN=xoxb-your-token`"

## OAuth Setup

For OAuth integrations (Google login, GitHub login, etc.):

### Node.js (Passport.js)

```bash
npm install passport passport-github2 express-session
```

Set redirect URI in the service's app settings: `http://localhost:3000/auth/github/callback`

### Python (Authlib)

```bash
pip install authlib flask
```

```python
from authlib.integrations.flask_client import OAuth
oauth = OAuth(app)
oauth.register('github',
    client_id=os.environ['GITHUB_CLIENT_ID'],
    client_secret=os.environ['GITHUB_CLIENT_SECRET'],
    access_token_url='https://github.com/login/oauth/access_token',
    authorize_url='https://github.com/login/oauth/authorize',
    client_kwargs={'scope': 'user:email'},
)
```

## Common SDK Usage

### Slack

```bash
npm install @slack/web-api   # Node.js
pip install slack-sdk        # Python
```

```python
from slack_sdk import WebClient
client = WebClient(token=os.environ["SLACK_BOT_TOKEN"])
client.chat_postMessage(channel="#general", text="Hello!")
```

### GitHub

```bash
npm install @octokit/rest
pip install PyGithub
```

### Google APIs

```bash
pip install google-api-python-client google-auth-oauthlib
```

### Linear

```bash
npm install @linear/sdk
```

```typescript
import { LinearClient } from "@linear/sdk";
const client = new LinearClient({ apiKey: process.env.LINEAR_API_KEY });
const me = await client.viewer;
```

## Webhooks (Local Development)

For services that push events (Stripe, GitHub, Slack) use **ngrok** to expose localhost:

```bash
# Install from ngrok.com, then:
ngrok http 3000
# Use the HTTPS URL as your webhook endpoint in the service dashboard
```

Or for Stripe specifically:

```bash
stripe listen --forward-to localhost:3000/webhook
```

## Checking Configured Integrations

```bash
# Check which services have credentials configured
for key in SLACK_BOT_TOKEN GITHUB_TOKEN GOOGLE_CLIENT_ID LINEAR_API_KEY; do
  grep -q "^${key}=" .env && echo "$key: configured" || echo "$key: missing"
done
```

## Security

- Never hardcode credentials in source files
- Use `.env` for local secrets; ensure `.env` is in `.gitignore`
- Use separate API keys for development and production
- Update OAuth redirect URIs when moving to production domain
