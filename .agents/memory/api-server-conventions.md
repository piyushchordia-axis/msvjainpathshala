---
name: api-server conventions
description: Runtime/port, web↔api proxy wiring, response envelope, and auth login shape for the Jain Pathshala api-server.
---

# API server runtime, proxy, envelope & auth shape

- **Port**: the api-server binds to the `PORT` env (8080 in dev), NOT 5000 as older docs claimed. Smoke-test against `http://localhost:8080`.
- **Web↔API proxy**: `artifacts/jain-pathshala/vite.config.ts` proxies `/api` and `/v1` to `VITE_API_BASE_URL || http://localhost:8080`. Public pages use root-relative `fetch('/v1/...')` and rely on this proxy. `VITE_API_BASE_URL` empty = same-origin.
- **Web build env**: `vite.config.ts` throws unless both `PORT` and `BASE_PATH` are set. To build locally: `PORT=3000 BASE_PATH=/ pnpm --filter @workspace/jain-pathshala run build`.

## Response envelope (single wrap)
Backend standardizes on a single `{data, meta}` envelope (success) / `{error:{code,message,details}}` (failure).
- `apiGet`/`apiPost` in `src/lib/api-client.ts` unwrap exactly ONE `data` layer.
- **Why:** earlier confusion came from double-wrapping. Admin pages must read the already-unwrapped shape (e.g. `res.items`, not `res.data.items`); LoginPage reads `res.otp_token` directly.
- **How to apply:** never double-wrap on the server, and never re-unwrap `.data` again in pages that already use `apiGet/apiPost`.

## Auth login endpoint
Single endpoint `POST /api/auth/login` is a Zod discriminated union on key **`phase`** (`"send"` | `"verify"`), NOT `action`.
- send: `{phase:"send", phone}` → returns `{data:{otp_token, expires_in_seconds, dev_code?}}`. `dev_code` only present for registered phones in non-prod (no real SMS).
- verify: `{phase:"verify", otp_token, code, device_id}` → 6-char code required, sets cookies.
- **Why:** OTP dev flow returns the code instead of sending SMS; phone must be seeded to receive a code.
