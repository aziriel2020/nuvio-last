'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/index');

function call(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = { method: 'GET', url: path, headers: { host: 'coexist.example', 'x-forwarded-proto': 'https', 'x-vercel-ip-timezone': 'Europe/Brussels', ...headers } };
    const out = { statusCode: 200, headers: {}, body: Buffer.alloc(0) };
    const chunks = [];
    const res = {
      get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; },
      setHeader(k, v) { out.headers[String(k).toLowerCase()] = v; },
      getHeader(k) { return out.headers[String(k).toLowerCase()]; },
      end(v = '') { if (v) chunks.push(Buffer.isBuffer(v) ? v : Buffer.from(String(v))); out.body = Buffer.concat(chunks); out.text = out.body.toString('utf8'); resolve(out); }
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

test('single deployment exposes two distinct addon manifests', async () => {
  const us = JSON.parse((await call('/us/manifest.json')).text);
  const fr = JSON.parse((await call('/fr/manifest.json')).text);
  assert.equal(us.id, 'com.nuvio.calendar.archives.us.coexist');
  assert.equal(fr.id, 'com.nuvio.calendar.archives.fr.coexist');
  assert.notEqual(us.id, fr.id);
  assert.equal(us.catalogs.length, 779);
  assert.equal(fr.catalogs.length, 1107);
});

test('combined import has 24 unique collection IDs and clear country-prefixed titles', async () => {
  const response = await call('/nuvio-collections-usa-fr.json');
  assert.equal(response.statusCode, 200);
  const collections = JSON.parse(response.text);
  assert.equal(collections.length, 24);
  const ids = collections.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(collections.filter((c) => c.title.startsWith('🇺🇸 ')).length, 10);
  assert.equal(collections.filter((c) => c.title.startsWith('🇫🇷 ')).length, 14);
  assert(collections.some((c) => c.title === '🇺🇸 Netflix'));
  assert(collections.some((c) => c.title === '🇫🇷 Netflix'));
});

test('USA and France collection sources always reference their own addon', async () => {
  const collections = JSON.parse((await call('/nuvio-collections-usa-fr.json')).text);
  const us = collections.filter((c) => c.title.startsWith('🇺🇸 '));
  const fr = collections.filter((c) => c.title.startsWith('🇫🇷 '));
  for (const collection of us) for (const folder of collection.folders) {
    assert(folder.sources.every((source) => source.addonId === 'com.nuvio.calendar.archives.us.coexist'));
  }
  for (const collection of fr) for (const folder of collection.folders) {
    assert(folder.sources.every((source) => source.addonId === 'com.nuvio.calendar.archives.fr.coexist'));
  }
});

test('all hosted visual URLs stay inside the correct regional route prefix', async () => {
  const collections = JSON.parse((await call('/nuvio-collections-usa-fr.json')).text);
  for (const collection of collections) {
    const prefix = collection.title.startsWith('🇺🇸 ') ? 'https://coexist.example/us/' : 'https://coexist.example/fr/';
    assert(collection.backdropImageUrl?.startsWith(prefix));
    for (const folder of collection.folders) {
      assert(folder.coverImageUrl?.startsWith(prefix));
      assert(folder.heroBackdropUrl?.startsWith(prefix));
      assert(folder.titleLogoUrl?.startsWith(prefix));
    }
  }
});

test('regional image routes are reachable through the wrapper', async () => {
  const us = await call('/us/platform-category-card.svg?provider=netflix&category=series');
  const fr = await call('/fr/platform-category-card.svg?provider=canal-plus&category=films');
  assert.equal(us.statusCode, 200);
  assert.equal(fr.statusCode, 200);
  assert.match(us.headers['content-type'], /image\/svg\+xml/);
  assert.match(fr.headers['content-type'], /image\/svg\+xml/);
  assert.match(us.text, /SÉRIES/);
  assert.match(fr.text, /FILMS/);
});

test('coexistence checker reports zero collisions', async () => {
  const report = JSON.parse((await call('/coexistence-check.json')).text);
  assert.equal(report.safe, true);
  assert.deepEqual(report.duplicateCollectionIds, []);
  assert.deepEqual(report.duplicateFolderKeys, []);
  assert.deepEqual(report.duplicateCatalogKeys, []);
  assert.deepEqual(report.addonIds, ['com.nuvio.calendar.archives.us.coexist', 'com.nuvio.calendar.archives.fr.coexist']);
});

test('USA and France Paramount+ remain distinct and both expose Series and Films', async () => {
  const collections = JSON.parse((await call('/nuvio-collections-usa-fr.json')).text);
  const us = collections.find((c) => c.title === '🇺🇸 Paramount+');
  const fr = collections.find((c) => c.title === '🇫🇷 Paramount+');
  assert(us && fr);
  assert.deepEqual(us.folders.map((f) => f.title), ['Séries', 'Films']);
  assert.deepEqual(fr.folders.map((f) => f.title), ['Séries', 'Films']);
  assert.notEqual(us.id, fr.id);
  assert(us.folders[0].sources.every((s) => s.catalogId.startsWith('archives-v3-series-paramount-plus-')));
  assert(fr.folders[0].sources.every((s) => s.catalogId.startsWith('archives-fr-v1-series-paramount-plus-')));
});

test('health endpoint is green when both regions coexist safely', async () => {
  const response = await call('/health');
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.text);
  assert.equal(body.ok, true);
  assert.equal(body.safe, true);
});
