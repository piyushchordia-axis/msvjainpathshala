output "cluster_id" {
  value = aws_ecs_cluster.this.id
}

output "cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "task_security_group_id" {
  value = aws_security_group.tasks.id
}

output "log_group_names" {
  value = { for k, v in aws_cloudwatch_log_group.service : k => v.name }
}
