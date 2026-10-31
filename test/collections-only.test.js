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

test('TV manifests keep period names in Collections while hiding sources from Home/Search/Discover', async () => {
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
    assert.deepEqual(
      tv.catalogs.map((c) => [c.id, c.type, c.name]),
      original.catalogs.map((c) => [c.id, c.type, c.name]),
      `${region} all period labels and source IDs must remain resolvable`
    );
    for (const catalog of tv.catalogs) {
      assert(catalog.name && !['Films', 'Séries'].includes(catalog.name),
        `${region} no generic type-only period names`);
      assert.equal(catalog.showInHome, false, `${region} no Home poster fetch`);
      const searchRequired = catalog.extra.some((e) => e.name === 'search' && e.isRequired);
      const genreRequired = catalog.extra.some((e) => e.name === 'genre' && e.isRequired);
      assert(searchRequired && genreRequired,
        `${region} TV home/discover/search exclusions are required`);
      // Mirror NuvioTV source code: Home shouldShowOnHome excludes search-only;
      // SearchViewModel.loadDiscoverCatalogs excludes required search; global
      // isSearchable excludes any non-search required extra (required genre).
      const homeVisible = !searchRequired && catalog.showInHome;
      const discoverVisible = !searchRequired;
      const searchable = catalog.extra.some((e) => e.name === 'search') &&
        catalog.extra.every((e) => !e.isRequired || e.name === 'search');
      assert.equal(homeVisible, false);
      assert.equal(discoverVisible, false);
      assert.equal(searchable, false);
    }
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
  assert.deepEqual(
    tv.catalogs.map((c) => [c.id, c.type, c.name]),
    regular.catalogs.map((c) => [c.id, c.type, c.name])
  );
});

test('TV concise period descriptor carries genuine month names and pagination', () => {
  const catalog = handler._internals.shieldCollectionOnlyCatalog({
    type: 'movie', id: 'archives-fr-movie-demo-2026-10',
    name: 'Octobre 2026', showInHome: false,
    pageSize: 100, extra: [{ name: 'skip', isRequired: false }]
  });
  assert.equal(catalog.name, 'Octobre 2026');
  assert.equal(catalog.pageSize, 100);
  assert.equal(catalog.extra.some((e) => e.name === 'skip'), true);
  assert.equal(catalog.extra.some((e) => e.name === 'search' && e.isRequired), true);
  assert.equal(catalog.extra.some((e) => e.name === 'genre' && e.isRequired), true);
  assert.equal(catalog.extra.length, 3, 'keep compact metadata to reduce transfer size');
});
