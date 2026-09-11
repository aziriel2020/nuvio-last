#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import sharp from 'sharp';

const port = Number(process.env.ORACLE_TEST_PORT || 3317);
const origin = 'http://127.0.0.1:' + port;
const forbidden = /pages\.dev|workers\.dev|vercel\.app|sslip\.io/i;

// Keep this integration test self-contained: static JSON routes are served from
// dist, so build them for the same local origin used by the spawned Oracle VM adapter.
execFileSync(process.execPath, ['scripts/build-runtime.js'], {
  cwd: process.cwd(),
  env: { ...process.env, PUBLIC_ORIGIN: origin, NUVIO_RUNTIME: 'oracle-vm' },
  stdio: 'inherit'
});

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

// /health builds the complete four-region coexistence map. That is intentionally
// heavier than /_oracle/health, especially on the Always Free VM, so use a bounded
// but realistic per-request budget instead of a runner-class 3 s assumption.
async function retry(pathname, attempts = 8, timeoutMs = 20_000) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(origin + pathname, { signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok) return response;
      last = new Error(pathname + ' HTTP ' + response.status);
    } catch (error) {
      last = error;
    }
    await sleep(500);
  }
  throw last || new Error('Oracle runtime unavailable');
}

function requireHeader(response, name, value) {
  const actual = response.headers.get(name);
  if (actual !== value) throw new Error(name + ' expected ' + value + ', got ' + actual);
}

function rejectLegacy(value, label) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (forbidden.test(text)) throw new Error(label + ' contains a forbidden legacy origin');
}

function flattenDesktopStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => flattenDesktopStrings(entry, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((entry) => flattenDesktopStrings(entry, out));
  return out;
}

function findFirstOracleVisual(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      const url = new URL(value);
      if (url.origin === origin && /\.(?:jpg|jpeg|png|webp|svg)(?:$|\?)/i.test(url.pathname + url.search)) return value;
    } catch {}
    return null;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findFirstOracleVisual(entry);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === 'object') {
    for (const entry of Object.values(value)) {
      const found = findFirstOracleVisual(entry);
      if (found) return found;
    }
  }
  return null;
}

try {
  const oracleHealth = await retry('/_oracle/health', 5, 5_000);
  requireHeader(oracleHealth, 'x-nuvio-origin', 'oracle-vm');
  requireHeader(oracleHealth, 'x-nuvio-edge', 'oracle-node');
  const oracleHealthBody = await oracleHealth.json();
  if (oracleHealthBody.runtime !== 'oracle-vm') throw new Error('Wrong Oracle runtime marker');
  if (oracleHealthBody.publicOrigin !== origin) throw new Error('Wrong Oracle public origin');

  const health = await retry('/health');
  requireHeader(health, 'x-nuvio-origin', 'oracle-vm');
  requireHeader(health, 'x-nuvio-edge', 'oracle-node');
  const healthBody = await health.json();
  if (healthBody.ok !== true || healthBody.safe !== true || !Number.isInteger(healthBody.collectionCount) || healthBody.collectionCount < 1) {
    throw new Error('Unexpected coexistence health payload');
  }

  const collections = await retry('/nuvio-collections-fr-global-tr-usa.json');
  requireHeader(collections, 'x-nuvio-origin', 'oracle-vm');
  requireHeader(collections, 'x-nuvio-edge', 'oracle-node');
  const collectionBody = await collections.json();
  if (!Array.isArray(collectionBody) || collectionBody.length !== healthBody.collectionCount) {
    throw new Error(`Oracle combined collections mismatch: health=${healthBody.collectionCount} json=${collectionBody?.length}`);
  }
  rejectLegacy(collectionBody, 'combined collections');

  const desktop = await retry('/nuvio-collections-desktop.json');
  requireHeader(desktop, 'x-nuvio-origin', 'oracle-vm');
  requireHeader(desktop, 'x-nuvio-edge', 'oracle-node');
  const desktopBody = await desktop.json();
  if (!Array.isArray(desktopBody) || desktopBody.length !== collectionBody.length) {
    throw new Error(`Oracle Desktop collections mismatch: standard=${collectionBody.length} desktop=${desktopBody?.length}`);
  }
  rejectLegacy(desktopBody, 'desktop collections');

  const tr = await retry('/nuvio-collections-tr.json');
  requireHeader(tr, 'x-nuvio-origin', 'oracle-vm');
  requireHeader(tr, 'x-nuvio-edge', 'oracle-node');
  const trBody = await tr.json();
  if (!Array.isArray(trBody) || trBody.length !== healthBody.trCollectionCount) {
    throw new Error(`Oracle Türkiye collections mismatch: health=${healthBody.trCollectionCount} json=${trBody?.length}`);
  }
  rejectLegacy(trBody, 'Türkiye collections');

  for (const region of ['fr', 'global', 'tr', 'us']) {
    const response = await retry(`/${region}/manifest.json`);
    requireHeader(response, 'x-nuvio-origin', 'oracle-vm');
    requireHeader(response, 'x-nuvio-edge', 'oracle-node');
    const manifest = await response.json();
    if (!Array.isArray(manifest.catalogs) || manifest.catalogs.length < 1) throw new Error(`${region} manifest has no catalogs`);
    rejectLegacy(manifest, `${region} manifest`);
  }

  const desktopStrings = flattenDesktopStrings(desktopBody);
  const desktopFolderVisual = desktopStrings.find((value) => {
    try {
      return /\/static\/assets\/generated-covers\/(?:fr|global|tr|us)\/(?!genres\/)[a-z0-9-]+\/(?:series|movie)-desktop\.jpg$/i.test(new URL(value).pathname);
    } catch { return false; }
  });
  const desktopGenreVisual = desktopStrings.find((value) => {
    try {
      return /\/static\/assets\/generated-covers\/(?:fr|global|tr|us)\/genres\/[a-z0-9-]+-desktop\.jpg$/i.test(new URL(value).pathname);
    } catch { return false; }
  });
  if (!desktopFolderVisual) throw new Error('Desktop collection has no Original Premium service cover');
  if (!desktopGenreVisual) throw new Error('Desktop collection has no Original Premium genre cover');

  for (const [label, visual] of [['service', desktopFolderVisual], ['genre', desktopGenreVisual]]) {
    const u = new URL(visual);
    if (u.origin !== origin) throw new Error(`Desktop ${label} visual escaped Oracle origin: ${visual}`);
    if (u.searchParams.get('v') !== 'generated-v4-original-premium') throw new Error(`Desktop ${label} visual has stale revision: ${u.searchParams.get('v')}`);
    const card = await retry(u.pathname + u.search);
    requireHeader(card, 'x-nuvio-origin', 'oracle-vm');
    requireHeader(card, 'x-nuvio-edge', 'oracle-node');
    const contentType = String(card.headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('image/jpeg')) throw new Error(`Desktop ${label} is not JPEG: ${contentType}`);
    const bytes = Buffer.from(await card.arrayBuffer());
    if (bytes.length < 10000 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error(`Desktop ${label} JPEG payload invalid`);
    const meta = await sharp(bytes).metadata();
    if (meta.format !== 'jpeg' || meta.width !== 1600 || meta.height !== 900) throw new Error(`Desktop ${label} expected 1600x900 JPEG, got ${meta.format} ${meta.width}x${meta.height}`);
  }

  const visual = findFirstOracleVisual(desktopBody) || findFirstOracleVisual(collectionBody);
  if (!visual) throw new Error('No Oracle-owned generated visual URL found in collection payloads');
  const visualUrl = new URL(visual);
  const visualResponse = await retry(visualUrl.pathname + visualUrl.search);
  requireHeader(visualResponse, 'x-nuvio-origin', 'oracle-vm');
  requireHeader(visualResponse, 'x-nuvio-edge', 'oracle-node');
  const visualType = String(visualResponse.headers.get('content-type') || '');
  if (!visualType.startsWith('image/')) throw new Error('Generated collection visual is not an image: ' + visualType);
  const visualBytes = new Uint8Array(await visualResponse.arrayBuffer());
  if (visualBytes.byteLength < 1000) throw new Error('Generated collection visual is unexpectedly small');

  console.log(JSON.stringify({
    ok: true,
    standardCollections: collectionBody.length,
    desktopCollections: desktopBody.length,
    turkeyCollections: trBody.length,
    sampledVisual: visualUrl.pathname,
    sampledVisualBytes: visualBytes.byteLength
  }));
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
