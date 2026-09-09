variable "tenancy_ocid" {
  type      = string
  sensitive = true
}

variable "user_ocid" {
  type      = string
  sensitive = true
}

variable "fingerprint" {
  type      = string
  sensitive = true
}

variable "private_key_path" {
  type      = string
  sensitive = true
}

variable "region" {
  type = string
}

variable "compartment_ocid" {
  type = string
}

variable "ssh_public_key" {
  type = string
}

variable "instance_name" {
  type    = string
  default = "nuvio-production"
}

variable "ssh_ingress_cidr" {
  type    = string
  default = "0.0.0.0/0"
}

variable "availability_domain_index" {
  type    = number
  default = 0
}
