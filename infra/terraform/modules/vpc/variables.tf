variable "name" {
  type        = string
  description = "Environment-scoped name prefix, e.g. jp-staging."
}

variable "region" {
  type        = string
  description = "AWS region — must be one that has 3 AZs available."
  default     = "ap-south-1"
}

variable "cidr" {
  type        = string
  description = "VPC CIDR block — typically /16."
  default     = "10.0.0.0/16"
}

variable "enable_nat_per_az" {
  type        = bool
  description = "true → 3 NAT gateways (one per AZ, HA). false → 1 NAT (cheaper)."
  default     = false
}

variable "tags" {
  type    = map(string)
  default = {}
}
