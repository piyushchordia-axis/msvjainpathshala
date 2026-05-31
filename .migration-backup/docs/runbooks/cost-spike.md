# Runbook — Cost spike

## 1. When this fires

- AWS Budgets alert at 80% of monthly forecast.
- Daily cost report (`#ops-costs`) shows a delta > 2× the prior day.

## 2. Severity

**sev3.** Not user-facing but a runaway bill is a real cost.

## 3. Detection

- AWS Cost Explorer → group by Service / Tag.
- Grafana → Cost Tracker dashboard (provisioned in `infra/grafana/dashboards/cost-tracker.json`).
- Slack `#ops-costs` daily digest.

## 4. Procedure

1. **Identify the culprit service** in Cost Explorer:
   - RDS spike → look for slow queries holding connections (see
     `database-failover.md`) OR an unwanted long-running export job.
   - S3/R2 spike → check `media.processing` queue for runaway thumbnail
     generation; check egress (R2 is zero-egress so a spike points to S3).
   - ECS spike → likely a worker stuck spinning up beyond max tasks; check
     auto-scaling alarms.
   - CloudFront spike → confirm whether public traffic actually grew.
2. **Throttle or cap** the culprit:
   - Disable an offending feature flag (e.g. AI quiz generation if OpenAI
     spend exploded).
   - Reduce ECS max task count temporarily.
   - For media, pause `media.processing` if you find a infinite-loop in the
     processor (then file a critical bug).
3. **Communicate** in #ops the action taken and ETA to investigation.

## 5. Validation

- 24h spend returns to baseline.
- Cost Explorer projection drops below 80%.

## 6. Post-mortem checklist

- Identify whether reserved capacity / savings plans would have absorbed
  the spike.
- File a budget-burndown plan for the rest of the month.
- Consider adjusting AWS Budgets thresholds if they fired too late.
