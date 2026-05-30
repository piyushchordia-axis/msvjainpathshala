# @jp/mobile — Jain Pathshala mobile app (Expo SDK 52)

Expo + Expo Router v6 shell. Step 8 of the build; feature steps land
under `src/features/*` and per-role tabs under `app/(tabs)/<role>/`.

## Run

```bash
# 1. Start the backend (separate terminal)
pnpm --filter @jp/api dev

# 2. Copy env (default points at http://localhost:3000)
cp apps/mobile/.env.development.example apps/mobile/.env.development

# 3. Start Metro
pnpm --filter @jp/mobile dev
```

Then scan the printed QR with the Expo Go app (Android) or `i`/`a` in the
Metro CLI to open the iOS Simulator / Android emulator.

### Remote / tunnel preview (QR landing page on web)

```bash
# Terminal 1 — API
pnpm --filter @jp/api dev

# Terminal 2 — Metro via ngrok tunnel (writes apps/mobile/.expo-dev.json)
pnpm dev:tunnel

# Terminal 3 — Next.js (serves /expo on port 3001)
pnpm --filter @jp/web dev
```

Open **http://localhost:3001/expo** (or `https://pathshala.enaacreations.com/expo` behind nginx).
The page reads `apps/mobile/.expo-dev.json` (updated every few seconds while tunnel runs),
then falls back to Metro `/_expo/open` or `/manifest`, then `EXPO_TUNNEL_URL` if set.

## API base URL

`EXPO_PUBLIC_API_BASE_URL` is read by `src/api/client.ts`. Defaults:

| Target                   | URL                         |
| ------------------------ | --------------------------- |
| iOS Simulator            | `http://localhost:3000`     |
| Android emulator         | `http://10.0.2.2:3000`      |
| Physical device on Wi-Fi | `http://<your-mac-ip>:3000` |

## Smoke-test the auth round-trip

```bash
pnpm --filter @jp/api dev            # backend in one terminal
pnpm --filter @jp/mobile smoke:auth  # round-trips otp/send → verify → /me PATCH
```

## Directory layout

```
app/                       Expo Router file-based routes
├── _layout.tsx            Providers + fonts + offline banner
├── index.tsx              Splash → role-routing
├── (auth)/{phone,otp}.tsx Login flow
└── (tabs)/<role>/         One folder per role (8 total)
src/
├── api/                   axios client + endpoint wrappers
├── components/            Shared UI (jp-design-system components copied in)
├── constants/             Re-export of @jp/design-tokens
├── features/              Per-feature code (auth, language, …)
├── i18n/                  i18next init wired to @jp/i18n
├── storage/               MMKV stores: auth, profile, 4 queues, 4 caches
├── stores/                Zustand stores (network, sync, …)
├── sync/                  Sync engine + retry policy
└── theme/                 Navigation theme, tab styles, RN-shaped tokens
```

## Storage model (SPEC §11.1 subset)

| MMKV instance                | Purpose                              |
| ---------------------------- | ------------------------------------ |
| `jp.auth`                    | User snapshot + token TTLs           |
| `jp.profile`                 | preferred_language, last_login_phone |
| `jp.queue.attendance`        | Pending attendance ops               |
| `jp.queue.shivir_scans`      | Pending Shivir scans                 |
| `jp.queue.niyam_submissions` | Pending niyam submissions            |
| `jp.queue.acknowledgements`  | Pending notice acks                  |
| `jp.cache.batches`           | Batch roster snapshots               |
| `jp.cache.students`          | Student snapshots                    |
| `jp.cache.curriculum`        | Curriculum snapshots                 |
| `jp.cache.library`           | Library item snapshots               |

Refresh tokens live in `expo-secure-store` (not MMKV). Access tokens are
held in memory only — cold restart triggers a silent refresh.
