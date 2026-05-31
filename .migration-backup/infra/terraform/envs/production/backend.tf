# Remote state for production. Populate via:
#   terraform init -backend-config="bucket=jp-tfstate-production" \
#                  -backend-config="key=production/terraform.tfstate" \
#                  -backend-config="region=ap-south-1" \
#                  -backend-config="dynamodb_table=jp-tfstate-lock"

terraform {
  backend "s3" {}
}
