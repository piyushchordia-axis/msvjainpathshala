variable "name" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "app_security_group_ids" {
  type = list(string)
}

variable "node_type" {
  type    = string
  default = "cache.t4g.small"
}

variable "engine_version" {
  type    = string
  default = "7.1"
}

variable "num_replicas" {
  type    = number
  default = 1
}

variable "snapshot_retention" {
  type    = number
  default = 7
}

variable "tags" {
  type    = map(string)
  default = {}
}
