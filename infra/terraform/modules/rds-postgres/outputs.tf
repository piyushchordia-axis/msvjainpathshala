output "endpoint" {
  value = aws_db_instance.primary.endpoint
}

output "read_endpoint" {
  value = try(aws_db_instance.replica[0].endpoint, null)
}

output "security_group_id" {
  value = aws_security_group.rds.id
}

output "master_password" {
  value     = random_password.master.result
  sensitive = true
}

output "kms_key_arn" {
  value = aws_kms_key.rds.arn
}
