'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fromTmdb, fromTvmaze, windowFor, isoDate, parseCatalog, ADDON_ID } = require('../src/model.cjs');
const { SeriesStore } = require('../src/store.cjs');
const addon = require('../index.cjs');
const { scanFrance, runFranceJobs } = require('../../../scripts/sync-series-world.cjs');
const { offersInFrance, discoverParams } = require('../src/france.cjs');
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

test('missing dates and missing genres do not drop classified live-action series', (t) => {
  const store = memory(t);
  store.upsert(maze(1, { genres: [], premiered: null, externals: { imdb: 'tt10' } }));
  store.upsert(tmdb(10, { genres: [], first_air_date: null, external_ids: { imdb_id: 'tt10' } }));
  store.upsert(tmdb(2, { genres: [], first_air_date: null }));
  assert.equal(store.query({ genre: 'unclassified', period: 'undated', now: NOW }).length, 1);
  assert.equal(store.query({ now: NOW }).length, 1);
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

test('pagination includes every dated and undated show with deterministic ties', (t) => {
  const store = memory(t);
  for (let id = 1; id <= 237; id++) store.upsert(tmdb(id, { first_air_date: id > 230 ? null : id < 100 ? '1960-01-01' : '2026-10-15' }));
  store.upsert(tmdb(999, { first_air_date: '2026-10-19' }));
  const first = store.query({ now: NOW });
  const second = store.query({ skip: 100, now: NOW });
  const third = store.query({ skip: 200, now: NOW });
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
  assert.equal(rows.length, 1); assert.equal(rows[0].released.slice(0, 10), '2026-10-19');
  assert.equal(store.query({ mode: 'seasons', now: NOW })[0].released.slice(0, 10), '2026-10-16');
  assert.equal(store.query({ period: '2005', now: NOW }).length, 1);
  assert.equal(store.query({ period: '2026-10', now: NOW }).length, 0);
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
  assert.equal(isoDate('2026-02-30'), null);
  assert.throws(() => windowFor('2026-13'));
});

test('archive imports reference real unique catalogs, cover old series, and preserve native periods', () => {
  const origin = 'https://example.test/series';
  const manifest = addon._internals.buildManifest(origin, NOW);
  const collections = addon._internals.buildCollections(origin, NOW);
  const keys = new Set(manifest.catalogs.map((c) => c.id));
  assert.equal(keys.size, manifest.catalogs.length);
  assert.equal(collections.length, 2);
  assert.equal(manifest.id, ADDON_ID);
  assert.equal(manifest.catalogs.some((c) => c.id.includes('-16-')), false);
  assert.equal(collections[0].folders.length, 25);
  for (const parent of collections) for (const folder of parent.folders) {
    assert.deepEqual(folder.sources.slice(1, 6).map((s) => parseCatalog(s.catalogId).period), ['today', 'tomorrow', 'yesterday', 'lastweek', 'nextweek']);
    for (const source of folder.sources) { assert(keys.has(source.catalogId)); assert.equal(source.addonId, manifest.id); }
    assert(folder.sources.some((s) => parseCatalog(s.catalogId).period === '1950'));
    assert(folder.sources.some((s) => parseCatalog(s.catalogId).period === 'before1900'));
  }
  assert.equal(JSON.stringify(collections).includes('generated_images'), false);
  assert.equal(collections[0].folders[0].coverImageUrl, `${origin}/cover.jpg?v=france-v2`);
  assert.equal(collections[1].backdropImageUrl, `${origin}/backdrop.jpg?v=france-v2`);
  assert.match(manifest.name, /France/);
  assert.equal(new Set(collections.map((c) => c.id)).size, 2);
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
  await runFranceJobs(store, { delay: 0, api: async () => ({ id: 1, name: 'Back', genres: [{ id: 18 }], 'watch/providers': { results: { FR: { free: [{ provider_id: 999999, provider_name: 'New French Service' }] } } } }) });
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

test('an overflowing individual provider is reported as incomplete', async (t) => {
  const store = memory(t);
  const api = async (endpoint) => endpoint === '/watch/providers/tv' ? { results: [{ provider_id: 8, provider_name: 'Netflix' }] } : { total_pages: 501, total_results: 10020, results: [] };
  const scan = await scanFrance(store, { api, delay: 0 });
  assert.equal(scan.complete, false); assert.equal(scan.overflow[0].providerId, 8);
});

test('HTTP addon exposes paged catalogs, rejects animation metadata, and reports progress', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuvio-series-http-'));
  const previous = process.env.NUVIO_SERIES_DB;
  process.env.NUVIO_SERIES_DB = path.join(dir, 'index.sqlite');
  const store = new SeriesStore(process.env.NUVIO_SERIES_DB);
  store.upsert(tmdb(1)); store.upsert(tmdb(2, { genres: [{ id: 16 }] }));
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
  assert.equal((await call('/catalog/series/series-world-premieres-all-all/skip=-1.json')).status, 400);
  assert.equal((await call('/meta/series/tmdb%3Atv%3A2.json')).status, 404);
  assert.equal((await call('/status.json')).body.animationExcluded, 1);
  store.close(); addon._internals.reader()?.close();
  process.env.NUVIO_SERIES_DB = previous || '';
  fs.rmSync(dir, { recursive: true, force: true });
});
