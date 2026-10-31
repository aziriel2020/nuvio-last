'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/index');

async function fetchJson(path) {
  return new Promise((resolve, reject) => {
    const req = { method: 'GET', url: path, headers: {
      host: 'nuvio.test', 'x-forwarded-proto': 'https',
      'x-nuvio-timezone': 'Europe/Brussels'
    }};
    const response = { statusCode: 200, headers: {} };
    const res = {
      get statusCode() { return response.statusCode; },
      set statusCode(value) { response.statusCode = value; },
      setHeader(name, value) { response.headers[name.toLowerCase()] = value; },
      end(body = '') {
        try { resolve({ ...response, data: JSON.parse(String(body)) }); } catch (error) { reject(error); }
      }
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

function signature(collections) {
  return collections.map(({ id, folders }) => ({
    id,
    folders: folders.map(({ id: folderId, sources, catalogSources }) => ({
      id: folderId,
      sources,
      catalogSources
    }))
  }));
}

for (const [original, mobile] of [
  ['/nuvio-collections-fr-global-tr-usa.json', '/nuvio-collections-mobile.json'],
  ['/nuvio-collections-movies.json', '/nuvio-collections-movies-mobile.json'],
  ['/nuvio-collections-series.json', '/nuvio-collections-series-mobile.json']
]) {
  test(`Mobile tabs preserve all source folders and periods: ${mobile}`, async () => {
    const [baseline, optimized] = await Promise.all([fetchJson(original), fetchJson(mobile)]);
    assert.equal(baseline.statusCode, 200);
    assert.equal(optimized.statusCode, 200);
    assert(baseline.data.length > 0);
    assert.deepEqual(signature(optimized.data), signature(baseline.data),
      'No catalog, period or collection ID may disappear or change');
    for (const collection of optimized.data) {
      assert.equal(collection.viewMode, 'TABBED_GRID');
      assert.equal(collection.showAllTab, false);
      assert(collection.folders.length > 0);
      for (const folder of collection.folders) {
        assert.equal(folder.hideTitle, false, 'Mobile category title should remain visible');
        assert(folder.coverImageUrl, 'Must retain a category cover');
        assert(folder.sources?.length || folder.catalogSources?.length, 'Must retain source periods');
      }
    }
  });
}

test('The opt-in mobile collection transform does not mutate existing Shield / Desktop collections', () => {
  const source = { id: 'demo', title: 'Test', viewMode: 'FOLLOW_LAYOUT', showAllTab: true,
    folders: [{ id: 'movies', title: 'Films', coverImageUrl: 'https://nuvio.test/test.webp',
      hideTitle: true, sources: [{ addonId: 'demo', type: 'movie', catalogId: 'demo-today' }]
    }]
  };
  const before = JSON.stringify(source);
  const mobile = handler._internals.mobileizeCollectionArt(source);
  assert.equal(JSON.stringify(source), before);
  assert.equal(mobile.viewMode, 'TABBED_GRID');
  assert.equal(mobile.folders[0].sources[0].catalogId, 'demo-today');
});
