output "web_distribution_id" {
  value = aws_cloudfront_distribution.web.id
}

output "web_distribution_domain" {
  value = aws_cloudfront_distribution.web.domain_name
}
