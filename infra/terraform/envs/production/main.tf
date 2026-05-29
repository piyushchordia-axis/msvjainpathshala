# Production environment composition (SPEC §18.5).

locals {
  ecr_base = "${var.ecr_account_id}.dkr.ecr.${var.region}.amazonaws.com"
}

module "vpc" {
  source            = "../../modules/vpc"
  name              = var.name
  region            = var.region
  cidr              = "10.30.0.0/16"
  enable_nat_per_az = true # production — HA NAT per AZ
}

module "secrets" {
  source = "../../modules/secrets"
  name   = "jp/prod"
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
  instance_class         = "db.m6g.large"
  replica_instance_class = "db.m6g.large"
  multi_az               = true
  create_replica         = true
  backup_retention_days  = 30
  allocated_storage      = 200
}

module "redis" {
  source                 = "../../modules/elasticache-redis"
  name                   = var.name
  vpc_id                 = module.vpc.vpc_id
  subnet_ids             = module.vpc.isolated_subnet_ids
  app_security_group_ids = [module.ecs_cluster.task_security_group_id]
  node_type              = "cache.m6g.large"
  num_replicas           = 1
}

module "alb" {
  source            = "../../modules/alb"
  name              = var.name
  vpc_id            = module.vpc.vpc_id
  public_subnet_ids = module.vpc.public_subnet_ids
  certificate_arn   = var.acm_regional_certificate_arn
  api_hostnames     = ["api.jainpathshala.org"]
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
  web_aliases           = ["jainpathshala.org", "www.jainpathshala.org", "admin.jainpathshala.org"]
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
  desired_count          = 4
  max_count              = 30
  log_group_name         = module.ecs_cluster.log_group_names["api"]
  region                 = var.region
  secret_arns            = values(module.secrets.secret_arns)
}

# Worker groups per SPEC §18.5: notifications, media, default.
module "worker_notifications" {
  source                  = "../../modules/ecs-service-worker"
  name                    = var.name
  queue_group             = "notifications"
  cluster_id              = module.ecs_cluster.cluster_id
  cluster_name            = module.ecs_cluster.cluster_name
  subnet_ids              = module.vpc.private_subnet_ids
  task_security_group_id  = module.ecs_cluster.task_security_group_id
  image                   = "${local.ecr_base}/jp-worker:${var.image_tag}"
  desired_count           = 2
  max_count               = 20
  log_group_name          = module.ecs_cluster.log_group_names["worker"]
  region                  = var.region
  target_queue_depth_per_task = 500
}

module "worker_media" {
  source                  = "../../modules/ecs-service-worker"
  name                    = var.name
  queue_group             = "media"
  cluster_id              = module.ecs_cluster.cluster_id
  cluster_name            = module.ecs_cluster.cluster_name
  subnet_ids              = module.vpc.private_subnet_ids
  task_security_group_id  = module.ecs_cluster.task_security_group_id
  image                   = "${local.ecr_base}/jp-worker:${var.image_tag}"
  desired_count           = 1
  max_count               = 10
  log_group_name          = module.ecs_cluster.log_group_names["worker"]
  region                  = var.region
  target_queue_depth_per_task = 100
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
  desired_count           = 2
  max_count               = 8
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
  desired_count          = 2
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
  pagerduty_endpoint              = var.pagerduty_endpoint
  alb_id_short                    = module.alb.alb_arn
  db_instance_id                  = "${var.name}-postgres"
  db_max_connections              = 300
  db_storage_low_threshold_bytes  = 40000000000
}

output "alb_dns_name" {
  value = module.alb.alb_dns_name
}

output "cloudfront_domain" {
  value = module.cloudfront.web_distribution_domain
}
