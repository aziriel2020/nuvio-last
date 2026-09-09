terraform {
  required_version = ">= 1.12.0"

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = ">= 6.0.0"
    }
  }

  backend "oci" {}
}

provider "oci" {
  tenancy_ocid     = var.tenancy_ocid
  user_ocid        = var.user_ocid
  fingerprint      = var.fingerprint
  private_key_path = var.private_key_path
  region           = var.region
}

data "oci_identity_availability_domains" "ads" {
  compartment_id = var.tenancy_ocid
}

data "oci_core_images" "ubuntu_a1" {
  compartment_id           = var.compartment_ocid
  operating_system         = "Canonical Ubuntu"
  shape                    = "VM.Standard.A1.Flex"
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

resource "oci_core_vcn" "nuvio" {
  compartment_id = var.compartment_ocid
  cidr_block     = "10.42.0.0/16"
  display_name   = "nuvio-vcn"
  dns_label      = "nuvio"
  freeform_tags  = { project = "nuvio", tier = "always-free" }
}

resource "oci_core_internet_gateway" "nuvio" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.nuvio.id
  display_name   = "nuvio-internet-gateway"
  enabled        = true
}

resource "oci_core_route_table" "nuvio" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.nuvio.id
  display_name   = "nuvio-public-routes"

  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.nuvio.id
  }
}

resource "oci_core_security_list" "nuvio" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.nuvio.id
  display_name   = "nuvio-public-security"

  egress_security_rules {
    protocol    = "all"
    destination = "0.0.0.0/0"
  }

  dynamic "ingress_security_rules" {
    for_each = {
      ssh   = { port = 22, cidr = var.ssh_ingress_cidr }
      http  = { port = 80, cidr = "0.0.0.0/0" }
      https = { port = 443, cidr = "0.0.0.0/0" }
    }
    content {
      protocol = "6"
      source   = ingress_security_rules.value.cidr
      tcp_options {
        min = ingress_security_rules.value.port
        max = ingress_security_rules.value.port
      }
      description = ingress_security_rules.key
    }
  }
}

resource "oci_core_subnet" "nuvio" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.nuvio.id
  cidr_block                 = "10.42.10.0/24"
  display_name               = "nuvio-public-subnet"
  dns_label                  = "public"
  prohibit_public_ip_on_vnic = false
  route_table_id             = oci_core_route_table.nuvio.id
  security_list_ids          = [oci_core_security_list.nuvio.id]
}

resource "oci_core_instance" "nuvio" {
  compartment_id      = var.compartment_ocid
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
  display_name        = var.instance_name
  shape               = "VM.Standard.A1.Flex"
  preserve_boot_volume = false

  shape_config {
    ocpus         = 2
    memory_in_gbs = 12
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.nuvio.id
    assign_public_ip = true
    display_name     = "nuvio-primary-vnic"
    hostname_label   = "nuvio"
  }

  source_details {
    source_type             = "image"
    source_id               = data.oci_core_images.ubuntu_a1.images[0].id
    boot_volume_size_in_gbs = 100
  }

  metadata = {
    ssh_authorized_keys = var.ssh_public_key
  }

  freeform_tags = {
    project = "nuvio"
    runtime = "oracle-vm"
    tier    = "always-free"
  }
}
