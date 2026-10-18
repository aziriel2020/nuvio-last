#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import sharp from 'sharp';
const require = createRequire(import.meta.url);
const { SeriesStore } = require('../regions/series/src/store.cjs');
const { fromTmdb } = require('../regions/series/src/model.cjs');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nuvio-series-runtime-'));
const port = process.env.SERIES_TEST_PORT || '3328';
const origin = `http://127.0.0.1:${port}`;
const filename = path.join(temp, 'index.sqlite');
const store = new SeriesStore(filename);
const fixture = (id, animation = false) => fromTmdb({ id, name: `Fixture ${id}`, genres: [{ id: animation ? 16 : 18 }], first_air_date: '2026-01-01', external_ids: {} });
for (let id = 1; id <= 205; id++) store.upsert(fixture(id));
store.upsert(fixture(999, true));
const env = { ...process.env, PUBLIC_ORIGIN: origin, PORT: port, HOST: '127.0.0.1', NUVIO_SERIES_DB: filename,
  NUVIO_CACHE_DIR: path.join(temp, 'cache'), NUVIO_NOW_OVERRIDE: '2026-10-18T17:00:00Z' };
execFileSync(process.execPath, ['scripts/build-runtime.js'], { env, stdio: 'pipe' });
const child = spawn(process.execPath, ['oracle/server.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
child.stdout.on('data', (data) => { logs += data; }); child.stderr.on('data', (data) => { logs += data; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(route) { return fetch(origin + route, { signal: AbortSignal.timeout(15000) }); }

try {
  let ready = false;
  for (let n = 0; n < 40; n++) {
    try { if ((await get('/_oracle/health')).ok) { ready = true; break; } } catch {}
    await sleep(250);
  }
  assert(ready, `Oracle test server failed to start: ${logs}`);
  const install = await (await get('/install.json')).json();
  assert.equal(install.seriesManifest, `${origin}/series/manifest.json`);
  const manifest = await (await get('/series/manifest.json')).json();
  const imports = await (await get('/series/nuvio-collections.json')).json();
  const desktop = await (await get('/series/nuvio-collections-desktop.json')).json();
  assert.equal(imports.length, 2); assert.equal(desktop.length, 2);
  assert(manifest.catalogs.some((c) => c.id === imports[0].folders[0].sources[0].catalogId));
  const all = '/series/catalog/series/series-world-premieres-all-all';
  const ids = [];
  for (const skip of [0, 100, 200]) {
    const response = await get(`${all}/skip=${skip}.json`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-nuvio-runtime'), 'oracle-vm');
    const body = await response.json(); ids.push(...body.metas.map((m) => m.id));
  }
  assert.equal(ids.length, 205); assert.equal(new Set(ids).size, 205);
  assert(!ids.includes('tmdb:tv:999'));
  assert.equal((await get('/series/meta/series/tmdb%3Atv%3A999.json')).status, 404);
  // The independent sync connection changes SQLite while the HTTP reader stays open.
  store.upsert(fixture(1, true));
  const refreshed = await (await get(`${all}/search=Fixture%201.json`)).json();
  assert(!refreshed.metas.some((m) => m.id === 'tmdb:tv:1'), 'animation correction must become visible without stale edge cache');
  const status = await (await get('/series/status.json')).json();
  assert.equal(status.eligible, 204); assert.equal(status.animationExcluded, 2);
  const image = await get(new URL(imports[0].folders[0].coverImageUrl).pathname + new URL(imports[0].folders[0].coverImageUrl).search);
  assert.equal(image.status, 200); assert.match(image.headers.get('content-type'), /^image\/jpeg/);
  const imageMeta = await sharp(Buffer.from(await image.arrayBuffer())).metadata();
  assert.equal(imageMeta.width, 1600); assert.equal(imageMeta.height, 900);
  const background = await get('/series/backdrop.jpg?v=approved-v1');
  const backgroundMeta = await sharp(Buffer.from(await background.arrayBuffer())).metadata();
  assert.equal(backgroundMeta.width, 1920); assert.equal(backgroundMeta.height, 1080);
  console.log('Series Oracle integration passed: manifests, Shield/Desktop imports, 205 paginated entries, live animation correction, metadata gate, progress and cover renderer.');
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
  store.close(); fs.rmSync(temp, { recursive: true, force: true });
}
