variable "name" {
  type = string
}

variable "region" {
  type    = string
  default = "ap-south-1"
}

variable "queue_group" {
  type        = string
  description = "Logical worker group: 'notifications', 'media', 'default', 'analytics'."
}

variable "cluster_id" {
  type = string
}

variable "cluster_name" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "task_security_group_id" {
  type = string
}

variable "image" {
  type = string
}

variable "cpu" {
  type    = number
  default = 512
}

variable "memory" {
  type    = number
  default = 1024
}

variable "desired_count" {
  type    = number
  default = 2
}

variable "max_count" {
  type    = number
  default = 20
}

variable "target_queue_depth_per_task" {
  type        = number
  description = "Target queue depth per task — autoscaler aims to keep depth at this value."
  default     = 500
}

variable "log_group_name" {
  type = string
}

variable "environment" {
  type    = map(string)
  default = {}
}

variable "secret_env" {
  type    = map(string)
  default = {}
}
