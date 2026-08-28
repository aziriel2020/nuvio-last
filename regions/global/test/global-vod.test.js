'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../api/index');

const fixedNow = new Date('2026-08-24T12:00:00Z');
const tz = 'Europe/Paris';

function call(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = {
      method: 'GET',
      url: path,
      headers: { host: 'global.example', 'x-forwarded-proto': 'https', 'x-vercel-ip-timezone': tz, ...headers }
    };
    const out = { statusCode: 200, headers: {}, body: Buffer.alloc(0) };
    const chunks = [];
    const res = {
      get statusCode() { return out.statusCode; },
      set statusCode(v) { out.statusCode = v; },
      setHeader(k, v) { out.headers[String(k).toLowerCase()] = v; },
      getHeader(k) { return out.headers[String(k).toLowerCase()]; },
      end(v = '') {
        if (v) chunks.push(Buffer.isBuffer(v) ? v : Buffer.from(String(v)));
        out.body = Buffer.concat(chunks);
        out.text = out.body.toString('utf8');
        resolve(out);
      }
    };
    Promise.resolve(api(req, res)).catch(reject);
  });
}

test('global manifest exposes anime + VOD catalogs through 2030', () => {
  const manifest = api._internals.buildManifest('https://global.example', fixedNow, tz);
  assert.equal(manifest.id, 'com.nuvio.calendar.archives.global.coexist');
  assert.equal(manifest.name, 'Nuvio Global Archives');
  assert.deepEqual(manifest.types, ['movie', 'series']);
  assert.equal(manifest.catalogs.length, 591);
  assert(manifest.catalogs.every((catalog) => catalog.showInHome === false));
  assert(manifest.catalogs.some((catalog) => catalog.id === 'archives-global-v1-series-anime-asia-today'));
  assert(manifest.catalogs.some((catalog) => catalog.id === 'archives-global-v1-movie-vod-global-2030-12'));
});


test('global Anime and VOD collection sources resolve to named manifest periods', () => {
  const manifest = api._internals.buildManifest('https://global.example', fixedNow, tz);
  const collections = api._internals.buildNuvioCollectionsImport(fixedNow, tz, 'https://global.example');
  const names = new Map(manifest.catalogs.map((catalog) => [`${catalog.type}:${catalog.id}`, catalog.name]));
  const catalogResource = manifest.resources.find((resource) => resource.name === 'catalog');
  assert.deepEqual(new Set(catalogResource.types), new Set(['movie','series']));

  const checks = [
    collections[0].folders.find((folder) => folder.title === 'Séries'),
    collections[0].folders.find((folder) => folder.title === 'Films'),
    collections[1].folders.find((folder) => folder.title === 'Films')
  ];
  for (const folder of checks) {
    assert(folder);
    const labels = folder.sources.map((source) => names.get(`${source.type}:${source.catalogId}`));
    assert(labels.every(Boolean), `unresolved manifest catalog in ${folder.id}`);
    assert.deepEqual(labels.slice(0,5), ['Aujourd’hui','Demain','Hier','Semaine passée','La semaine suivante']);
    assert.equal(labels[5], 'Décembre 2030');
    assert.equal(labels.at(-1), 'Janvier 2015');
  }
});

test('global routes return the same named periods used by imported Anime and VOD sources', async () => {
  process.env.NUVIO_NOW_OVERRIDE='2026-08-24T12:00:00Z';
  try {
    const manifest = JSON.parse((await call('/manifest.json')).text);
    const collections = JSON.parse((await call('/nuvio-collections.json')).text);
    const names = new Map(manifest.catalogs.map((catalog) => [`${catalog.type}:${catalog.id}`, catalog.name]));
    for (const collection of collections) {
      for (const folder of collection.folders) {
        const labels = folder.sources.map((source) => names.get(`${source.type}:${source.catalogId}`));
        assert(labels.every(Boolean), `${collection.title} / ${folder.title} contains an unresolved period`);
        assert.deepEqual(labels.slice(0,5), ['Aujourd’hui','Demain','Hier','Semaine passée','La semaine suivante']);
      }
    }
  } finally {
    delete process.env.NUVIO_NOW_OVERRIDE;
  }
});

test('global collections expose Anime (series+films) plus VOD films', () => {
  const collections = api._internals.buildNuvioCollectionsImport(fixedNow, tz, 'https://global.example');
  assert.equal(collections.length, 2);
  const anime = collections[0];
  const vod = collections[1];
  assert.equal(anime.id, 'calendar-archives-global-anime');
  assert.equal(anime.title, '🌍 Anime Japon + Corée');
  assert.deepEqual(anime.folders.map((folder) => folder.title), ['Séries','Films']);
  assert.equal(anime.folders[0].sources.length, 197);
  assert.equal(anime.folders[1].sources.length, 197);
  assert.equal(vod.id, 'calendar-archives-global-vod');
  assert.equal(vod.title, '🌍 VOD Mondiale');
  assert.deepEqual(vod.folders.map((folder) => folder.title), ['Films']);
  assert.equal(vod.folders[0].sources.length, 197);
  assert.deepEqual(vod.folders[0].sources.slice(0, 5).map((source) => source.catalogId), [
    'archives-global-v1-movie-vod-global-today',
    'archives-global-v1-movie-vod-global-tomorrow',
    'archives-global-v1-movie-vod-global-yesterday',
    'archives-global-v1-movie-vod-global-lastweek',
    'archives-global-v1-movie-vod-global-nextweek'
  ]);
  assert(vod.folders[0].sources.every((source) => source.addonId === 'com.nuvio.calendar.archives.global.coexist'));
  assert.match(vod.folders[0].coverImageUrl, /^https:\/\/global\.example\/platform-category-card\.svg\?provider=vod-global/);
});

test('global VOD discover uses Digital type 4 without region or watch provider filters', () => {
  const params = api._internals.vodDiscoverParams({ start: '2026-08-24', end: '2026-08-24' }, 1);
  assert.equal(params.with_release_type, '4');
  assert.equal(params['release_date.gte'], '2026-08-24');
  assert.equal(params['release_date.lte'], '2026-08-24');
  assert.equal(Object.hasOwn(params, 'region'), false);
  assert.equal(Object.hasOwn(params, 'watch_region'), false);
  assert.equal(Object.hasOwn(params, 'with_watch_monetization_types'), false);
  assert.equal(Object.hasOwn(params, 'with_watch_providers'), false);
});

test('global VOD picks the earliest Digital date across every country', () => {
  const details = {
    release_dates: {
      results: [
        { iso_3166_1: 'US', release_dates: [{ type: 4, release_date: '2026-08-26T00:00:00.000Z' }] },
        { iso_3166_1: 'FR', release_dates: [{ type: 4, release_date: '2026-08-25T00:00:00.000Z' }] },
        { iso_3166_1: 'JP', release_dates: [{ type: 4, release_date: '2026-08-24T00:00:00.000Z' }] }
      ]
    }
  };
  const dates = require('../src/calendar').globalDigitalReleaseDates(details);
  assert.deepEqual(dates.map((entry) => [entry.date, entry.country]), [
    ['2026-08-24', 'JP'], ['2026-08-25', 'FR'], ['2026-08-26', 'US']
  ]);
  const selected = require('../src/calendar').selectDigitalRelease(details, {
    start: '2026-08-24', end: '2026-08-24', today: '2026-08-24'
  });
  assert.equal(selected.release.date, '2026-08-24');
  assert.equal(selected.release.country, 'JP');
});

test('a later-country Digital release does not make the film appear twice globally', () => {
  const calendar = require('../src/calendar');
  const details = {
    release_dates: {
      results: [
        { iso_3166_1: 'JP', release_dates: [{ type: 4, release_date: '2026-08-24T00:00:00.000Z' }] },
        { iso_3166_1: 'US', release_dates: [{ type: 4, release_date: '2026-08-26T00:00:00.000Z' }] }
      ]
    }
  };
  const selected = calendar.selectDigitalRelease(details, {
    start: '2026-08-26', end: '2026-08-26', today: '2026-08-26'
  });
  assert.equal(selected.release, null);
  assert.equal(selected.reason, 'past');
});

test('global VOD catalog accepts a film with no watch providers when first worldwide Digital date is in window', async () => {
  const oldFetch = global.fetch;
  const oldKey = process.env.TMDB_API_KEY;
  process.env.TMDB_API_KEY = 'test-key';
  global.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.pathname.endsWith('/discover/movie')) {
      assert.equal(u.searchParams.get('with_release_type'), '4');
      assert.equal(u.searchParams.has('region'), false);
      assert.equal(u.searchParams.has('watch_region'), false);
      return new Response(JSON.stringify({ page: 1, total_pages: 1, results: [{ id: 424242 }] }), {
        status: 200, headers: { 'content-type': 'application/json' }
      });
    }
    if (u.pathname.endsWith('/movie/424242')) {
      return new Response(JSON.stringify({
        id: 424242,
        title: 'Worldwide Digital Test',
        overview: 'No buy/rent provider required',
        poster_path: '/p.jpg',
        backdrop_path: '/b.jpg',
        external_ids: { imdb_id: 'tt4242424' },
        release_dates: {
          results: [
            { iso_3166_1: 'JP', release_dates: [{ type: 4, release_date: '2026-08-24T00:00:00.000Z' }] },
            { iso_3166_1: 'US', release_dates: [{ type: 4, release_date: '2026-08-26T00:00:00.000Z' }] }
          ]
        }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected ${u.pathname}`);
  };

  try {
    api._internals.catalogCache.clear?.();
    api._internals.detailsCache.clear?.();
    const catalog = api._internals.resolveArchiveCatalog(
      'archives-global-v1-movie-vod-global-today', 'movie', fixedNow, tz
    );
    const result = await api._internals.buildVodCatalog({ catalog, timeZone: tz, now: fixedNow, useCache: false });
    assert.equal(result.metas.length, 1);
    assert.equal(result.metas[0].name, 'Worldwide Digital Test');
    assert.match(result.metas[0].releaseInfo, /Digital/i);
  } finally {
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.TMDB_API_KEY;
    else process.env.TMDB_API_KEY = oldKey;
  }
});

test('future global VOD month returns empty without upstream calls', async () => {
  process.env.NUVIO_NOW_OVERRIDE = '2026-08-24T12:00:00Z';
  const oldFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls += 1; throw new Error('must not call'); };
  try {
    const r = await call('/catalog/movie/archives-global-v1-movie-vod-global-2030-12.json');
    assert.equal(r.statusCode, 200);
    assert.deepEqual(JSON.parse(r.text), { metas: [] });
    assert.equal(calls, 0);
  } finally {
    global.fetch = oldFetch;
    delete process.env.NUVIO_NOW_OVERRIDE;
  }
});


test('anime title mapping tolerates AniList/TMDb localization without ignoring JP/KR origin', () => {
  const media = { title: { english: 'The Hero Academy', romaji: 'Hero Academia' }, seasonYear: 2026, countryOfOrigin: 'JP' };
  const close = { name: 'My Hero Academia', original_name: 'Hero Academia', first_air_date: '2026-04-01', original_language: 'ja' };
  const wrongCountry = { ...close, original_language: 'ko' };
  assert(api._internals.animeTitleSimilarity(close, media) >= 0.24);
  assert.equal(api._internals.candidateMatchesAnime(wrongCountry, media, true), false);
});

test('global anime movie discovery queries Japan and Korea separately for the selected period', async () => {
  const oldFetch = global.fetch;
  const oldKey = process.env.TMDB_API_KEY;
  process.env.TMDB_API_KEY = 'test-key';
  const seen = [];
  global.fetch = async (url) => {
    const u = new URL(String(url));
    if (!u.pathname.endsWith('/discover/movie')) throw new Error(`unexpected ${u.pathname}`);
    seen.push({
      region: u.searchParams.get('region'),
      language: u.searchParams.get('with_original_language'),
      gte: u.searchParams.get('release_date.gte'),
      lte: u.searchParams.get('release_date.lte')
    });
    const lang = u.searchParams.get('with_original_language');
    return {
      ok: true, status: 200, headers: { get: () => null },
      json: async () => ({
        page: 1, total_pages: 1,
        results: lang === 'ja'
          ? [{ id: 101, title: 'JP Anime', release_date: '2026-08-24', original_language: 'ja' }]
          : [{ id: 202, title: 'KR Animation', release_date: '2026-08-24', original_language: 'ko' }]
      })
    };
  };
  try {
    const rows = await api._internals.discoverGlobalAnimeMovieCandidates({ start: '2026-08-24', end: '2026-08-24' });
    assert.deepEqual(new Set(seen.map((x) => `${x.region}:${x.language}`)), new Set(['JP:ja','KR:ko']));
    assert(seen.every((x) => x.gte === '2026-08-24' && x.lte === '2026-08-24'));
    assert.deepEqual(rows.map((x) => x.id).sort((a,b)=>a-b), [101,202]);
  } finally {
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.TMDB_API_KEY; else process.env.TMDB_API_KEY = oldKey;
  }
});
