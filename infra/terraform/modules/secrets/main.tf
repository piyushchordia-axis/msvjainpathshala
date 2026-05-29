# secrets — Secrets Manager entries + customer-managed KMS key.

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

resource "aws_kms_key" "secrets" {
  description             = "${var.name} — Secrets Manager KMS key"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  tags                    = var.tags
}

resource "aws_secretsmanager_secret" "this" {
  for_each   = toset(var.secret_names)
  name       = "${var.name}/${each.value}"
  kms_key_id = aws_kms_key.secrets.arn
  tags       = var.tags
}
