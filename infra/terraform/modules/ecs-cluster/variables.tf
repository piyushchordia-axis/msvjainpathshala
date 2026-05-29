variable "name" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "service_names" {
  type    = list(string)
  default = ["api", "worker", "web", "ai", "migrate"]
}

variable "tags" {
  type    = map(string)
  default = {}
}
