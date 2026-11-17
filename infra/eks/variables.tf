variable "region" {
  type    = string
  default = "us-east-1"
}
variable "account_id" {
  type = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "Supply the approved personal AWS account ID."
  }
}
variable "operator_cidr" {
  type = string
  validation {
    condition     = can(cidrhost(var.operator_cidr, 0)) && endswith(var.operator_cidr, "/32")
    error_message = "The Kubernetes API requires your current public IPv4 address as /32."
  }
}
variable "name" {
  type    = string
  default = "gta-portfolio-demo"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,30}$", var.name))
    error_message = "Use a short lowercase deployment name."
  }
}
variable "kubernetes_version" {
  type    = string
  default = "1.36"
}
variable "availability_zones" {
  type    = list(string)
  default = ["us-east-1a", "us-east-1b"]
  validation {
    condition     = length(var.availability_zones) == 2
    error_message = "Supply two distinct availability zones in the selected region."
  }
}
variable "github_repository" {
  type    = string
  default = "Srijan229/gta-personal-infra"
}
variable "github_branch" {
  type    = string
  default = "eks-demo-prep"
}
variable "existing_github_oidc_provider_arn" {
  type        = string
  default     = ""
  description = "Reuse an existing account-level GitHub OIDC provider if present."
}
