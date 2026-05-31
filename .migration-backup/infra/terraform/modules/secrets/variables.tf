variable "name" {
  type        = string
  description = "Path prefix, e.g. jp/prod"
}

variable "secret_names" {
  type        = list(string)
  description = "Secret leaf names, e.g. ['database/master','jwt/keys','integrations/razorpay',...]"
  default = [
    "database/master",
    "redis/master",
    "jwt/keys",
    "integrations/razorpay",
    "integrations/msg91",
    "integrations/fcm",
    "integrations/resend",
    "ai/openai",
    "ai/hmac",
    "storage/r2",
  ]
}

variable "tags" {
  type    = map(string)
  default = {}
}
