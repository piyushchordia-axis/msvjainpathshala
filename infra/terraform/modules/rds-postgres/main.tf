# rds-postgres — primary + replica, KMS encryption, PITR.

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
}

resource "aws_kms_key" "rds" {
  description             = "${var.name} — RDS KMS key (customer-managed)"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  tags                    = var.tags
}

resource "aws_db_subnet_group" "this" {
  name       = "${var.name}-rds"
  subnet_ids = var.subnet_ids
  tags       = var.tags
}

resource "aws_security_group" "rds" {
  name        = "${var.name}-rds"
  description = "RDS Postgres — inbound from app SGs only"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = var.app_security_group_ids
    description     = "Postgres from ECS tasks"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = var.tags
}

resource "random_password" "master" {
  length  = 32
  special = false
}

resource "aws_db_instance" "primary" {
  identifier        = "${var.name}-postgres"
  engine            = "postgres"
  engine_version    = var.engine_version
  instance_class    = var.instance_class
  allocated_storage = var.allocated_storage
  storage_type      = "gp3"
  storage_encrypted = true
  kms_key_id        = aws_kms_key.rds.arn

  db_name                = "jainpathshala"
  username               = "jp_master"
  password               = random_password.master.result
  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false

  backup_retention_period   = var.backup_retention_days
  backup_window             = "18:30-19:30"
  maintenance_window        = "sun:20:00-sun:21:00"
  delete_automated_backups  = false
  copy_tags_to_snapshot     = true
  deletion_protection       = true
  apply_immediately         = false
  performance_insights_enabled = true
  performance_insights_kms_key_id = aws_kms_key.rds.arn
  enabled_cloudwatch_logs_exports = ["postgresql"]
  multi_az = var.multi_az

  tags = var.tags
}

resource "aws_db_instance" "replica" {
  count               = var.create_replica ? 1 : 0
  identifier          = "${var.name}-postgres-read"
  replicate_source_db = aws_db_instance.primary.identifier
  instance_class      = var.replica_instance_class
  publicly_accessible = false
  vpc_security_group_ids = [aws_security_group.rds.id]
  storage_encrypted   = true
  kms_key_id          = aws_kms_key.rds.arn
  tags                = var.tags
  apply_immediately   = false
}
