#!/usr/bin/env node
import fs from 'node:fs';

const file = process.argv[2];
if (!file) throw new Error('Usage: verify-free-plan.mjs <terraform-plan.json>');
const plan = JSON.parse(fs.readFileSync(file, 'utf8'));

const allowed = new Set([
  'oci_core_vcn',
  'oci_core_internet_gateway',
  'oci_core_route_table',
  'oci_core_security_list',
  'oci_core_subnet',
  'oci_core_instance'
]);

const changes = (plan.resource_changes || []).filter(change => change.mode === 'managed');
for (const change of changes) {
  if (!allowed.has(change.type)) {
    throw new Error('Paid/unapproved Terraform resource blocked: ' + change.type + ' ' + change.address);
  }
}

const instance = changes.find(change => change.type === 'oci_core_instance' && change.name === 'nuvio');
if (!instance) throw new Error('Oracle Nuvio VM missing from Terraform plan');

const after = instance.change?.after || {};
if (after.shape !== 'VM.Standard.A1.Flex') {
  throw new Error('Only Always Free Ampere A1 is permitted, got: ' + after.shape);
}

const shape = Array.isArray(after.shape_config) ? after.shape_config[0] : after.shape_config;
const ocpus = Number(shape?.ocpus);
const memory = Number(shape?.memory_in_gbs);
if (!Number.isFinite(ocpus) || ocpus > 2 || ocpus <= 0) {
  throw new Error('Always Free OCPU guard failed: ' + ocpus);
}
if (!Number.isFinite(memory) || memory > 12 || memory <= 0) {
  throw new Error('Always Free memory guard failed: ' + memory);
}

const source = Array.isArray(after.source_details) ? after.source_details[0] : after.source_details;
const boot = Number(source?.boot_volume_size_in_gbs);
if (!Number.isFinite(boot) || boot > 100 || boot < 47) {
  throw new Error('Always Free boot-volume guard failed: ' + boot + ' GB');
}

if (after.preserve_boot_volume !== false) {
  throw new Error('Boot volume must be deleted with the VM to avoid orphaned storage.');
}

const forbiddenWords = [
  'load_balancer',
  'nat_gateway',
  'database',
  'autonomous',
  'kubernetes',
  'oke',
  'reserved_public_ip'
];
for (const change of changes) {
  const target = (change.type + ' ' + change.address).toLowerCase();
  for (const word of forbiddenWords) {
    if (target.includes(word)) throw new Error('Forbidden paid-risk resource in plan: ' + target);
  }
}

console.log(JSON.stringify({
  ok: true,
  guard: 'oracle-always-free-v1',
  managedResources: changes.map(change => change.type),
  instance: {
    shape: after.shape,
    ocpus,
    memoryGb: memory,
    bootVolumeGb: boot
  }
}, null, 2));
