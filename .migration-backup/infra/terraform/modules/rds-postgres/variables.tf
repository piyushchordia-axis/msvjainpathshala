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

variable "engine_version" {
  type    = string
  default = "16.4"
}

variable "instance_class" {
  type    = string
  default = "db.t4g.medium"
}

variable "replica_instance_class" {
  type    = string
  default = "db.t4g.medium"
}

variable "allocated_storage" {
  type    = number
  default = 100
}

variable "backup_retention_days" {
  type    = number
  default = 30
}

variable "multi_az" {
  type    = bool
  default = true
}

variable "create_replica" {
  type    = bool
  default = true
}

variable "tags" {
  type    = map(string)
  default = {}
}
