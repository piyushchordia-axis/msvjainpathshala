---
name: database
description: Manage PostgreSQL databases, check status, execute SQL queries safely. Use when the user wants to check data, debug database issues, or run queries.
---

# Database Skill

Manage PostgreSQL databases and execute SQL queries safely in your local development environment.

## When to Use

Use this skill when:

- Checking if a database is accessible
- Running SQL queries against the development database
- Creating tables, inserting data, or querying data

## When NOT to Use

- Schema migrations in production without a backup
- Direct modifications to Stripe tables (use Stripe API instead)

## Database Operations

All database operations are performed by running `psql` via the Bash tool.
Connection info comes from `DATABASE_URL` (or individual `PG*` variables) in your `.env` file.

**Check database connection:**

```bash
psql "$DATABASE_URL" -c "SELECT 1" 2>&1
```

If `DATABASE_URL` is not set, read `.env` to check what's configured.

**Check connection details:**

```bash
# Check if DATABASE_URL is set
grep -E "^DATABASE_URL" .env 2>/dev/null || echo "DATABASE_URL not set"
# Try connecting
psql "$DATABASE_URL" -c "\conninfo" 2>&1
```

**Create a local PostgreSQL database:**

```bash
createdb myproject_dev
echo "DATABASE_URL=postgresql://localhost/myproject_dev" >> .env
```

Or with Docker:

```bash
docker run -d --name postgres -e POSTGRES_PASSWORD=password -p 5432:5432 postgres:15
echo "DATABASE_URL=postgresql://postgres:password@localhost:5432/postgres" >> .env
```

## Running SQL Queries

Always use the Bash tool to run psql:

```bash
# SELECT query
psql "$DATABASE_URL" -c "SELECT * FROM users LIMIT 5"

# Create table
psql "$DATABASE_URL" -c "
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  )
"

# Insert data
psql "$DATABASE_URL" -c "INSERT INTO users (email) VALUES ('user@example.com')"

# Run from a SQL file
psql "$DATABASE_URL" -f migrations/001_initial.sql
```

For multi-line or complex queries, write a `.sql` file and run it with `-f`.

## Safety Rules

- **Development only**: Never run DROP, TRUNCATE, or destructive statements against production
- **Production**: Only run SELECT queries against production, never mutate
- **Backups**: `pg_dump "$DATABASE_URL" > backup.sql` before destructive operations

## Environment Variables

Store these in `.env` (never commit to git):

```
DATABASE_URL=postgresql://user:password@host:5432/dbname
PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=password
PGDATABASE=myproject
```

Load in shell: `export $(grep -v '^#' .env | xargs)`

## Example Workflow

```bash
# 1. Check connection
psql "$DATABASE_URL" -c "\conninfo"

# 2. Create schema
psql "$DATABASE_URL" -c "
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  )
"

# 3. Insert data
psql "$DATABASE_URL" -c "INSERT INTO users (email) VALUES ('test@example.com')"

# 4. Query data
psql "$DATABASE_URL" -c "SELECT * FROM users"
```
