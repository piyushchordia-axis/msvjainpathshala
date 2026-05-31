# Runbook — Payment gateway (Razorpay) outage

## 1. When this fires

- Razorpay 5xx > 20% on `POST /v1/donations/order`.
- Donor reports of "Payment failed".

## 2. Severity

**sev2.** Donation flows are blocked; in-app features unaffected.

## 3. Detection

- Grafana → Platform Health → "Razorpay error rate".
- Razorpay dashboard incident feed.
- Loki: `{service="api"} |= "razorpay"`.

## 4. Mitigation

1. Confirm via Razorpay status page: <https://status.razorpay.com>.
2. Switch the donation form to "Bank transfer" instructions:
   - `super_admin` → Settings → Donations → toggle "Bank transfer fallback"
     ON. UI hides Razorpay button and shows IFSC/account details.
3. Webhook handler tolerates 5xx — Razorpay retries automatically once
   they recover. **Do NOT** manually replay webhooks; that risks
   double-receipts.
4. Capture any donations that landed in `donations.status='created'` but
   never reached `paid` — those will reconcile once Razorpay sends the
   delayed webhook.

## 5. Validation

- Test donation of ₹1 succeeds end-to-end (test-mode keys).
- Webhook payload arrives within 60s and donation status becomes `paid`.

## 6. Post-mortem checklist

- List donors who attempted payment during the window — send an
  apology + retry link via the bulk-email tool.
- Confirm idempotency: no donation has a double-receipt.
- Verify 80G certificate generation only fired once per donation.
