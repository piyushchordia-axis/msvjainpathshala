variable "name" {
  type = string
}

variable "web_origin_domain" {
  type = string
}

variable "web_aliases" {
  type    = list(string)
  default = []
}

variable "acm_certificate_arn" {
  type = string
}

variable "web_acl_arn" {
  type    = string
  default = null
}

variable "origin_shield_region" {
  type    = string
  default = "ap-south-1"
}

variable "tags" {
  type    = map(string)
  default = {}
}
