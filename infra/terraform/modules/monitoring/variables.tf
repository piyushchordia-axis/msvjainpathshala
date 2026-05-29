variable "name" {
  type = string
}

variable "pagerduty_endpoint" {
  type        = string
  description = "PagerDuty Events API URL, e.g. https://events.pagerduty.com/integration/..."
  default     = ""
}

variable "alb_id_short" {
  type        = string
  description = "ALB short id (app/load-balancer-name/uuid form for CloudWatch dimension)."
}

variable "db_instance_id" {
  type = string
}

variable "db_max_connections" {
  type    = number
  default = 100
}

variable "db_storage_low_threshold_bytes" {
  type    = number
  default = 20000000000  # 20 GB
}

variable "tags" {
  type    = map(string)
  default = {}
}
