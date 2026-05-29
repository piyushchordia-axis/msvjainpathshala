# ses — SES domain identity for outbound email (Resend is primary; SES is
# the fallback when Resend is unavailable).

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

resource "aws_ses_domain_identity" "this" {
  domain = var.domain
}

resource "aws_route53_record" "txt_verification" {
  zone_id = var.zone_id
  name    = "_amazonses.${var.domain}"
  type    = "TXT"
  ttl     = 600
  records = [aws_ses_domain_identity.this.verification_token]
}

resource "aws_ses_domain_dkim" "this" {
  domain = aws_ses_domain_identity.this.domain
}

resource "aws_route53_record" "dkim" {
  count   = 3
  zone_id = var.zone_id
  name    = "${aws_ses_domain_dkim.this.dkim_tokens[count.index]}._domainkey.${var.domain}"
  type    = "CNAME"
  ttl     = 600
  records = ["${aws_ses_domain_dkim.this.dkim_tokens[count.index]}.dkim.amazonses.com"]
}
