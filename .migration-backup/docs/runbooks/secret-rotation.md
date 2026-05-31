# Runbook — Secret rotation

## 1. When this fires

- Quarterly cadence for JWT keys.
- Bi-annual cadence for DB master password.
- On-demand for any third-party API key (MSG91, FCM, Resend, Razorpay,
  OpenAI) after a vendor-side incident or a personnel change.

## 2. Severity

Planned (not an incident). Unrotated secrets are a sev3 over time.

## 3. Procedure — JWT key rotation (zero-downtime)

The JwtService accepts both the current and previous public keys for a
24-hour grace window. Rotation steps:

1. **Generate a fresh keypair** (locally; never via a shared workstation):
   ```bash
   openssl genrsa -out private.pem 2048
   openssl rsa -in private.pem -pubout -out public.pem
   ```
2. **Upload to Secrets Manager** (DEV/STAGING first, then PROD):
   ```bash
   aws secretsmanager update-secret \
     --secret-id jp/prod/jwt/keys \
     --secret-string "$(jq -n \
       --arg priv "$(cat private.pem)" \
       --arg pub "$(cat public.pem)" \
       --arg prev "$(aws secretsmanager get-secret-value \
         --secret-id jp/prod/jwt/keys --query SecretString --output text \
         | jq -r .public_pem)" \
       --arg ts "$(date -u +%FT%TZ)" \
       '{private_pem:$priv, public_pem:$pub, previous_public_pem:$prev, rotated_at:$ts}')"
   ```
3. **Force-redeploy ECS services** so the new key is loaded:
   ```bash
   aws ecs update-service --cluster jp-prod --service jp-api-prod \
     --force-new-deployment
   ```
4. **Verify**:
   - Mint a new token via login flow.
   - Old tokens still validate for 24 hours.
   - At T+24h, run a follow-up rotation that drops `previous_public_pem`.
5. **Securely destroy the OLD private key** (shred + remove from your machine).

## 4. Procedure — DB master password rotation

Use RDS managed rotation when possible:

```bash
aws rds modify-db-instance \
  --db-instance-identifier jp-prod-postgres \
  --master-user-password "$(openssl rand -base64 32)" \
  --apply-immediately
```

Then update `jp/prod/database/master` in Secrets Manager and force-redeploy
ECS services.

## 5. Procedure — third-party API keys

1. Generate a new key in the vendor portal.
2. Update Secrets Manager.
3. Force-redeploy the matching ECS service.
4. Confirm the next outbound call succeeds.
5. Revoke the old key in the vendor portal.

## 6. Validation

- `pnpm --filter @jp/api exec tsx scripts/verify-secret-rotation.ts` — a
  self-test that issues a JWT, verifies, refreshes, hits an external API,
  and reports the kid + key fingerprint used.
