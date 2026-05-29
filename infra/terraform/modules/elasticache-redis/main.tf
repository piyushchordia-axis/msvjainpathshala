# elasticache-redis — Redis 7 (single replication group, in-transit TLS, AUTH).

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.0" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
}

resource "aws_elasticache_subnet_group" "this" {
  name       = "${var.name}-redis"
  subnet_ids = var.subnet_ids
  tags       = var.tags
}

resource "aws_security_group" "redis" {
  name        = "${var.name}-redis"
  description = "Redis — inbound from app SGs only"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = var.app_security_group_ids
    description     = "Redis from ECS tasks"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = var.tags
}

resource "random_password" "auth" {
  length  = 64
  special = false
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id        = "${var.name}-redis"
  description                 = "${var.name} Redis"
  engine                      = "redis"
  engine_version              = var.engine_version
  node_type                   = var.node_type
  num_cache_clusters          = var.num_replicas + 1
  port                        = 6379
  subnet_group_name           = aws_elasticache_subnet_group.this.name
  security_group_ids          = [aws_security_group.redis.id]
  automatic_failover_enabled  = var.num_replicas > 0
  transit_encryption_enabled  = true
  at_rest_encryption_enabled  = true
  auth_token                  = random_password.auth.result
  snapshot_retention_limit    = var.snapshot_retention
  snapshot_window             = "02:00-03:00"
  maintenance_window          = "sun:04:00-sun:05:00"
  parameter_group_name        = "default.redis7"
  apply_immediately           = false
  tags                        = var.tags
}
