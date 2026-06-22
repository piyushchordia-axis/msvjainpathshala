# Deploying the API with Docker (host Postgres + Redis, behind nginx)

The API server is packaged as a slim single-container image that connects to the
**host's existing Postgres and Redis** and sits behind the **host's nginx**.

- Image: `node:22-alpine` + the esbuild bundle + `sharp` (only native dep). ~**326 MB**.
- Binds **127.0.0.1:8080** inside the host network — nginx terminates TLS and proxies in. Port 8080 is never exposed publicly.
- Uploads persist on a named volume (`jp_uploads`). Switch to S3 only if you scale past one instance.

## 1. DNS

Add **one A record** (the mobile app + stores point here):

| Host | Type | Value |
|---|---|---|
| `jainpathshala.enaacreations.com` | A | `<your server's public IP>` |

(Only add `admin.jainpathshala.enaacreations.com` later if you also host the web admin SPA — it's separate and not needed for the mobile backend.)

## 2. Database (one-time)

Create the DB + user on the host Postgres, then apply the schema. Migrations are
**not** run by the container — apply them from the repo once (and on each schema change):

```bash
createdb jainpathshala            # or CREATE DATABASE + a least-privilege user
# from the repo, against the production DB:
DATABASE_URL=postgres://USER:PASS@localhost:5432/jainpathshala \
  pnpm --filter @workspace/db run migrate
```

## 3. Configure + run

```bash
cp apps/api-server/.env.example apps/api-server/.env
#   fill in: DATABASE_URL, REDIS_URL, JP_AUTH_SECRET (openssl rand -base64 48),
#   PUBLIC_API_URL=https://jainpathshala.enaacreations.com, RAZORPAY_* (required).
docker compose up -d --build
docker compose logs -f          # expect: "Server listening" host 127.0.0.1
curl -s http://127.0.0.1:8080/api/healthz     # {"status":"ok"}
```

`network_mode: host` means the container reaches Postgres/Redis on `localhost`
exactly as any host process would — no Docker networking or `pg_hba` changes needed.

## 4. nginx reverse proxy + TLS

```nginx
server {
    listen 80;
    server_name jainpathshala.enaacreations.com;
    client_max_body_size 25m;          # ID photos / gallery uploads

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;   # app trusts this 1 hop
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d jainpathshala.enaacreations.com   # free Let's Encrypt TLS
```

After this, `https://jainpathshala.enaacreations.com/privacy` and `/support` are
live — which unblocks the Play privacy-policy requirement and the App Store
support/privacy URLs, and the mobile app can reach the API.

## Updating

```bash
git pull
docker compose up -d --build      # rebuild + restart, ~zero downtime on restart
```

## Notes
- **Razorpay keys are required in production** — the server refuses to start without `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` (the donations feature). Use real keys or a test pair to start.
- Memory footprint: the Node API idles around ~80–150 MB RSS. The bulk of the *image* size is `sharp`/libvips (image rendering for QR + ID cards) — unavoidable for those features.
- macOS/Windows Docker Desktop: `network_mode: host` maps to the Linux VM, not your real host — this compose is meant for the Linux server. (Locally it was verified via `host.docker.internal`.)
