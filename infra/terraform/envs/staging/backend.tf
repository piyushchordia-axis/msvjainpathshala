# Remote state for staging. Populate via:
#   terraform init -backend-config="bucket=jp-tfstate-staging" \
#                  -backend-config="key=staging/terraform.tfstate" \
#                  -backend-config="region=ap-south-1" \
#                  -backend-config="dynamodb_table=jp-tfstate-lock"

terraform {
  backend "s3" {}
}
