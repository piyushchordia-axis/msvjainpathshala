# Staging environment composition.
#
# This file wires every module together. Per the user-question scope locked
# during planning, this is authored IaC + `terraform validate` only — no
# `terraform apply` against an AWS account is expected as part of Step 23.

locals {
  ecr_base = "${var.ecr_account_id}.dkr.ecr.${var.region}.amazonaws.com"
}

module "vpc" {
  source            = "../../modules/vpc"
  name              = var.name
  region            = var.region
  cidr              = "10.20.0.0/16"
  enable_nat_per_az = false  # staging — one NAT GW is enough
}

module "secrets" {
  source = "../../modules/secrets"
  name   = "jp/staging"
}

module "ecs_cluster" {
  source = "../../modules/ecs-cluster"
  name   = var.name
  vpc_id = module.vpc.vpc_id
}

module "s3" {
  source = "../../modules/s3-buckets"
  name   = var.name
}

module "rds" {
  source                 = "../../modules/rds-postgres"
  name                   = var.name
  vpc_id                 = module.vpc.vpc_id
  subnet_ids             = module.vpc.isolated_subnet_ids
  app_security_group_ids = [module.ecs_cluster.task_security_group_id]
  instance_class         = "db.t4g.medium"
  replica_instance_class = "db.t4g.medium"
  multi_az               = false  # staging
  create_replica         = false
  backup_retention_days  = 7
}

module "redis" {
  source                 = "../../modules/elasticache-redis"
  name                   = var.name
  vpc_id                 = module.vpc.vpc_id
  subnet_ids             = module.vpc.isolated_subnet_ids
  app_security_group_ids = [module.ecs_cluster.task_security_group_id]
  node_type              = "cache.t4g.small"
  num_replicas           = 0  # staging
}

module "alb" {
  source            = "../../modules/alb"
  name              = var.name
  vpc_id            = module.vpc.vpc_id
  public_subnet_ids = module.vpc.public_subnet_ids
  certificate_arn   = var.acm_regional_certificate_arn
  api_hostnames     = ["staging-api.jainpathshala.org"]
}

module "waf" {
  source              = "../../modules/waf"
  name                = var.name
  rate_limit_per_5min = 2000
}

module "cloudfront" {
  source                = "../../modules/cloudfront"
  name                  = var.name
  web_origin_domain     = module.alb.alb_dns_name
  web_aliases           = ["staging.jainpathshala.org", "staging-admin.jainpathshala.org"]
  acm_certificate_arn   = var.acm_us_east_1_certificate_arn
  web_acl_arn           = module.waf.web_acl_arn
  origin_shield_region  = var.region
}

module "route53" {
  source                = "../../modules/route53"
  zone_id               = var.route53_zone_id
  apex_domain           = var.apex_domain
  web_cloudfront_domain = module.cloudfront.web_distribution_domain
  alb_dns_name          = module.alb.alb_dns_name
  alb_zone_id           = module.alb.alb_zone_id
}

module "ses" {
  source  = "../../modules/ses"
  domain  = var.apex_domain
  zone_id = var.route53_zone_id
}

module "api" {
  source                 = "../../modules/ecs-service-api"
  name                   = var.name
  cluster_id             = module.ecs_cluster.cluster_id
  cluster_name           = module.ecs_cluster.cluster_name
  subnet_ids             = module.vpc.private_subnet_ids
  task_security_group_id = module.ecs_cluster.task_security_group_id
  target_group_arn       = module.alb.api_target_group_arn
  image                  = "${local.ecr_base}/jp-api:${var.image_tag}"
  desired_count          = 2
  max_count              = 6
  log_group_name         = module.ecs_cluster.log_group_names["api"]
  region                 = var.region
  secret_arns            = values(module.secrets.secret_arns)
}

module "worker_default" {
  source                  = "../../modules/ecs-service-worker"
  name                    = var.name
  queue_group             = "default"
  cluster_id              = module.ecs_cluster.cluster_id
  cluster_name            = module.ecs_cluster.cluster_name
  subnet_ids              = module.vpc.private_subnet_ids
  task_security_group_id  = module.ecs_cluster.task_security_group_id
  image                   = "${local.ecr_base}/jp-worker:${var.image_tag}"
  desired_count           = 1
  max_count               = 4
  log_group_name          = module.ecs_cluster.log_group_names["worker"]
  region                  = var.region
  target_queue_depth_per_task = 1000
}

module "web" {
  source                 = "../../modules/ecs-service-web"
  name                   = var.name
  cluster_id             = module.ecs_cluster.cluster_id
  subnet_ids             = module.vpc.private_subnet_ids
  task_security_group_id = module.ecs_cluster.task_security_group_id
  target_group_arn       = module.alb.web_target_group_arn
  image                  = "${local.ecr_base}/jp-web:${var.image_tag}"
  desired_count          = 1
  log_group_name         = module.ecs_cluster.log_group_names["web"]
  region                 = var.region
}

module "ai" {
  source                              = "../../modules/ecs-service-ai"
  name                                = var.name
  vpc_id                              = module.vpc.vpc_id
  cluster_id                          = module.ecs_cluster.cluster_id
  subnet_ids                          = module.vpc.private_subnet_ids
  allowed_caller_security_group_ids   = [module.ecs_cluster.task_security_group_id]
  image                               = "${local.ecr_base}/jp-ai:${var.image_tag}"
  desired_count                       = 1
  log_group_name                      = module.ecs_cluster.log_group_names["ai"]
  region                              = var.region
}

module "monitoring" {
  source                          = "../../modules/monitoring"
  name                            = var.name
  alb_id_short                    = module.alb.alb_arn
  db_instance_id                  = "${var.name}-postgres"
  db_max_connections              = 100
  db_storage_low_threshold_bytes  = 20000000000
}

output "alb_dns_name" {
  value = module.alb.alb_dns_name
}

output "cloudfront_domain" {
  value = module.cloudfront.web_distribution_domain
}
