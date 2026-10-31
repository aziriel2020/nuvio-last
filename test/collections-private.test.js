'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/index');

function request(route) {
  return new Promise((resolve, reject) => {
    const req = { method: 'GET', url: route, headers: {
      host: 'nuvio.test', 'x-forwarded-proto': 'https',
      'x-vercel-ip-timezone': 'Europe/Brussels'
    } };
    const out = { status: 200, headers: {}, body: '' };
    const res = {
      get statusCode() { return out.status; },
      set statusCode(value) { out.status = value; },
      setHeader(name, value) { out.headers[String(name).toLowerCase()] = value; },
      end(body = '') { out.body = String(body); resolve(out); }
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

// These match the predicates used by NuvioMobile cmp-rewrite and
// NuvioDesktop Dev in HomeCatalogDefinitions and SearchRepository.
// The private extra is intentionally required, custom, and non-search.
function appearsOnHome(catalog) {
  return !catalog.extra?.some((extra) => extra.isRequired);
}
function appearsInDiscover(catalog) {
  if (catalog.extra?.some((extra) => extra.name === 'search' && extra.isRequired)) return false;
  return !catalog.extra?.some((extra) => {
    if (extra.name === 'genre') return extra.isRequired && !(extra.options || []).length;
    if (extra.name === 'skip' || extra.name === 'search') return false;
    return extra.isRequired;
  });
}
function appearsInSearch(catalog) {
  return Boolean(catalog.extra?.some((extra) => extra.name === 'search')) &&
    !catalog.extra.some((extra) => extra.isRequired && extra.name !== 'search');
}

test('opt-in private manifests are still declared for Mobile/Desktop Collections but never become Home or Discover rows', async () => {
  for (const region of ['fr', 'us', 'tr', 'global', 'movies', 'series-v2']) {
    const [canonicalResponse, privateResponse, tvResponse] = await Promise.all([
      request(`/${region}/manifest.json`),
      request(`/${region}/collections-private/manifest.json`),
      request(`/${region}/collections-only/manifest.json`)
    ]);
    assert.equal(canonicalResponse.status, 200, region);
    assert.equal(privateResponse.status, 200, region);
    assert.equal(tvResponse.status, 200, region);

    const canonical = JSON.parse(canonicalResponse.body);
    const hidden = JSON.parse(privateResponse.body);
    const tv = JSON.parse(tvResponse.body);
    assert(canonical.catalogs.length > 0, region + ' must have declared catalogs');
    assert.equal(hidden.catalogs.length, canonical.catalogs.length, region);
    assert.deepEqual(tv.catalogs, [], 'TV profile unchanged: ' + region);
    for (const key of ['id', 'version', 'types', 'resources', 'idPrefixes', 'name']) {
      assert.deepEqual(hidden[key], canonical[key], region + ' ' + key);
    }
    assert.equal(privateResponse.headers['cache-control'], 'no-store');

    canonical.catalogs.forEach((catalog, index) => {
      const protectedCatalog = hidden.catalogs[index];
      for (const key of ['id', 'type', 'name']) {
        assert.deepEqual(protectedCatalog[key], catalog[key], region + ' ' + key + ' ' + index);
      }
      const originalExtras = Array.isArray(catalog.extra) ? catalog.extra : [];
      assert.deepEqual(
        protectedCatalog.extra.filter((item) => item.name !== 'nuvio_collection_only'),
        originalExtras.filter((item) => item.name !== 'nuvio_collection_only'),
        region + ' original source extras'
      );
      const markers = protectedCatalog.extra.filter((item) => item.name === 'nuvio_collection_only');
      assert.deepEqual(markers, [{ name: 'nuvio_collection_only', isRequired: true }]);
      assert.equal(protectedCatalog.showInHome, false);
      assert.equal(appearsOnHome(protectedCatalog), false, region + ' Home ' + index);
      assert.equal(appearsInDiscover(protectedCatalog), false, region + ' Discover ' + index);
      assert.equal(appearsInSearch(protectedCatalog), false, region + ' Search ' + index);
    });
  }
});

test('Mobile/Desktop alternate addon URLs delegate assets while source IDs and calendar imports stay on canonical routes', async () => {
  for (const region of ['fr', 'us', 'tr', 'global']) {
    const [canonical, hidden] = await Promise.all([
      request(`/${region}/logo.svg`),
      request(`/${region}/collections-private/logo.svg`)
    ]);
    assert.equal(hidden.status, canonical.status, region);
    assert.match(hidden.body, /<svg/, region);
  }

  // No calendar collections or exports are rewritten by this addon profile.
  const [canonical, privateVersion] = await Promise.all([
    request('/movies/manifest.json'),
    request('/movies/collections-private/manifest.json')
  ]);
  const oldCatalogIds = JSON.parse(canonical.body).catalogs.map((c) => [c.type, c.id]);
  const newCatalogIds = JSON.parse(privateVersion.body).catalogs.map((c) => [c.type, c.id]);
  assert.deepEqual(newCatalogIds, oldCatalogIds);
});
