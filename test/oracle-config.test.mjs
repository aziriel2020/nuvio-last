import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const tf = fs.readFileSync(path.join(root, 'oracle/terraform/main.tf'), 'utf8');
const service = fs.readFileSync(path.join(root, 'oracle/nuvio.service'), 'utf8');
const updater = fs.readFileSync(path.join(root, 'oracle/update.sh'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'oracle/bootstrap.sh'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/provision-oracle.yml'), 'utf8');

test('Oracle infrastructure is hard-pinned inside the Always Free profile', () => {
  assert.match(tf, /shape\s*=\s*"VM\.Standard\.A1\.Flex"/);
  assert.match(tf, /ocpus\s*=\s*2/);
  assert.match(tf, /memory_in_gbs\s*=\s*12/);
  assert.match(tf, /boot_volume_size_in_gbs\s*=\s*100/);
  assert.match(tf, /preserve_boot_volume\s*=\s*false/);
  assert.match(tf, /oci_identity_region_subscriptions/);
  assert.match(tf, /var\.region\s*==\s*local\.home_region/);
  assert.match(tf, /Always Free Compute must be provisioned in the tenancy home region/);
  assert.doesNotMatch(tf, /oci_(?:load_balancer|network_load_balancer|database|containerengine|core_nat_gateway)/);
});

test('Oracle runtime has bounded resources and automatic restart', () => {
  assert.match(service, /Restart=always/);
  assert.match(service, /MemoryMax=9G/);
  assert.match(service, /NUVIO_CACHE_MAX_ENTRIES=2048/);
  assert.match(service, /HOST=127\.0\.0\.1/);
  assert.match(service, /NoNewPrivileges=true/);
});

test('Oracle releases are tested before switch and roll back after failed health', () => {
  const testIndex = updater.indexOf('npm test');
  const buildIndex = updater.indexOf('npm run build:cloudflare');
  const switchIndex = updater.indexOf('mv -Tf "$BASE/current.new" "$CURRENT"');
  assert.ok(testIndex >= 0 && buildIndex > testIndex && switchIndex > buildIndex);
  assert.match(updater, /Rolling back to/);
  assert.match(updater, /systemctl restart nuvio/);
});

test('Oracle bootstrap exposes only SSH, HTTP and HTTPS', () => {
  assert.match(bootstrap, /ufw allow OpenSSH/);
  assert.match(bootstrap, /ufw allow 80\/tcp/);
  assert.match(bootstrap, /ufw allow 443\/tcp/);
  assert.doesNotMatch(bootstrap, /ufw allow 3000/);
});

test('Oracle provisioning verifies the free plan before apply', () => {
  const verify = workflow.indexOf('verify-free-plan.mjs');
  const apply = workflow.indexOf('terraform apply');
  assert.ok(verify >= 0 && apply > verify);
  assert.match(workflow, /AUDIT_RUNTIME: oracle-vm/);
  assert.match(workflow, /TMDB_READ_TOKEN/);
  assert.match(workflow, /ORACLE_SSH_PRIVATE_KEY/);
});
