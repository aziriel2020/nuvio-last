'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/index');

function request(path) {
  return new Promise((resolve, reject) => {
    const req = { method: 'GET', url: path, headers: {
      host: 'nuvio.test', 'x-forwarded-proto': 'https',
      'x-vercel-ip-timezone': 'Europe/Brussels'
    } };
    const out = { status: 200, headers: {}, body: '' };
    const res = {
      get statusCode() { return out.status; },
      set statusCode(value) { out.status = value; },
      setHeader(name, value) { out.headers[name.toLowerCase()] = value; },
      end(body = '') { out.body = String(body); resolve(out); }
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

test('TV collection-only manifests hide internal catalogs without altering canonical addons', async () => {
  for (const region of ['fr', 'us', 'tr', 'global', 'movies', 'series-v2']) {
    const [visible, hidden] = await Promise.all([
      request(`/${region}/manifest.json`),
      request(`/${region}/collections-only/manifest.json`)
    ]);
    assert.equal(visible.status, 200, `${region} default manifest`);
    assert.equal(hidden.status, 200, `${region} TV manifest`);
    const original = JSON.parse(visible.body);
    const tv = JSON.parse(hidden.body);
    assert(original.catalogs.length > 0, `${region} full manifest preserved`);
    assert.deepEqual(tv.catalogs, [], `${region} must not advertise child catalogs`);
    assert.equal(tv.id, original.id, `${region} collection addonId compatibility`);
    assert.equal(tv.version, original.version);
    assert.deepEqual(tv.resources, original.resources);
    assert.deepEqual(tv.idPrefixes, original.idPrefixes);
    assert.deepEqual(tv.types, original.types);
    assert.equal(hidden.headers['cache-control'], 'no-store');
  }
});

test('TV addon route aliases still serve assets and preserve source URL functionality', async () => {
  for (const region of ['fr', 'us', 'tr', 'global']) {
    const response = await request(`/${region}/collections-only/logo.svg`);
    assert.equal(response.status, 200, `${region} alternate base path`);
    assert.match(response.body, /<svg/);
  }
  // No downstream catalog IDs, dates, import JSONs or normal manifest URLs change.
  const regular = JSON.parse((await request('/movies/manifest.json')).body);
  const tv = JSON.parse((await request('/movies/collections-only/manifest.json')).body);
  assert.equal(regular.id, tv.id);
  assert(regular.catalogs.length > 0);
  assert.equal(tv.catalogs.length, 0);
});
