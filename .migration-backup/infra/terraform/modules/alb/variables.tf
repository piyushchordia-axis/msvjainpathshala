variable "name" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "certificate_arn" {
  type = string
}

variable "api_hostnames" {
  type    = list(string)
  default = ["api.jainpathshala.org"]
}

variable "tags" {
  type    = map(string)
  default = {}
}
