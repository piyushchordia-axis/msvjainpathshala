# waf — WAFv2 with AWS Managed Common Rule Set + per-IP rate limit.

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

resource "aws_wafv2_web_acl" "this" {
  name        = "${var.name}-waf"
  scope       = "CLOUDFRONT"
  description = "${var.name} — Jain Pathshala WAF"

  default_action {
    allow {}
  }

  rule {
    name     = "AWS-Common"
    priority = 1
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"
      }
    }
    visibility_config {
      sampled_requests_enabled   = true
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-common"
    }
  }

  rule {
    name     = "rate-limit"
    priority = 100
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = var.rate_limit_per_5min
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      sampled_requests_enabled   = true
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-rate-limit"
    }
  }

  visibility_config {
    sampled_requests_enabled   = true
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.name}-waf"
  }

  tags = var.tags
}
