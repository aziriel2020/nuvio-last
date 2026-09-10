import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const tf = fs.readFileSync(path.join(root, 'oracle/terraform/main.tf'), 'utf8');
const service = fs.readFileSync(path.join(root, 'oracle/nuvio.service'), 'utf8');
const updater = fs.readFileSync(path.join(root, 'oracle/update.sh'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'oracle/bootstrap.sh'), 'utf8');
const server = fs.readFileSync(path.join(root, 'oracle/server.mjs'), 'utf8');
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
  assert.match(service, /EnvironmentFile=-\/etc\/nuvio\/release\.env/);
  assert.match(service, /HOST=127\.0\.0\.1/);
  assert.match(service, /NoNewPrivileges=true/);
});

test('Oracle release tests run before the final public build and atomic switch', () => {
  const testIndex = updater.indexOf('npm test');
  const runtimeTestIndex = updater.indexOf('npm run test:runtime');
  const oracleTestIndex = updater.indexOf('npm run test:oracle');
  const buildIndex = updater.indexOf('npm run build:runtime');
  const originGuardIndex = updater.indexOf('Final Oracle build origin verified:');
  const switchIndex = updater.indexOf('mv -Tf "$BASE/current.new" "$CURRENT"');
  assert.ok(
    testIndex >= 0 &&
    runtimeTestIndex > testIndex &&
    oracleTestIndex > runtimeTestIndex &&
    buildIndex > oracleTestIndex &&
    originGuardIndex > buildIndex &&
    switchIndex > originGuardIndex,
    'Oracle test fixture must run before the final production-origin build and switch'
  );
  assert.ok(updater.includes('127.0.0.1'), 'local integration fixture guard must be present');
  assert.ok(updater.includes('pages') && updater.includes('workers') && updater.includes('vercel') && updater.includes('sslip'), 'legacy-host final-build guard must be present');
  assert.match(updater, /Rolling back to/);
  assert.match(updater, /systemctl restart nuvio/);
  assert.doesNotMatch(updater, /build:cloudflare|test:cloudflare|wrangler/i);
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

test('Oracle disk cache is release-scoped and concurrent writes are collision-safe', () => {
  assert.match(server, /CACHE_NAMESPACE/);
  assert.match(server, /process\.env\.NUVIO_GIT_SHA/);
  assert.match(server, /CACHE_NAMESPACE \+ '\\n' \+ url/);
  assert.match(server, /randomUUID\(\)/);
  assert.match(server, /this\.writes = new Map\(\)/);
  assert.match(server, /this\.writeEntry\(input, stored\)/);
  assert.match(updater, /NUVIO_GIT_SHA=%s/);
  assert.match(updater, /\/etc\/nuvio\/release\.env/);
});

test('Oracle runtime imports only the neutral runtime layer and repository-local assets', () => {
  assert.match(server, /\.\.\/runtime\/index\.mjs/);
  assert.match(server, /pathname\.startsWith\('\/static\/assets\/'\)/);
  assert.match(server, /path\.join\(ROOT, 'assets'\)/);
  assert.doesNotMatch(server, /cloudflare|pages\.dev|workers\.dev|vercel\.app|sslip\.io/i);
});
