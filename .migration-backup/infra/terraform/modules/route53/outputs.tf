output "apex_record_fqdn" {
  value = aws_route53_record.apex.fqdn
}

output "api_record_fqdn" {
  value = aws_route53_record.api.fqdn
}
