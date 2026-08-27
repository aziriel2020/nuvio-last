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

test('single deployment exposes three distinct addon manifests', async () => {
  const us = JSON.parse((await call('/us/manifest.json')).text);
  const fr = JSON.parse((await call('/fr/manifest.json')).text);
  const globalVod = JSON.parse((await call('/global/manifest.json')).text);
  assert.equal(us.id, 'com.nuvio.calendar.archives.us.coexist');
  assert.equal(fr.id, 'com.nuvio.calendar.archives.fr.coexist');
  assert.equal(globalVod.id, 'com.nuvio.calendar.archives.global.coexist');
  assert.equal(new Set([us.id, fr.id, globalVod.id]).size, 3);
  assert.equal(us.catalogs.length, 4158);
  assert.equal(fr.catalogs.length, 4774);
  assert.equal(globalVod.catalogs.length, 231);
});

test('combined import has 28 unique collections: France, Global Anime/VOD, then USA', async () => {
  const response = await call('/nuvio-collections-fr-global-usa.json');
  assert.equal(response.statusCode, 200);
  const collections = JSON.parse(response.text);
  assert.equal(collections.length, 28);
  const ids = collections.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(collections.filter((c) => c.title.startsWith('🇫🇷 ')).length, 15);
  assert.equal(collections.filter((c) => c.title.startsWith('🌍 ')).length, 2);
  assert.equal(collections.filter((c) => c.title.startsWith('🇺🇸 ')).length, 11);
  assert.equal(collections[0].title, '🇫🇷 Netflix');
  assert.equal(collections[13].title, '🇫🇷 VOD France');
  assert.equal(collections[14].title, '🇫🇷 Genres TMDb');
  assert.equal(collections[15].title, '🌍 Anime Japon + Corée');
  assert.equal(collections[16].title, '🌍 VOD Mondiale');
  assert.equal(collections[17].title, '🇺🇸 Netflix');
  assert.equal(collections.at(-1).title, '🇺🇸 TMDb Genres');
});


test('France stays first, Global VOD is next, and USA remains after them on Modern Shield', async () => {
  const collections = JSON.parse((await call('/nuvio-collections-fr-global-usa.json')).text);
  const fr = collections.filter((c) => c.title.startsWith('🇫🇷 '));
  const globalVod = collections.filter((c) => c.title.startsWith('🌍 '));
  const us = collections.filter((c) => c.title.startsWith('🇺🇸 '));
  assert.equal(fr.length, 15);
  assert.equal(globalVod.length, 2);
  assert.equal(us.length, 11);
  assert(fr.every((c) => c.pinToTop === true));
  assert(globalVod.every((c) => c.pinToTop === true));
  assert(us.every((c) => c.pinToTop === false));
});


test('USA, France and Global VOD collection sources always reference their own addon', async () => {
  const collections = JSON.parse((await call('/nuvio-collections-fr-global-usa.json')).text);
  const us = collections.filter((c) => c.title.startsWith('🇺🇸 '));
  const fr = collections.filter((c) => c.title.startsWith('🇫🇷 '));
  const globalVod = collections.filter((c) => c.title.startsWith('🌍 '));
  for (const collection of us) for (const folder of collection.folders) {
    assert(folder.sources.every((source) => source.addonId === 'com.nuvio.calendar.archives.us.coexist'));
  }
  for (const collection of fr) for (const folder of collection.folders) {
    assert(folder.sources.every((source) => source.addonId === 'com.nuvio.calendar.archives.fr.coexist'));
  }
  for (const collection of globalVod) for (const folder of collection.folders) {
    assert(folder.sources.every((source) => source.addonId === 'com.nuvio.calendar.archives.global.coexist'));
  }
});


test('all hosted visual URLs stay inside the correct regional/global route prefix', async () => {
  const collections = JSON.parse((await call('/nuvio-collections-fr-global-usa.json')).text);
  for (const collection of collections) {
    const prefix = collection.title.startsWith('🇺🇸 ')
      ? 'https://coexist.example/us/'
      : collection.title.startsWith('🌍 ')
        ? 'https://coexist.example/global/'
        : 'https://coexist.example/fr/';
    assert(collection.backdropImageUrl?.startsWith(prefix));
    for (const folder of collection.folders) {
      assert(folder.coverImageUrl?.startsWith(prefix));
      assert(folder.heroBackdropUrl?.startsWith(prefix));
      assert(folder.titleLogoUrl?.startsWith(prefix));
    }
  }
});


test('Modern content artwork URLs keep the /fr and /us sub-path instead of falling back to the root', () => {
  const frApi = handler._internals.frHandler._internals;
  const usApi = handler._internals.usHandler._internals;
  const globalApi = handler._internals.globalHandler._internals;
  const meta = {
    id: 'tt1234567', type: 'series', name: 'Demo',
    poster: 'https://image.tmdb.org/t/p/w500/demo.jpg',
    background: 'https://image.tmdb.org/t/p/original/demo-bg.jpg',
    landscapePoster: 'https://image.tmdb.org/t/p/original/demo-bg.jpg',
    released: '2026-08-26', _calendarProvider: 'Netflix', _calendarSource: 'tmdb-streaming'
  };
  const catalog = { type: 'series', period: 'today', cardProvider: 'Netflix', name: 'Aujourd’hui' };
  const frDecorated = frApi.decorateCatalogMetas('https://coexist.example/fr', [meta], catalog, 'Europe/Paris')[0];
  const usDecorated = usApi.decorateCatalogMetas('https://coexist.example/us', [meta], catalog, 'America/New_York')[0];
  const globalCatalog = { type: 'movie', period: 'today', cardProvider: 'VOD Mondiale', name: 'Aujourd’hui' };
  const globalMeta = { ...meta, type: 'movie', _calendarProvider: 'VOD Mondiale', _calendarSource: 'tmdb-vod' };
  const globalDecorated = globalApi.decorateCatalogMetas('https://coexist.example/global', [globalMeta], globalCatalog, 'Europe/Paris')[0];
  assert.match(frDecorated.background, /^https:\/\/coexist\.example\/fr\/calendar-card\.svg\?/);
  assert.match(frDecorated.poster, /^https:\/\/coexist\.example\/fr\/calendar-card\.svg\?/);
  assert.match(frDecorated.logo, /^https:\/\/coexist\.example\/fr\/calendar-transparent-logo\.svg\?/);
  assert.match(usDecorated.background, /^https:\/\/coexist\.example\/us\/calendar-card\.svg\?/);
  assert.match(usDecorated.poster, /^https:\/\/coexist\.example\/us\/calendar-card\.svg\?/);
  assert.match(usDecorated.logo, /^https:\/\/coexist\.example\/us\/calendar-transparent-logo\.svg\?/);
  assert.match(globalDecorated.background, /^https:\/\/coexist\.example\/global\/calendar-card\.svg\?/);
  assert.match(globalDecorated.poster, /^https:\/\/coexist\.example\/global\/calendar-card\.svg\?/);
});

test('regional image routes are reachable through the wrapper', async () => {
  const us = await call('/us/platform-category-card.svg?provider=netflix&category=series');
  const fr = await call('/fr/platform-category-card.svg?provider=canal-plus&category=films');
  const globalVod = await call('/global/platform-category-card.svg?provider=vod-global&category=films');
  assert.equal(us.statusCode, 200);
  assert.equal(fr.statusCode, 200);
  assert.equal(globalVod.statusCode, 200);
  assert.match(us.headers['content-type'], /image\/svg\+xml/);
  assert.match(fr.headers['content-type'], /image\/svg\+xml/);
  assert.match(globalVod.headers['content-type'], /image\/svg\+xml/);
  assert.match(us.text, /SÉRIES/);
  assert.match(fr.text, /FILMS/);
  assert.match(globalVod.text, /VOD Mondiale|VOD MONDIALE/i);
});


test('regional Modern calendar-card SVG routes are reachable and embed artwork', async () => {
  const oldFetch = global.fetch;
  global.fetch = async (url) => {
    const value = String(url);
    if (value.startsWith('https://image.tmdb.org/')) {
      return new Response(Uint8Array.from([137,80,78,71,13,10,26,10]), {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': '8' }
      });
    }
    throw new Error(`unexpected fetch ${value}`);
  };
  try {
    const src = encodeURIComponent('https://image.tmdb.org/t/p/w780/demo.jpg');
    const fr = await call(`/fr/calendar-card.svg?src=${src}&layout=landscape&title=Demo&provider=Netflix&type=series`);
    const us = await call(`/us/calendar-card.svg?src=${src}&layout=landscape&title=Demo&provider=Netflix&type=series`);
    const globalVod = await call(`/global/calendar-card.svg?src=${src}&layout=landscape&title=Demo&provider=VOD%20Mondiale&type=movie`);
    assert.equal(fr.statusCode, 200);
    assert.equal(us.statusCode, 200);
    assert.equal(globalVod.statusCode, 200);
    assert.match(fr.headers['content-type'], /image\/svg\+xml/);
    assert.match(us.headers['content-type'], /image\/svg\+xml/);
    assert.match(globalVod.headers['content-type'], /image\/svg\+xml/);
    assert.match(fr.text, /data:image\/png;base64,/);
    assert.match(us.text, /data:image\/png;base64,/);
    assert.match(globalVod.text, /data:image\/png;base64,/);
  } finally {
    global.fetch = oldFetch;
  }
});

test('coexistence checker reports zero collisions', async () => {
  const report = JSON.parse((await call('/coexistence-check.json')).text);
  assert.equal(report.safe, true);
  assert.deepEqual(report.duplicateCollectionIds, []);
  assert.deepEqual(report.duplicateFolderKeys, []);
  assert.deepEqual(report.duplicateCatalogKeys, []);
  assert.deepEqual(report.addonIds, [
    'com.nuvio.calendar.archives.fr.coexist',
    'com.nuvio.calendar.archives.global.coexist',
    'com.nuvio.calendar.archives.us.coexist'
  ]);
  assert.equal(report.globalCollectionCount, 2);
});

test('USA and France Paramount+ remain distinct and both expose Series and Films', async () => {
  const collections = JSON.parse((await call('/nuvio-collections-fr-global-usa.json')).text);
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
