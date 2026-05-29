variable "name" {
  type = string
}

variable "region" {
  type    = string
  default = "ap-south-1"
}

variable "cluster_id" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "task_security_group_id" {
  type = string
}

variable "target_group_arn" {
  type = string
}

variable "image" {
  type = string
}

variable "cpu" {
  type    = number
  default = 1024
}

variable "memory" {
  type    = number
  default = 2048
}

variable "desired_count" {
  type    = number
  default = 2
}

variable "log_group_name" {
  type = string
}

variable "environment" {
  type    = map(string)
  default = {}
}
