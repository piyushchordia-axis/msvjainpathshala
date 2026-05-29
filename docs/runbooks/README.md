# Operational runbooks

Each runbook follows a uniform shape so on-call engineers can scan them quickly under pressure.

```
1. When this fires       — symptoms / alert that triggered the runbook
2. Severity              — sev1/sev2/sev3 + business impact
3. Detection             — dashboard panels, alert names, log queries
4. Mitigation            — ordered steps; ⚠️ irreversible steps tagged
5. Validation            — how to confirm mitigation succeeded
6. Post-mortem checklist — what to capture before closing the incident
```

If you add a runbook, link it here and add the matching Grafana alert to
`infra/grafana/alerts/pagerduty-rules.yaml` so the alert payload includes
the runbook URL.

## Index

| Runbook                                                      | Severity  | Trigger                                       |
| ------------------------------------------------------------ | --------- | --------------------------------------------- |
| [otp-outage.md](./otp-outage.md)                             | sev1      | MSG91 5xx rate > 50% for 5 min                |
| [push-notification-outage.md](./push-notification-outage.md) | sev2      | FCM rejection > 50% for 10 min                |
| [payment-gateway-outage.md](./payment-gateway-outage.md)     | sev2      | Razorpay order-create error rate > 20%        |
| [database-failover.md](./database-failover.md)               | sev1      | RDS primary unreachable                       |
| [runaway-bullmq-queue.md](./runaway-bullmq-queue.md)         | sev2      | Any queue waiting > 10k for 5 min             |
| [leaderboard-drift.md](./leaderboard-drift.md)               | sev2      | `punya.reconcile` flagged drift > 10 students |
| [security-incident.md](./security-incident.md)               | sev1      | confirmed breach / suspected compromise       |
| [backup-verification.md](./backup-verification.md)           | (planned) | monthly drill                                 |
| [disaster-recovery.md](./disaster-recovery.md)               | sev1      | full region outage                            |
| [dlq-replay.md](./dlq-replay.md)                             | (planned) | DLQ size > 100 for any queue                  |
| [secret-rotation.md](./secret-rotation.md)                   | (planned) | quarterly rotation                            |
| [cost-spike.md](./cost-spike.md)                             | sev3      | AWS Budget alarm at 80% forecast              |
| [data-correction-protocol.md](./data-correction-protocol.md) | (planned) | bad data write needs forward correction       |
