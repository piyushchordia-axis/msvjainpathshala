# Grafana dashboards + PagerDuty alerts

This directory holds the provisioned-as-code Grafana configuration referenced
in SPEC §18.10 / Step 23. Two sub-folders:

- `dashboards/*.json` — Grafana dashboard JSON (importable via Grafana UI or
  the provisioning API).
- `alerts/pagerduty-rules.yaml` — Grafana Unified-Alerting rule definitions
  that emit to the `pagerduty` contact point. The PagerDuty integration
  key is loaded from AWS Secrets Manager at terraform apply time.

## Datasources expected

| Name         | Type         | URL hint                    |
| ------------ | ------------ | --------------------------- |
| `cloudwatch` | CloudWatch   | (uses task role)            |
| `loki`       | Grafana Loki | grafana-loki.internal:3100  |
| `prometheus` | Prometheus   | grafana-tempo.internal:9090 |

## Adding a panel

1. Edit the dashboard JSON.
2. `grafana-cli` or the provisioning API can pick it up automatically when
   the file changes (configured via `grafana.ini → [provisioning]`).
3. Open the dashboard in Grafana, click "Make changes", then "Save JSON
   model" to re-export.

## Reviewing alerts

Every alert rule must reference one of the runbooks under `docs/runbooks/`.
The runbook URL is interpolated into the PagerDuty incident details so the
responder can jump straight to mitigation steps.
