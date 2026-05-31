#!/bin/sh
# Bootstrap the four Jain Pathshala buckets in MinIO (Step 11).
#
# Buckets (SPEC §10.4):
#   jp-dev-media-private   — private user-uploaded media
#   jp-dev-media-public    — library + ID card public assets
#   jp-dev-exports         — ephemeral PDFs / ZIPs (lifecycle ≤ 30 d)
#   jp-dev-receipts        — donation receipts + 80G certs (lifecycle ≥ 7 y)
#
# Policies:
#   - PUBLIC bucket: download (read) policy attached to anonymous principals
#                    so signed URLs aren't needed for library + ID cards.
#   - All other buckets remain private — access only via presigned URLs.
#
# This runs as a one-shot init container in docker-compose; idempotent
# (ignore-already-exists semantics for both mb and policy attach).

set -eu

MINIO_HOST="${MINIO_HOST:-http://minio:9000}"
MINIO_ROOT_USER="${MINIO_ROOT_USER:-minioadmin}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-minioadmin}"

PRIVATE="${S3_BUCKET_PRIVATE:-jp-dev-media-private}"
PUBLIC="${S3_BUCKET_PUBLIC:-jp-dev-media-public}"
EXPORTS="${S3_BUCKET_EXPORTS:-jp-dev-exports}"
RECEIPTS="${S3_BUCKET_RECEIPTS:-jp-dev-receipts}"

echo "[minio-bootstrap] waiting for $MINIO_HOST"
i=0
until /usr/bin/mc alias set jp "$MINIO_HOST" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    echo "[minio-bootstrap] timed out waiting for MinIO" >&2
    exit 1
  fi
  sleep 1
done
echo "[minio-bootstrap] MinIO ready"

for bucket in "$PRIVATE" "$PUBLIC" "$EXPORTS" "$RECEIPTS"; do
  if /usr/bin/mc ls "jp/$bucket" >/dev/null 2>&1; then
    echo "[minio-bootstrap] bucket exists: $bucket"
  else
    echo "[minio-bootstrap] creating bucket: $bucket"
    /usr/bin/mc mb "jp/$bucket"
  fi
done

# Public bucket — make objects readable without a signed URL so the mobile /
# web apps can render <img src="..."/> directly.
echo "[minio-bootstrap] applying public download policy to $PUBLIC"
/usr/bin/mc anonymous set download "jp/$PUBLIC" >/dev/null 2>&1 || \
  echo "[minio-bootstrap] WARN: could not set public policy on $PUBLIC"

echo "[minio-bootstrap] done"
