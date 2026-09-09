#!/usr/bin/env node
import { spawn } from 'node:child_process';

const port = Number(process.env.ORACLE_TEST_PORT || 3317);
const origin = 'http://127.0.0.1:' + port;
const child = spawn(process.execPath, ['oracle/server.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    PUBLIC_ORIGIN: origin,
    NUVIO_CACHE_DIR: '/tmp/nuvio-oracle-test-cache-' + process.pid,
    NUVIO_CACHE_MAX_ENTRIES: '256',
    NODE_ENV: 'test'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let logs = '';
child.stdout.on('data', chunk => { logs += chunk; process.stdout.write(chunk); });
child.stderr.on('data', chunk => { logs += chunk; process.stderr.write(chunk); });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function retry(pathname, attempts = 40) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(origin + pathname, { signal: AbortSignal.timeout(3000) });
      if (response.ok) return response;
      last = new Error(pathname + ' HTTP ' + response.status);
    } catch (error) {
      last = error;
    }
    await sleep(250);
  }
  throw last || new Error('Oracle runtime unavailable');
}

function requireHeader(response, name, value) {
  const actual = response.headers.get(name);
  if (actual !== value) throw new Error(name + ' expected ' + value + ', got ' + actual);
}

try {
  const oracleHealth = await retry('/_oracle/health');
  requireHeader(oracleHealth, 'x-nuvio-origin', 'oracle-vm');
  const oracleHealthBody = await oracleHealth.json();
  if (oracleHealthBody.runtime !== 'oracle-vm') throw new Error('Wrong Oracle runtime marker');

  const health = await retry('/health');
  requireHeader(health, 'x-nuvio-origin', 'oracle-vm');
  const healthBody = await health.json();
  if (healthBody.ok !== true || healthBody.collectionCount !== 47) {
    throw new Error('Unexpected coexistence health payload');
  }

  const collections = await retry('/nuvio-collections-fr-global-tr-usa.json');
  requireHeader(collections, 'x-nuvio-origin', 'oracle-vm');
  const collectionBody = await collections.json();
  if (!Array.isArray(collectionBody) || collectionBody.length !== 47) {
    throw new Error('Oracle runtime did not preserve the 47 combined collections');
  }
  if (JSON.stringify(collectionBody).includes('vercel.app')) {
    throw new Error('Oracle collections still reference Vercel');
  }

  const card = await retry('/fr/desktop-content-card.jpg?v=oracle-test-desktop11&design=shield3&type=series&provider=netflix&label=Netflix&title=Oracle%20Runtime&append=S01E01');
  requireHeader(card, 'x-nuvio-origin', 'oracle-vm');
  if (!String(card.headers.get('content-type') || '').includes('image/svg+xml')) {
    throw new Error('Oracle desktop renderer did not return SVG');
  }
  if (card.headers.get('x-nuvio-card-renderer') !== 'calendar-overlay-v2') {
    throw new Error('Oracle desktop renderer compatibility header changed');
  }
  const svg = await card.text();
  for (const token of ['data-renderer="shield-desktop-v3"', 'desktop-title', 'desktop-subtitle', 'desktop-provider']) {
    if (!svg.includes(token)) throw new Error('Oracle desktop SVG missing ' + token);
  }

  console.log('Oracle VM runtime integration test passed.');
} catch (error) {
  console.error(error);
  console.error(logs);
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    sleep(5000)
  ]);
  if (child.exitCode == null) child.kill('SIGKILL');
}
