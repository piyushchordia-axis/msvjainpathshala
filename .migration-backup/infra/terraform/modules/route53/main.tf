# route53 — apex + admin + api + media subdomain records.

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

resource "aws_route53_record" "apex" {
  zone_id = var.zone_id
  name    = var.apex_domain
  type    = "A"
  alias {
    name                   = var.web_cloudfront_domain
    zone_id                = "Z2FDTNDATAQYW2" # CloudFront
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "www" {
  zone_id = var.zone_id
  name    = "www.${var.apex_domain}"
  type    = "A"
  alias {
    name                   = var.web_cloudfront_domain
    zone_id                = "Z2FDTNDATAQYW2"
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "admin" {
  zone_id = var.zone_id
  name    = "admin.${var.apex_domain}"
  type    = "A"
  alias {
    name                   = var.web_cloudfront_domain
    zone_id                = "Z2FDTNDATAQYW2"
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "api" {
  zone_id = var.zone_id
  name    = "api.${var.apex_domain}"
  type    = "A"
  alias {
    name                   = var.alb_dns_name
    zone_id                = var.alb_zone_id
    evaluate_target_health = true
  }
}
