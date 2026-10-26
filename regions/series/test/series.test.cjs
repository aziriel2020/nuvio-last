'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fromTmdb, fromTvmaze, windowFor, periods, isoDate, parseCatalog, ADDON_ID } = require('../src/model.cjs');
const { SeriesStore } = require('../src/store.cjs');
const addon = require('../index.cjs');
const { scanFrance, scanRecentAirings, runFranceJobs } = require('../../../scripts/sync-series-world.cjs');
const { offersInFrance, discoverParams } = require('../src/france.cjs');
const { decorateSeriesMetas } = require('../src/presentation.cjs');
const { V2_ADDON_ID, V2_VERSION } = require('../src/model.cjs');
const sharp = require('sharp');
const franceAddon = require('../../fr/api/index.js');
const NOW = new Date('2026-10-18T17:00:00Z');

function tmdb(id, overrides = {}) {
  return fromTmdb({ id, name: `Série ${id}`, first_air_date: '2026-10-12', origin_country: ['JP'],
    original_language: 'ja', genres: [{ id: 18 }], external_ids: {},
    'watch/providers': { results: { FR: { flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] } } }, ...overrides });
}
function maze(id, overrides = {}) {
  return fromTvmaze({ id, name: `Show ${id}`, type: 'Scripted', genres: ['Drama'], premiered: '2026-10-12', ...overrides });
}
function memory(t) { const store = new SeriesStore(':memory:'); t.after(() => store.close()); return store; }

test('all animation is excluded while Japanese live-action manga adaptations remain', (t) => {
  const store = memory(t);
  store.upsert(tmdb(1, { genres: [{ id: 16 }, { id: 18 }] }));
  store.upsert(maze(2, { type: 'Animation', genres: ['Comedy'], network: { country: { code: 'US' } } }));
  store.upsert(tmdb(3, { keywords: { results: [{ name: 'anime' }] } }));
  store.upsert(tmdb(4, { keywords: { results: [{ name: 'based on manga' }] } }));
  store.upsert(tmdb(5, { genres: [{ id: 10765 }], origin_country: ['KR'] }));
  assert.deepEqual(store.query({ now: NOW }).map((s) => s.name), ['Série 4', 'Série 5']);
  assert.equal(store.stats().animationExcluded, 3);
});

test('cross-source animation signals take precedence over live-action genre labels', (t) => {
  const store = memory(t);
  store.upsert(tmdb(1, { external_ids: { imdb_id: 'tt100' } }));
  store.upsert(maze(2, { type: 'Animation', externals: { imdb: 'tt100' } }));
  assert.equal(store.query({ now: NOW }).length, 0);
  store.override('tvmaze', 2, 'eligible', 'Classification contrôlée : série avec acteurs');
  assert.equal(store.query({ now: NOW }).length, 1);
});

test('undated series stay indexed but are outside dated catalogs', (t) => {
  const store = memory(t);
  store.upsert(maze(1, { genres: [], premiered: null, externals: { imdb: 'tt10' } }));
  store.upsert(tmdb(10, { genres: [], first_air_date: null, external_ids: { imdb_id: 'tt10' } }));
  store.upsert(tmdb(2, { genres: [], first_air_date: null }));
  assert.equal(store.query({ genre: 'unclassified', period: 'undated', now: NOW }).length, 0);
  assert.equal(store.query({ now: NOW }).length, 0);
  assert(store.row('tmdb:10'));
  assert.equal(store.stats().awaitingClassification, 1, 'unclassified medium stays in review until resolved');
});

test('IMDb identity merges sources, preserves French metadata, and does not merge namesakes', (t) => {
  const store = memory(t);
  store.upsert(maze(1, { name: 'English Title', externals: { imdb: 'tt500', thetvdb: 800 } }));
  store.upsert(tmdb(9, { name: 'Titre français', external_ids: { imdb_id: 'tt500', tvdb_id: 800 } }));
  store.upsert(maze(2, { name: 'English Title', externals: { imdb: 'tt501' } }));
  store.upsert(tmdb(10, { name: 'English Title', external_ids: { imdb_id: 'tt501' } }));
  store.upsert(maze(1, { name: 'English Title Updated', externals: { imdb: 'tt500', thetvdb: 800 } }));
  const rows = store.query({ now: NOW });
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.id === 'tt500').name, 'Titre français');
  assert.equal(store.sources('tmdb:9').length, 2);
  assert.equal(store.row('tvmaze:1').id, 'tmdb:9', 'previous source aliases keep working after a merge');
});

test('western pagination retains dated and undated history with deterministic ties', (t) => {
  const store = memory(t);
  for (let id = 1; id <= 237; id++) store.upsert(tmdb(id, { genres: [{ id: 37 }], first_air_date: id > 230 ? null : id < 100 ? '1960-01-01' : '2026-10-15' }));
  store.upsert(tmdb(999, { first_air_date: '2026-10-19' }));
  const first = store.query({ genre: '37', now: NOW });
  const second = store.query({ genre: '37', skip: 100, now: NOW });
  const third = store.query({ genre: '37', skip: 200, now: NOW });
  const ids = [...first, ...second, ...third].map((m) => m.id);
  assert.equal(ids.length, 237); assert.equal(new Set(ids).size, 237);
  assert.equal(third.at(-1).released, undefined);
  assert.equal(first[0].released.slice(0, 10), '2026-10-15');
  assert.equal(store.query({ period: 'tomorrow', now: NOW })[0].name, 'Série 999');
});

test('genres support multi-classification without duplicates and no platform/score threshold', (t) => {
  const store = memory(t);
  store.upsert(tmdb(1, { genres: [{ id: 18 }, { id: 80 }], vote_count: 0, popularity: 0, keywords: { results: [{ name: 'medical drama' }, { name: 'courtroom' }] } }));
  assert.equal(store.query({ genre: '18', now: NOW }).length, 1);
  assert.equal(store.query({ genre: '80', now: NOW }).length, 1);
  assert.equal(store.query({ genre: 'medical', now: NOW }).length, 1);
  assert.equal(store.query({ genre: 'legal', now: NOW }).length, 1);
});

test('new season views use season dates, exclude first seasons and specials, and deduplicate', (t) => {
  const store = memory(t);
  const record = tmdb(1, { first_air_date: '2005-01-01', seasons: [
    { season_number: 0, air_date: '2026-10-18' }, { season_number: 1, air_date: '2005-01-01' },
    { season_number: 2, air_date: '2026-10-10' }, { season_number: 3, air_date: '2026-10-16' },
    { season_number: 4, air_date: '2026-10-19' }
  ] });
  store.upsert(record);
  const rows = store.query({ mode: 'seasons', period: '2026-10', now: NOW });
  assert.equal(rows.length, 1); assert.equal(rows[0].released.slice(0, 10), '2026-10-16');
  assert.equal(store.query({ mode: 'seasons', now: NOW })[0].released.slice(0, 10), '2026-10-16');
  assert.equal(store.query({ period: '2005', now: NOW }).length, 0);
  assert.equal(store.query({ period: '2026-10', now: NOW }).length, 0);
});

test('older series reappear on the release date of a new episode and not on their original premiere date', (t) => {
  const store = memory(t);
  store.upsert(tmdb(501, {
    name: 'Returning drama', first_air_date: '2010-04-01',
    last_episode_to_air: { season_number: 20, episode_number: 3, air_date: '2026-10-18', name: 'Chapter three' },
    next_episode_to_air: { season_number: 20, episode_number: 4, air_date: '2026-10-19', name: 'Chapter four' }
  }));
  const yesterday = store.query({ period: 'yesterday', now: new Date('2026-10-19T14:00:00Z') });
  assert.equal(yesterday.length, 1);
  assert.equal(yesterday[0].episodeCode, 'S20E03');
  assert.equal(yesterday[0].released.slice(0, 10), '2026-10-18');
  assert.match(yesterday[0].description, /Nouvel épisode : S20E03/);
  const today = store.query({ period: 'today', now: new Date('2026-10-19T14:00:00Z') });
  assert.equal(today.length, 1);
  assert.equal(today[0].episodeCode, 'S20E04');
  assert.equal(store.query({ period: '2026-10', now: NOW }).length, 1);
  assert.equal(store.query({ period: '2009', now: NOW }).length, 0);
  assert.equal(store.query({ now: NOW })[0].episodeCode, 'S20E03');
  assert.equal(store.stats().indexedAirings, 2);
});

test('episode corrections replace original release event and animation remains excluded', (t) => {
  const store = memory(t);
  store.upsert(tmdb(30, { first_air_date: '2000-01-01',
    last_episode_to_air: { season_number: 2, episode_number: 5, air_date: '2026-10-17' } }));
  store.upsert(tmdb(30, { first_air_date: '2000-01-01',
    last_episode_to_air: { season_number: 2, episode_number: 5, air_date: '2026-10-18' } }));
  store.upsert(tmdb(40, { genres: [{ id: 16 }],
    last_episode_to_air: { season_number: 3, episode_number: 1, air_date: '2026-10-18' } }));
  assert.equal(store.query({ period: 'today', now: new Date('2026-10-17T12:00:00Z') }).length, 0);
  assert.equal(store.query({ period: 'yesterday', now: new Date('2026-10-19T14:00:00Z') }).length, 1);
  assert.equal(store.stats().indexedAirings, 2);
});

test('recent-airing discovery finds old first-air-date titles from all French services', async (t) => {
  const store = memory(t);
  let details = 0;
  const api = async (endpoint, params) => {
    if (endpoint === '/watch/providers/tv') return { results: [{ provider_id: 8, provider_name: 'Netflix' }] };
    if (endpoint === '/discover/tv') {
      assert.equal(params['air_date.gte'], '2026-09-28');
      assert.equal(params['air_date.lte'], '2026-10-26');
      assert.equal(params.watch_region, 'FR');
      return { total_pages: 1, results: [{ id: 88, name: 'Vieille série avec nouvel épisode',
        first_air_date: '1999-03-01', genre_ids: [18] }] };
    }
    if (endpoint === '/tv/88') {
      details++;
      return { id: 88, name: 'Vieille série avec nouvel épisode', first_air_date: '1999-03-01',
        genres: [{ id: 18 }], last_episode_to_air: {
          season_number: 9, episode_number: 2, air_date: '2026-10-19'
        }, seasons: [], 'watch/providers': { results: { FR: { flatrate: [{ provider_id: 8 }] } } } };
    }
    throw new Error('Unexpected endpoint: ' + endpoint);
  };
  const now = Date.parse('2026-10-19T12:00:00Z');
  const scan = await scanRecentAirings(store, { api, delay: 0, now });
  assert.equal(scan.complete, true);
  assert.equal(scan.matches, 1);
  await runFranceJobs(store, { api, delay: 0 });
  assert.equal(details, 1);
  assert.equal(store.query({ period: 'today', now: new Date(now) })[0].episodeCode, 'S09E02');
  const again = await scanRecentAirings(store, { api, delay: 0, now: now + 1000 });
  assert.equal(again.id, scan.id, 'full six-hour refresh is not repeated on every loop');
});

test('season corrections replace old source dates without disturbing another source', (t) => {
  const store = memory(t);
  const record = tmdb(1, { external_ids: { imdb_id: 'tt100' }, seasons: [{ season_number: 2, air_date: '2026-10-01' }] });
  record.seasonsComplete = true; store.upsert(record);
  const second = maze(2, { externals: { imdb: 'tt100' } }); second.seasons = [{ number: 2, date: '2026-10-02' }]; store.upsert(second);
  assert.equal(store.query({ mode: 'seasons', now: NOW })[0].released.slice(0, 10), '2026-10-01');
  record.seasons = [{ number: 2, date: '2026-10-05' }]; store.upsert(record);
  assert.equal(store.query({ mode: 'seasons', now: NOW })[0].released.slice(0, 10), '2026-10-05');
});

test('calendar dates respect Brussels midnight, civil weeks and leap years', () => {
  assert.deepEqual(windowFor('today', new Date('2026-10-18T23:00:00Z')), { start: '2026-10-19', end: '2026-10-19' });
  assert.deepEqual(windowFor('lastweek', NOW), { start: '2026-10-05', end: '2026-10-11' });
  assert.deepEqual(windowFor('nextweek', NOW), { start: '2026-10-19', end: '2026-10-25' });
  assert.equal(windowFor('2024-02').end, '2024-02-29');
  assert.equal(windowFor('2026-10', new Date('2026-10-19T12:00:00Z')).end, '2026-10-19');
  assert.deepEqual(windowFor('2026-11', new Date('2026-10-19T12:00:00Z')),
    { start: '2026-11-01', end: '2026-10-19' });
  assert.deepEqual(windowFor('2027', new Date('2026-10-19T12:00:00Z')),
    { start: '2027-01-01', end: '2026-10-19' });
  assert.equal(isoDate('2026-02-30'), null);
  assert.throws(() => windowFor('2026-13'));
});

test('series rolling periods never publish future month or year archives', () => {
  const now = new Date('2026-10-19T14:00:00Z');
  const current = periods(now);
  const keys = current.map(({ key }) => key);
  assert.deepEqual(keys.slice(0, 6), ['all','today','tomorrow','yesterday','lastweek','nextweek']);
  assert.deepEqual(keys.slice(6, 9), ['2026-10','2026-09','2026-08']);
  assert(keys.includes('2025-12') && keys.includes('2018-01') && !keys.includes('2017-12') && !keys.includes('undated'));
  assert(!keys.includes('2026-11') && !keys.includes('2026-12'));
  assert(!keys.some((key) => /^202[7-9]/.test(key)));
  assert(!keys.includes('2030-12'));
  const december = periods(new Date('2026-12-31T23:30:00Z'));
  assert.equal(december[6].key, '2027-01', 'Brussels midnight rollover reveals the new month');
  assert(!december.some(({ key }) => key === '2027-02'));
});

test('future series and season episodes never leak into current archives', (t) => {
  const store = memory(t);
  const now = new Date('2026-10-19T14:00:00Z');
  store.upsert(tmdb(510, { first_air_date: '2027-05-11',
    seasons: [{ season_number: 2, air_date: '2027-05-11' }] }));
  store.upsert(tmdb(511, { first_air_date: '2007-01-01',
    seasons: [{ season_number: 2, air_date: '2027-05-11' }],
    next_episode_to_air: { season_number: 2, episode_number: 3, air_date: '2027-05-11' } }));
  assert.equal(store.query({ mode: 'premieres', period: 'all', now }).some((m) => m.name === 'Série 510'), false);
  assert.equal(store.query({ mode: 'premieres', period: '2026-10', now }).length, 0);
  assert.equal(store.query({ mode: 'premieres', period: '2027-05', now }).length, 0);
  assert.equal(store.query({ mode: 'seasons', period: 'all', now }).length, 0);
  assert.equal(store.query({ mode: 'seasons', period: '2027-05', now }).length, 0);
});

test('premium artwork requires a complete exact 25-genre set, never partial activation', (t) => {
  const assets = fs.mkdtempSync(path.join(os.tmpdir(), 'nuvio-series-covers-'));
  t.after(() => fs.rmSync(assets, { recursive: true, force: true }));
  const { genreCoverProgress, genreCoverRoute } = addon._internals;
  assert.deepEqual(genreCoverProgress(assets), { loaded: 0, total: 25, ready: false });
  const ids = require('../src/model.cjs').GENRES.map(({ id }) => id);
  for (const id of ids.slice(0, -1)) fs.writeFileSync(path.join(assets, id + '.webp'), 'test');
  assert.deepEqual(genreCoverProgress(assets), { loaded: 24, total: 25, ready: false });
  fs.writeFileSync(path.join(assets, ids.at(-1) + '.webp'), 'test');
  assert.deepEqual(genreCoverProgress(assets), { loaded: 25, total: 25, ready: true });
  assert.match(genreCoverRoute('https://example.test/series-v2', 'medical'),
    /^https:\/\/example\.test\/series-v2\/artwork\/genre\/medical\.webp\?v=premium-/);
  assert.equal(ids.includes('music'), false, 'do not add an unrecognized genre');
});

test('archive imports reference real unique catalogs, cover old series, and preserve native periods', () => {
  const origin = 'https://example.test/series';
  const manifest = addon._internals.buildManifest(origin, NOW);
  const collections = addon._internals.buildCollections(origin, NOW);
  const keys = new Set(manifest.catalogs.map((c) => c.id));
  const labels = new Map(manifest.catalogs.map((c) => [c.id, c.name]));
  assert.equal(keys.size, manifest.catalogs.length);
  assert.equal(collections.length, 2);
  assert.equal(manifest.id, ADDON_ID);
  assert.equal(manifest.catalogs.some((c) => c.id.includes('-16-')), false);
  assert.equal(collections[0].folders.length, 25);
  for (const parent of collections) for (const folder of parent.folders) {
    assert.deepEqual(folder.sources.slice(0, 5).map((s) => parseCatalog(s.catalogId).period), ['today', 'tomorrow', 'yesterday', 'lastweek', 'nextweek']);
    assert.equal(parseCatalog(folder.sources[5].catalogId).period, '2026-10');
    assert(!folder.sources.some((source) => /^2027|^2028|^2029|^2030/.test(parseCatalog(source.catalogId).period)));
    assert(!folder.sources.some((source) => parseCatalog(source.catalogId).period === '2026-11'));
    assert(!folder.sources.some((source) => parseCatalog(source.catalogId).period === 'all'),
      'All dates stays callable but must not be a visible Nuvio collection row');
    for (const source of folder.sources) {
      assert(keys.has(source.catalogId)); assert.equal(source.addonId, manifest.id);
      assert.equal(labels.get(source.catalogId.replace('series-fr-', 'series-world-')), labels.get(source.catalogId));
    }
    const western = parseCatalog(folder.sources[0].catalogId).genre === '37';
    assert.equal(folder.sources.some((s) => parseCatalog(s.catalogId).period === '1950'), western);
    assert.equal(folder.sources.some((s) => parseCatalog(s.catalogId).period === 'before1900'), western);
    assert.equal(folder.sources.some((s) => parseCatalog(s.catalogId).period === 'undated'), western);
    assert(folder.sources.some((s) => parseCatalog(s.catalogId).period === '2018-01'));
    assert.equal(folder.sources.some((s) => parseCatalog(s.catalogId).period === '2017-12'), western);
  }
  assert.equal(JSON.stringify(collections).includes('generated_images'), false);
  assert.equal(collections[0].folders[0].coverImageUrl,
    addon._internals.genreCoverProgress().ready
      ? addon._internals.genreCoverRoute(origin, 'all') : `${origin}/cover.jpg?v=premium-20261025-v2`);
  assert.equal(collections[1].backdropImageUrl, `${origin}/backdrop.jpg?v=premium-20261025-v2`);
  assert.match(manifest.name, /France/);
  assert.equal(labels.get('series-fr-premieres-all-2026-10'), 'Octobre 2026');
  assert.equal(labels.get('series-world-seasons-35-today'), 'Aujourd’hui');
  assert(manifest.catalogs.every((c) => c.extraSupported.includes('skip')));
  assert.equal(new Set(collections.map((c) => c.id)).size, 2);
});

test('every series period uses existing custom Shield and Desktop covers while detail art stays raw', (t) => {
  const store = memory(t);
  store.upsert(tmdb(1, { name: 'Les Affaires organisées', poster_path: '/portrait.jpg', backdrop_path: '/backdrop.jpg' }));
  const raw = store.query({ now: NOW })[0];
  for (const mode of ['premieres', 'seasons']) for (const period of ['all', 'today', 'tomorrow', '2026-10', '1950', 'before1900', 'undated']) {
    const [meta] = decorateSeriesMetas('https://example.test/series', [raw], { mode, period });
    const wide = new URL(meta.background), poster = new URL(meta.poster), desktop = new URL(meta.banner);
    assert.equal(meta.posterShape, 'landscape');
    assert.equal(wide.pathname, '/fr/calendar-card.jpg');
    assert.equal(wide.searchParams.get('layout'), 'landscape');
    assert.equal(wide.searchParams.get('src'), 'https://image.tmdb.org/t/p/w780/backdrop.jpg');
    assert.equal(wide.searchParams.get('title'), raw.name);
    assert.equal(wide.searchParams.get('provider'), 'Netflix');
    assert.equal(poster.href, wide.href);
    assert.equal(desktop.searchParams.get('fast'), '1');
    assert.equal(meta.landscapePoster, meta.background);
    assert.equal(desktop.pathname, '/fr/desktop-content-card.jpg');
    assert.equal(desktop.searchParams.get('design'), 'shield3');
    assert.equal(desktop.searchParams.get('title'), raw.name);
    assert.match(meta.logo, /\/fr\/calendar-transparent-logo\.svg\?/);
  }
  assert.equal(raw.background, 'https://image.tmdb.org/t/p/w1280/backdrop.jpg');
  assert.equal(store.meta(store.row('tmdb:1')).poster, raw.poster);
  assert.equal(raw.logo, undefined);
});

test('V2 escapes the old addon cache and replaces collection sources without duplicate collections', () => {
  const legacyOrigin = 'https://example.test/series';
  const origin = 'https://example.test/series-v2';
  const legacy = addon._internals.buildManifest(legacyOrigin, NOW);
  const fresh = addon._internals.buildManifest(origin, NOW);
  assert.notEqual(fresh.id, legacy.id);
  assert.equal(fresh.id, V2_ADDON_ID); assert.equal(fresh.version, V2_VERSION);
  assert(fresh.name.includes(V2_VERSION));
  assert(fresh.catalogs.length * 2 < legacy.catalogs.length);
  assert(!fresh.catalogs.some(c => /-(unclassified|10763)-/.test(c.id)));
  const names = new Map(fresh.catalogs.map((c) => [c.id, c.name]));
  assert.equal(names.get('series-fr-premieres-all-2026-10'), 'Octobre 2026');
  assert.equal(names.has('series-world-premieres-all-all'), false);
  for (const mode of ['shield', 'desktop']) {
    const previous = addon._internals.buildCollections(legacyOrigin, NOW, mode);
    const imported = addon._internals.buildCollections(origin, NOW, mode);
    assert.deepEqual(imported.map((c) => c.id), previous.map((c) => c.id));
    for (const [index, collection] of imported.entries()) {
      assert.match(collection.title, /V2/);
      assert.deepEqual(collection.folders.map((f) => f.id), previous[index].folders.filter(f => !/-unclassified$|-10763$/.test(f.id)).map((f) => f.id));
      for (const folder of collection.folders) {
        assert.equal(folder.tileShape, 'LANDSCAPE');
        assert.deepEqual(folder.catalogSources.map((s) => s.addonId), folder.sources.map((s) => s.addonId));
        for (const source of folder.sources) { assert.equal(source.addonId, fresh.id); assert(names.has(source.catalogId)); }
      }
    }
    // Mirrors CollectionManagementViewModel.confirmImport: matching IDs replace.
    const combined = [...previous];
    for (const collection of imported) combined[combined.findIndex((c) => c.id === collection.id)] = collection;
    assert.equal(combined.length, 2);
    assert(combined.every((c) => c.folders.every((f) => f.sources.every((s) => s.addonId === fresh.id))));
    assert.equal(imported[0].folders[0].coverImageUrl,
      addon._internals.genreCoverProgress().ready
        ? addon._internals.genreCoverRoute(origin, 'all') : `${origin}/cover.jpg?v=premium-20261025-v2`);
  }
});

test('WebP source art remains visible in SVG decoders that only support JPEG and PNG', async (t) => {
  const photo = await sharp({ create: { width: 32, height: 18, channels: 3, background: '#e5ad2b' } }).webp().toBuffer();
  t.mock.method(global, 'fetch', async () => new Response(photo, { headers: { 'content-type': 'image/webp' } }));
  let svg;
  await franceAddon({ method: 'GET', url: '/calendar-card.svg?src=https%3A%2F%2Fimage.tmdb.org%2Ft%2Fp%2Fw780%2Fdemo.jpg&layout=landscape&title=Photo&provider=Netflix&type=series', headers: { host: 'example.test' } }, {
    setHeader() {}, end(body) { svg = body; }
  });
  assert.match(svg, /data:image\/jpeg;base64,/);
  assert(!svg.includes('data:image/webp'));
  const { data, info } = await sharp(Buffer.from(svg)).raw().toBuffer({ resolveWithObject: true });
  const pixel = (200 * info.width + 800) * info.channels;
  assert(data[pixel] > 100 && data[pixel + 1] > 70, 'photography must remain visible, not a black SVG background');
});

test('search treats SQL operators and wildcard characters as text', (t) => {
  const store = memory(t);
  store.upsert(tmdb(1, { name: '100% réel' })); store.upsert(tmdb(2));
  assert.equal(store.query({ search: '%', now: NOW }).length, 1);
  assert.equal(store.query({ search: "' OR 1=1 --", now: NOW }).length, 0);
  assert.throws(() => store.query({ skip: -1 }));
  assert.throws(() => store.query({ skip: 0.5 }));
});

test('France discovery includes every service, resumes pages, and deduplicates providers', async (t) => {
  const store = memory(t);
  const calls = [];
  const api = async (endpoint, params) => {
    calls.push({ endpoint, params });
    if (endpoint === '/watch/providers/tv') return { results: [{ provider_id: 8, provider_name: 'Netflix' }, { provider_id: 999999, provider_name: 'Nouveau service FR' }] };
    assert.equal(params.watch_region, 'FR'); assert.equal(params.with_watch_providers, '8|999999');
    return { total_pages: 2, results: [{ id: params.page, name: `France ${params.page}`, genre_ids: [18], first_air_date: '2026-01-01' }] };
  };
  const first = await scanFrance(store, { api, maxPages: 1, delay: 0 });
  assert.equal(first.complete, false); assert.equal(store.query({ now: NOW }).length, 1);
  await scanFrance(store, { api, maxPages: 1, delay: 0 });
  assert.equal(store.state('frScanProgress').complete, true);
  assert.equal(store.query({ now: NOW }).length, 2);
  assert.equal(calls.filter((c) => c.endpoint === '/watch/providers/tv').length, 1);
  assert.equal(store.franceProviders().length, 2);
});

test('upstream failures retain existing catalog data and persist retry state across reopen', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuvio-series-'));
  const file = path.join(dir, 'index.sqlite');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let store = new SeriesStore(file);
  store.upsert(tmdb(1)); store.enqueue('tmdb', [1]); store.failed('tmdb', 1, new Error('Upstream HTTP 503')); store.close();
  store = new SeriesStore(file); t.after(() => store.close());
  assert.equal(store.query({ now: NOW }).length, 1);
  assert.equal(store.stats().jobs[0].failed, 1);
  assert.equal(store.jobs('tmdb').length, 0, 'failed jobs back off instead of spinning');
});

test('changed shows are refreshed ahead of the initial archive backlog', (t) => {
  const store = memory(t);
  store.enqueue('tmdb', [100, 200, 300]);
  store.enqueue('tmdb', [100], 1, { refresh: true });
  assert.equal(store.jobs('tmdb')[0].source_id, 100);
});

test('removing the availability source removes the title from the France catalog', (t) => {
  const store = memory(t);
  store.upsert(tmdb(1, { external_ids: { imdb_id: 'tt100' } }));
  store.upsert(maze(2, { externals: { imdb: 'tt100' } }));
  store.removeSource('tmdb', 1);
  assert.equal(store.query({ now: NOW }).length, 0);
  store.removeSource('tvmaze', 2);
  assert.equal(store.query({ now: NOW }).length, 0);
});

test('France availability is required regardless of production country or language', (t) => {
  const store = memory(t);
  store.upsert(tmdb(1, { origin_country: ['FR'], original_language: 'fr', 'watch/providers': { results: { US: { flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] } } } }));
  store.upsert(tmdb(2, { origin_country: ['JP'], original_language: 'ja' }));
  store.upsert(tmdb(3, { 'watch/providers': { results: { FR: {} } } }));
  store.upsert(tmdb(4, { 'watch/providers': undefined }));
  assert.deepEqual(store.query({ now: NOW }).map((m) => m.name), ['Série 2']);
  assert.equal(store.hasFranceAvailability('tmdb:1'), false);
  assert.equal(store.stats().market, 'FR'); assert.equal(store.stats().eligible, 1);
  assert.match(store.query({ now: NOW })[0].description, /France : Netflix/);
});

test('all French streaming offer types count, including free replay and VOD', () => {
  const data = { results: { FR: Object.fromEntries(['flatrate', 'free', 'ads', 'rent', 'buy'].map((kind, i) => [kind, [{ provider_id: i + 1, provider_name: kind }]])), BE: { flatrate: [{ provider_id: 99, provider_name: 'Belgium only' }] } } };
  assert.equal(offersInFrance(data).length, 5);
  const params = discoverParams([1, 999999]);
  assert.equal(params.with_watch_monetization_types, 'flatrate|free|ads|rent|buy');
  assert.equal(params.with_origin_country, undefined); assert.equal(params.with_original_language, undefined);
});

test('market departures take effect and failed scans never wipe the catalog', async (t) => {
  const store = memory(t); store.upsert(tmdb(100));
  await assert.rejects(scanFrance(store, { api: async () => { throw new Error('unavailable'); }, delay: 0 }));
  assert.equal(store.query({ now: NOW }).length, 1);
  const api = async (endpoint) => endpoint === '/watch/providers/tv' ? { results: [{ provider_id: 8, provider_name: 'Netflix' }] } : { total_pages: 1, results: [] };
  await scanFrance(store, { api, delay: 0 });
  assert.equal(store.query({ now: NOW }).length, 0);
});

test('provider partitions avoid the 500-page ceiling without silently completing overflows', async (t) => {
  const store = memory(t);
  const api = async (endpoint, p) => {
    if (endpoint === '/watch/providers/tv') return { results: [{ provider_id: 8, provider_name: 'A' }, { provider_id: 9, provider_name: 'B' }] };
    if (p.with_watch_providers.includes('|')) return { total_pages: 600, results: [] };
    return { total_pages: 1, results: [{ id: Number(p.with_watch_providers), name: 'Series', genre_ids: [18] }] };
  };
  const result = await scanFrance(store, { api, delay: 0 });
  assert.equal(result.complete, true); assert.equal(result.uniqueCandidates, 2);
});

test('full offer checks can reject a stale discovery result and enrich real French platforms', async (t) => {
  const store = memory(t);
  store.upsert(tmdb(1, { 'watch/providers': undefined })); store.markFranceDiscovered(1); store.enqueue('fr-detail', [1]);
  assert.equal(store.query({ now: NOW }).length, 1);
  await runFranceJobs(store, { delay: 0, api: async () => ({ id: 1, name: 'Gone', genres: [{ id: 18 }], 'watch/providers': { results: { BE: { flatrate: [{ provider_id: 8 }] } } } }) });
  assert.equal(store.query({ now: NOW }).length, 0);
  store.markFranceDiscovered(1);
  assert.equal(store.query({ now: NOW }).length, 0, 'recent explicit negative wins');
  store.enqueue('fr-detail', [1], 1, { refresh: true });
  await runFranceJobs(store, { delay: 0, api: async () => ({ id: 1, name: 'Back', first_air_date: '2026-10-12', genres: [{ id: 18 }], 'watch/providers': { results: { FR: { free: [{ provider_id: 999999, provider_name: 'New French Service' }] } } } }) });
  assert.match(store.query({ now: NOW })[0].description, /New French Service/);
});

test('unverified global metadata and expired French evidence never leak into catalogs', (t) => {
  const store = memory(t); store.upsert(tmdb(1));
  store.db.prepare('UPDATE fr_availability SET checked_at=?').run(Date.now() - 49 * 3600000);
  assert.equal(store.query({ now: NOW }).length, 0);
  store.db.exec('DROP TABLE fr_availability');
  assert.equal(store.query({ now: NOW }).length, 0);
  assert.equal(store.hasFranceAvailability('tmdb:1'), false);
});

test('an overflowing provider is partitioned by air-date until it can be scanned', async (t) => {
  const store = memory(t);
  const calls = [];
  const api = async (endpoint, params) => {
    if (endpoint === '/watch/providers/tv') return { results: [{ provider_id: 8, provider_name: 'Netflix' }] };
    calls.push(params);
    if (!params['first_air_date.gte']) return { total_pages: 501, total_results: 10020, results: [] };
    return { total_pages: 1, results: [{
      id: params['first_air_date.gte'] === '0001-01-01' ? 10 : 11,
      name: 'Série test', genre_ids: [18], first_air_date: '2026-10-19'
    }] };
  };
  const scan = await scanFrance(store, { api, delay: 0 });
  assert.equal(scan.complete, true);
  assert.equal(scan.overflow.length, 0);
  assert.equal(scan.uniqueCandidates, 2);
  assert(calls.some((p) => p['first_air_date.gte'] === '0001-01-01'));
  assert(calls.some((p) => p['first_air_date.lte'] === '9999-12-31'));
  assert(store.state('lastFranceDiscoveryAt'));
});

test('a single-day overflow remains explicitly incomplete and is not prematurely retried', async (t) => {
  const store = memory(t);
  store.state('frScanProgress', {
    id: '20261019', startedAt: Date.now(), lastProgressAt: Date.now(), complete: false,
    pages: 0, uniqueCandidates: 0, providers: 1,
    tasks: [{ ids: [8], from: '2026-10-19', to: '2026-10-19', page: 1 }], overflow: []
  });
  let calls = 0;
  const api = async () => { calls++; return { total_pages: 501, total_results: 10020, results: [] }; };
  const scan = await scanFrance(store, { api, delay: 0 });
  assert.equal(scan.complete, false);
  assert.equal(scan.overflow[0].providerId, 8);
  assert(scan.retryAt > Date.now());
  await scanFrance(store, { api, delay: 0 });
  assert.equal(calls, 1, 'retry backoff must prevent an immediate tight loop');
});

test('legacy persisted overflowing scans automatically recover', async (t) => {
  const store = memory(t);
  store.state('frScanProgress', {
    id: 'stalled', startedAt: Date.now() - 86400000, complete: false,
    pages: 0, uniqueCandidates: 0, providers: 1, tasks: [],
    overflow: [{ providerId: 8, totalResults: 10020 }]
  });
  const api = async (endpoint) => endpoint === '/watch/providers/tv'
    ? { results: [{ provider_id: 8, provider_name: 'Netflix' }] }
    : { total_pages: 1, results: [{ id: 42, name: 'Nouvelle série', genre_ids: [18] }] };
  const scan = await scanFrance(store, { api, delay: 0 });
  assert.equal(scan.complete, true);
  assert.equal(scan.uniqueCandidates, 1);
  assert.equal(scan.overflow.length, 0);
});

test('HTTP addon exposes paged catalogs, rejects animation metadata, and reports progress', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuvio-series-http-'));
  const previous = process.env.NUVIO_SERIES_DB;
  process.env.NUVIO_SERIES_DB = path.join(dir, 'index.sqlite');
  const store = new SeriesStore(process.env.NUVIO_SERIES_DB);
  store.upsert(tmdb(1, { poster_path: '/portrait.jpg', backdrop_path: '/backdrop.jpg' })); store.upsert(tmdb(2, { genres: [{ id: 16 }] }));
  async function call(url) {
    const result = { headers: {} };
    await addon({ url, headers: { host: 'example.test' } }, {
      set statusCode(value) { result.status = value; }, setHeader(k, v) { result.headers[k] = v; },
      end(body) { result.body = JSON.parse(body); }
    });
    return result;
  }
  const response = await call('/catalog/series/series-world-premieres-all-all/skip=0.json');
  assert.equal(response.status, 200); assert.equal(response.body.metas.length, 1);
  assert.match(response.body.metas[0].background, /\/fr\/calendar-card\.jpg\?/);
  assert.match(response.body.metas[0].banner, /\/fr\/desktop-content-card\.jpg\?/);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  const current = await call('/catalog/series/series-fr-premieres-all-all.json');
  assert.deepEqual(current.body, response.body, 'legacy and current imports get the same France results and custom art');
  assert.equal((await call('/catalog/series/series-world-premieres-all-all/skip=-1.json')).status, 400);
  assert.equal((await call('/meta/series/tmdb%3Atv%3A2.json')).status, 404);
  assert.equal((await call('/status.json')).body.animationExcluded, 1);
  store.close(); addon._internals.reader()?.close();
  process.env.NUVIO_SERIES_DB = previous || '';
  fs.rmSync(dir, { recursive: true, force: true });
});


test('2018 catalog cutoff applies to results, legacy requests and searches except Western', (t) => {
  const store = memory(t);
  for (const [id, date] of [[801, '2017-12-31'], [802, '2018-01-01']]) store.upsert(tmdb(id, {
    first_air_date: date, genres: [{ id: 18 }, { id: 37 }],
    seasons: [{ season_number: 2, air_date: date }]
  }));
  for (const mode of ['premieres', 'seasons']) {
    assert.deepEqual(store.query({ mode, now: NOW }).map((m) => m.name), ['Série 802']);
    assert.equal(store.query({ mode, genre: '18', period: '2017', now: NOW }).length, 0);
    assert.equal(store.query({ mode, genre: '18', period: '2017-12', now: NOW }).length, 0);
    assert.equal(store.query({ mode, search: '801', now: NOW }).length, 0);
    assert.equal(store.query({ mode, genre: '37', now: NOW }).length, 2);
    assert.equal(store.query({ mode, genre: '37', period: '2017-12', now: NOW }).length, 1);
  }
  store.upsert(tmdb(803, { first_air_date: '1890-01-01', genres: [{ id: 37 }] }));
  assert.equal(store.query({ genre: '37', period: 'before1900', now: NOW }).length, 1);
  assert.equal(store.query({ period: 'before1900', now: NOW }).length, 0);
  assert(store.row('tmdb:801'), 'history remains stored for Western and detail links');
});
