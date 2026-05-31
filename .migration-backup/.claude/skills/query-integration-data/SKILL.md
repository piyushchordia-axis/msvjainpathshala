---
name: query-integration-data
description: Query and modify data in external services (Linear, GitHub, Slack, HubSpot, etc.) or data warehouses (BigQuery, Snowflake, Databricks). Use when the user asks a question that requires fetching data from an external service.
---

# Query Integration Data Skill

Query and modify data in external services and data warehouses.

## When to Use

Use this skill when the user:

- Asks a question requiring data from an external service ("how many open issues?", "list recent Slack messages")
- Wants to export data to CSV/JSON
- Needs to create, update, or delete items in an external service
- Queries a data warehouse (BigQuery, Snowflake, Databricks)

## When NOT to Use

- Building a dashboard or visualization (implement data fetching in the app code)
- Production database operations (use the database skill)

## Getting Credentials

Credentials come from environment variables in `.env`. Use the Bash tool to run API calls.

Read available credentials:

```bash
# Check what credentials are configured
grep -E "^(LINEAR|GITHUB|SLACK|HUBSPOT|GOOGLE|BIGQUERY|SNOWFLAKE|DATABRICKS)_" .env | cut -d= -f1
```

Or in Python:

```python
import os
linear_token = os.environ.get("LINEAR_API_KEY")
github_token = os.environ.get("GITHUB_TOKEN")
slack_token = os.environ.get("SLACK_BOT_TOKEN")
```

## Common Integrations

### Linear

```bash
pip install linear-python
# or: npm install @linear/sdk
```

```python
from linear.client import LinearClient
client = LinearClient(api_key=os.environ["LINEAR_API_KEY"])

# List issues
issues = client.issues(first=10).nodes
for i in issues:
    print(f"{i.identifier}: {i.title} [{i.state.name}]")
```

### GitHub

```bash
pip install PyGithub
```

```python
from github import Github
g = Github(os.environ["GITHUB_TOKEN"])
repo = g.get_repo("owner/repo")

# List open issues
for issue in repo.get_issues(state='open'):
    print(f"#{issue.number}: {issue.title}")
```

### Slack

```bash
pip install slack-sdk
```

```python
from slack_sdk import WebClient
client = WebClient(token=os.environ["SLACK_BOT_TOKEN"])

# List channels
result = client.conversations_list()
for ch in result["channels"]:
    print(f"#{ch['name']}")

# Post message
client.chat_postMessage(channel="#general", text="Hello!")
```

### HubSpot

```bash
pip install hubspot-api-client
```

```python
from hubspot import HubSpot
client = HubSpot(api_key=os.environ["HUBSPOT_API_KEY"])
contacts = client.crm.contacts.basic_api.get_page(limit=10)
```

## Data Warehouses

### BigQuery

```bash
pip install google-cloud-bigquery
```

```python
from google.cloud import bigquery
client = bigquery.Client(project=os.environ["GOOGLE_CLOUD_PROJECT"])
query = "SELECT * FROM `project.dataset.table` LIMIT 10"
df = client.query(query).to_dataframe()
print(df.to_string())
```

### Snowflake

```bash
pip install snowflake-connector-python pandas
```

```python
import snowflake.connector, pandas as pd
conn = snowflake.connector.connect(
    account=os.environ["SNOWFLAKE_ACCOUNT"],
    user=os.environ["SNOWFLAKE_USER"],
    password=os.environ["SNOWFLAKE_PASSWORD"],
    warehouse=os.environ.get("SNOWFLAKE_WAREHOUSE", "COMPUTE_WH"),
)
df = pd.read_sql("SELECT * FROM my_table LIMIT 10", conn)
print(df.to_string())
```

### Databricks

```bash
pip install databricks-sql-connector pandas
```

## Exporting Results

```python
import json, csv

# Write CSV
with open('.agents/outputs/results.csv', 'w', newline='') as f:
    writer = csv.writer(f)
    writer.writerow(['id', 'title', 'status'])
    for issue in issues:
        writer.writerow([issue.id, issue.title, issue.status])
print("Exported to .agents/outputs/results.csv")

# Write JSON
with open('.agents/outputs/results.json', 'w') as f:
    json.dump(data, f, indent=2)
```

```bash
mkdir -p .agents/outputs
```

## Pattern: Fetch Options Before Write Operations

For write operations that reference entities by name (users, projects, etc.), fetch the list first:

```python
# Wrong: creating an issue without knowing team ID
# Right: fetch teams first to get the ID
teams = client.teams().nodes
team = next(t for t in teams if t.name == "Engineering")
await client.create_issue(team_id=team.id, title="Fix bug")
```

## Output Guidelines

- Simple answers (counts, short lists): Print directly
- Tabular data (>20 rows): Write to `.agents/outputs/filename.csv`
- Write operations: Confirm what was created/updated with IDs
