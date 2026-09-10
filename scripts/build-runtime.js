'use strict';

const fs = require('fs');
const path = require('path');
const handler = require('../api/index');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const DEFAULT_PUBLIC_ORIGIN = 'https://141-145-215-202.nip.io';

function normalizeOrigin(value) {
  const url = new URL(String(value || DEFAULT_PUBLIC_ORIGIN));
  if (!/^https?:$/.test(url.protocol)) throw new Error('PUBLIC_ORIGIN must use http or https');
  return url.origin;
}

const publicOrigin = normalizeOrigin(process.env.PUBLIC_ORIGIN || DEFAULT_PUBLIC_ORIGIN);
const buildRuntime = process.env.NUVIO_RUNTIME || 'oracle-vm';

function call(route) {
  return new Promise((resolve, reject) => {
    const origin = new URL(publicOrigin);
    const req = {
      method: 'GET',
      url: route,
      headers: {
        host: origin.host,
        'x-forwarded-host': origin.host,
        'x-forwarded-proto': origin.protocol.replace(':', ''),
        'x-nuvio-public-origin': origin.origin,
        'x-nuvio-timezone': 'Europe/Brussels'
      }
    };
    const chunks = [];
    const out = { statusCode: 200, headers: {} };
    const res = {
      get statusCode() { return out.statusCode; },
      set statusCode(value) { out.statusCode = value; },
      setHeader(name, value) { out.headers[String(name).toLowerCase()] = value; },
      getHeader(name) { return out.headers[String(name).toLowerCase()]; },
      end(value = '') {
        if (value) chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(String(value)));
        out.body = Buffer.concat(chunks);
        resolve(out);
      }
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

function destinationFor(route) {
  const pathname = new URL(route, publicOrigin).pathname;
  if (pathname === '/') return path.join(DIST, 'index.html');
  return path.join(DIST, pathname.replace(/^\/+/, ''));
}

async function emit(route) {
  const response = await call(route);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`${route} returned HTTP ${response.statusCode}`);
  }
  const destination = destinationFor(route);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, response.body);
  return { route, bytes: response.body.length };
}

function copyIfPresent(source, destination) {
  if (!fs.existsSync(source)) return false;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
  return true;
}

async function main() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  const staticRoutes = [
    '/',
    '/install.json',
    '/coexistence-check.json',
    '/nuvio-collections-fr-global-tr-usa.json',
    '/nuvio-collections-fr-global-usa.json',
    '/nuvio-collections-usa-fr.json',
    '/collections.json',
    '/nuvio-collections-desktop.json',
    '/nuvio-collections-global.json',
    '/nuvio-collections-tr.json',
    '/nuvio-collections-turkiye.json'
  ];

  for (const region of ['fr', 'global', 'tr', 'us']) {
    staticRoutes.push(
      `/${region}/manifest.json`,
      `/${region}/nuvio-collections.json`,
      `/${region}/collections.json`,
      `/${region}/archive-blueprint.json`
    );
  }

  const emitted = [];
  for (const route of staticRoutes) emitted.push(await emit(route));

  // Keep a deterministic static copy for offline tests/package inspection.
  // The Oracle server itself maps /static/assets/* directly to ROOT/assets/*.
  copyIfPresent(path.join(ROOT, 'assets'), path.join(DIST, 'static', 'assets'));

  const manifest = {
    generatedAt: new Date().toISOString(),
    publicOrigin,
    staticRoutes: emitted,
    runtime: buildRuntime,
    productionHost: new URL(publicOrigin).host,
    assetRoot: 'assets',
    externalHostingDependencies: []
  };
  fs.writeFileSync(path.join(DIST, 'runtime-build.json'), JSON.stringify(manifest, null, 2));

  const totalBytes = emitted.reduce((sum, item) => sum + item.bytes, 0);
  console.log(`${buildRuntime} build ready: ${emitted.length} static routes, ${totalBytes} bytes, origin ${publicOrigin}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
