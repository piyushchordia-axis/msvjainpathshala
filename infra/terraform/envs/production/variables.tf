variable "region" {
  type    = string
  default = "ap-south-1"
}

variable "name" {
  type    = string
  default = "jp-prod"
}

variable "apex_domain" {
  type    = string
  default = "jainpathshala.org"
}

variable "route53_zone_id" {
  type        = string
  description = "Pre-existing hosted zone for jainpathshala.org"
}

variable "acm_us_east_1_certificate_arn" {
  type        = string
  description = "ACM cert in us-east-1 (CloudFront requires this region)."
}

variable "acm_regional_certificate_arn" {
  type        = string
  description = "ACM cert in the regional AWS region (var.region) for the ALB."
}

variable "image_tag" {
  type    = string
  default = "prod-latest"
}

variable "ecr_account_id" {
  type = string
}

variable "pagerduty_endpoint" {
  type      = string
  sensitive = true
  default   = ""
}
