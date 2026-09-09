output "instance_ocid" {
  value = oci_core_instance.nuvio.id
}

output "public_ip" {
  value = oci_core_instance.nuvio.public_ip
}

output "public_host" {
  value = "${replace(oci_core_instance.nuvio.public_ip, ".", "-")}.nip.io"
}

output "public_origin" {
  value = "https://${replace(oci_core_instance.nuvio.public_ip, ".", "-")}.nip.io"
}
