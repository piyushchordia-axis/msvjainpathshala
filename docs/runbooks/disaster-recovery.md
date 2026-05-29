# Runbook — Disaster recovery (region failover)

## 1. When this fires

Full ap-south-1 regional outage. We failover to **ap-southeast-1**
(Singapore) which holds:

- A cross-region RDS read replica (replication lag < 15 min — RPO).
- A versioned S3 replica of media buckets.
- Cold ECS service definitions ready to scale up.

Target **RTO: 4 hours.** Target **RPO: 15 minutes.**

## 2. Severity

**sev1.** Coordinate via the on-call captain. Engage AWS support immediately.

## 3. Pre-conditions

- AWS Health Dashboard confirms regional impairment, OR
- The decision to evacuate is made by the on-call captain after 30 min of
  unrecovered impairment in ap-south-1.

## 4. Procedure (45-minute checkpoints)

### T+0 — Decision

- On-call captain announces in #ops-incident.
- Status page set to "Major outage — disaster recovery in progress".
- All ECS scale actions in ap-south-1 paused.

### T+15 — Activate ap-southeast-1

1. **Promote the cross-region RDS replica**:
   ```bash
   aws --region ap-southeast-1 rds promote-read-replica \
     --db-instance-identifier jp-dr-postgres
   ```
2. **Update Secrets Manager (DR region)**:
   - `jp/prod/database/master.url` → ap-southeast-1 endpoint.
3. **Scale ECS services**:
   ```bash
   for svc in jp-api jp-worker-notifications jp-worker-media \
              jp-worker-default jp-web jp-ai; do
     aws --region ap-southeast-1 ecs update-service \
       --cluster jp-prod-dr --service ${svc}-prod \
       --desired-count $(aws --region ap-south-1 ecs describe-services \
         --cluster jp-prod --services ${svc}-prod \
         --query 'services[0].desiredCount' --output text)
   done
   ```

### T+90 — DNS cutover

1. Update Route53 weighted records to route 100% traffic to the DR ALB:
   ```bash
   aws route53 change-resource-record-sets \
     --hosted-zone-id $HOSTED_ZONE \
     --change-batch file://infra/terraform/dr-failover.json
   ```
2. CloudFront origin shield: switch to ap-southeast-1.

### T+180 — Validation

1. `bash infra/smoke-tests/prod-smoke.sh https://api.jainpathshala.org` should pass.
2. Smoke test mobile + web via real devices.
3. Confirm push notifications still deliver (FCM is global).

### T+240 — RTO checkpoint

- If we have not validated by 4 hours, escalate to AWS premium support.
- Communicate user-visible status updates every 30 min.

## 5. Failback (when ap-south-1 recovers)

⚠️ Failback can wait — only attempt when traffic is < 50% of peak.

1. Set ap-south-1 RDS as a new read replica of the DR primary.
2. Wait until replication lag < 1 minute for 2 hours stable.
3. Schedule a maintenance window. Promote ap-south-1 back to primary, demote DR.
4. Update Route53 to route traffic back. Drain ap-southeast-1.

## 6. Post-mortem checklist

- Capture actual RTO + RPO achieved.
- Identify any data divergence (write-then-read inconsistencies) during cutover.
- File AWS Trusted Advisor follow-ups.
- Send transparency update to user community.
