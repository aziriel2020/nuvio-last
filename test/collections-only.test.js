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


test('Mobile/Desktop collection-only manifests exclude all internal catalogs from Home, Search and Discover but retain collection sources', async () => {
  for (const region of ['fr', 'us', 'tr', 'global', 'movies', 'series-v2']) {
    const regular = await request(`/${region}/manifest.json`);
    const client = await request(`/${region}/collections-only-mobile-desktop/manifest.json`);
    assert.equal(regular.status, 200, `${region} canonical manifest`);
    assert.equal(client.status, 200, `${region} mobile/desktop manifest`);
    assert.equal(client.headers['cache-control'], 'no-store');
    const original = JSON.parse(regular.body);
    const hidden = JSON.parse(client.body);
    assert.equal(hidden.id, original.id, `${region} stable addonId`);
    assert.equal(hidden.version, original.version);
    assert.deepEqual(hidden.resources, original.resources);
    assert.deepEqual(hidden.types, original.types);
    assert.deepEqual(hidden.idPrefixes, original.idPrefixes);
    assert.equal(hidden.catalogs.length, original.catalogs.length, `${region} retain every source catalog`);
    assert(hidden.catalogs.length > 0, `${region} source catalogs exist`);

    for (let i = 0; i < original.catalogs.length; i++) {
      const canonical = original.catalogs[i];
      const catalog = hidden.catalogs[i];
      assert.equal(catalog.id, canonical.id);
      assert.equal(catalog.type, canonical.type);
      assert.equal(catalog.name, canonical.name);
      assert.equal(catalog.showInHome, false);

      const extras = catalog.extra;
      const genre = extras.filter((entry) => entry.name === 'genre');
      assert.equal(genre.length, 1, `${region} single required genre flag`);
      assert.equal(genre[0].isRequired, true);
      assert.deepEqual(genre[0].options, []);
      assert.equal(extras.some((entry) => entry.isRequired && entry.name !== 'genre'), false);
      assert.equal(extras.some((entry) => entry.name === 'skip'), canonical.extra.some((entry) => entry.name === 'skip'));

      // Mirrors Nuvio Mobile/Desktop's actual upstream predicates. All catalogs
      // must be hidden in Home, Search and Discover, but selectable in Collections.
      const home = extras.every((entry) => !entry.isRequired);
      const search = extras.some((entry) => entry.name === 'search') &&
        extras.every((entry) => !entry.isRequired || entry.name === 'search');
      const discover = !extras.some((entry) => entry.name === 'search' && entry.isRequired) &&
        extras.every((entry) => entry.name === 'genre'
          ? !(entry.isRequired && entry.options.length === 0)
          : (entry.name === 'skip' || entry.name === 'search' || !entry.isRequired));
      const collection = extras.every((entry) => !entry.isRequired || entry.name === 'genre');
      assert.equal(home, false, `${region}/${catalog.id} must not load Home posters`);
      assert.equal(search, false, `${region}/${catalog.id} must not start search requests`);
      assert.equal(discover, false, `${region}/${catalog.id} must not appear in Discover`);
      assert.equal(collection, true, `${region}/${catalog.id} must remain available to Collections`);
    }
  }
});

test('Mobile/Desktop alternate base path still delegates to the canonical addon handler', async () => {
  for (const region of ['fr', 'us', 'tr', 'global']) {
    const response = await request(`/${region}/collections-only-mobile-desktop/logo.svg`);
    assert.equal(response.status, 200, `${region} Mobile/Desktop addon asset`);
    assert.match(response.body, /<svg/);
  }
});
