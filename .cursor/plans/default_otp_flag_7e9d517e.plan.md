---
name: DEFAULT_OTP_FLAG
overview: "Split “send SMS” from “which code”: OTP_ENABLED controls whether 2Factor delivers; DEFAULT_OTP_FLAG chooses DEFAULT_OTP vs a freshly generated code when SMS is on."
todos:
  - id: otp-config-flag
    content: Add DEFAULT_OTP_FLAG to otp-config.ts + boot warn
    status: completed
  - id: auth-wire-flag
    content: Wire auth.ts send path for SMS + flag matrix
    status: completed
  - id: env-docs-flag
    content: Update .env / .env.example / DEPLOYMENT.md
    status: completed
  - id: tests-flag
    content: Extend otp-enabled tests for DEFAULT_OTP_FLAG
    status: completed
isProject: false
---

# Add DEFAULT_OTP_FLAG

## Behaviour matrix

| OTP_ENABLED | DEFAULT_OTP_FLAG | Code | SMS |
|-------------|------------------|------|-----|
| `true` | `true` | `DEFAULT_OTP` | Yes (2Factor) |
| `true` | `false` / unset | `generateOtpCode()` | Yes (2Factor) |
| `false` / unset | (ignored) | `DEFAULT_OTP` | No |

`OTP_TEST_NUMBERS` still wins first (fixed allow-list code, no SMS).

Unset `DEFAULT_OTP_FLAG` defaults to **false** (random when SMS is on) — safer for production.

## Code

1. **[`apps/api-server/src/lib/otp-config.ts`](apps/api-server/src/lib/otp-config.ts)**
   - Parse `DEFAULT_OTP_FLAG` with the same truthy helper (`1`/`true`/`yes`/`on`).
   - Export `isDefaultOtpFlag()` (or `useDefaultOtpCode()`).
   - Boot warn when `OTP_ENABLED=true` and `DEFAULT_OTP_FLAG=true` (fixed code going out over real SMS).
   - Reset the new memo in `_resetOtpConfig()`.

2. **[`apps/api-server/src/routes/auth.ts`](apps/api-server/src/routes/auth.ts)** send path — replace the current “liveOtp ⇒ keep random / else DEFAULT_OTP” with:

```ts
const liveSms = !testCode && isOtpEnabled();
if (!testCode) {
  if (!liveSms || isDefaultOtpFlag()) code = defaultOtpCode();
  // else keep generateOtpCode()
}
const deliverBySms = !!user && !testCode && liveSms;
```

3. **Env / docs**
   - [`apps/api-server/.env`](apps/api-server/.env) and [`.env.example`](apps/api-server/.env.example):

```env
OTP_ENABLED=true
DEFAULT_OTP_FLAG=false
DEFAULT_OTP=123456
```

   - Brief note in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

4. **Tests** in [`test/otp-enabled.test.ts`](apps/api-server/test/otp-enabled.test.ts)
   - `OTP_ENABLED=true` + `DEFAULT_OTP_FLAG=true` + `DEFAULT_OTP=654321` → verify succeeds with `654321` (mock SMS; no network).
   - `OTP_ENABLED=true` + `DEFAULT_OTP_FLAG=false` → verify with `DEFAULT_OTP` fails (random code).
   - Existing `OTP_ENABLED=false` cases unchanged.