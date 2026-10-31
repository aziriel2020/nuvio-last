'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { MovieStore } = require('../src/store.cjs');
const { fromTmdb, GENRES, VIEWS, periods, parseCatalog } = require('../src/model.cjs');
const { discoverParams, splitMovieDates, scanLane, runDetailJobs } = require('../../../scripts/sync-movies-world.cjs');
const { decorateMovieMetas } = require('../src/presentation.cjs');
const addon = require('../index.cjs');
const { genreBytes, progress } = require('../src/artwork.cjs');
const NOW = new Date('2026-10-25T10:00:00Z');
const FR = (kind = 'flatrate') => ({ results: { FR: { link: 'https://www.themoviedb.org/movie/1/watch?locale=FR',
  [kind]: [{ provider_id: 8, provider_name: 'Netflix' }] } } });
const record = (id, extra = {}) => fromTmdb({ id, title: `Film ${id}`, genres: [{ id: 18 }],
  release_date: '2026-10-24', original_language: 'en', 'watch/providers': FR(), release_dates: { results: [] }, ...extra });
const regional = (...dates) => ({ results: [{ iso_3166_1: 'FR', release_dates: dates.map(([type, date]) => ({ type, release_date: `${date}T00:00:00.000Z` })) }] });
function memory(t) { const store = new MovieStore(':memory:'); t.after(() => store.close()); return store; }
const payload = (page, total = 1, extra = {}) => ({ total_pages: total, total_results: total * 20,
  results: [{ id: page, title: `Candidate ${page}`, genre_ids: [18], release_date: '2026-10-25' }], ...extra });

test('movie identity, FR-only release evidence and animation classification', () => {
  const movie = record(1, { imdb_id: 'tt123', release_dates: { results: [
    { iso_3166_1: 'US', release_dates: [{ type: 3, release_date: '2026-10-25' }] },
    { iso_3166_1: 'FR', release_dates: [1, 2, 3, 4, 5, 6].map((type) => ({ type, release_date: '2026-10-24T00:00:00Z' })) }
  ] } });
  assert.equal(movie.imdbId, 'tt123');
  assert.deepEqual(movie.releases.map((r) => r.kind), ['cinema', 'cinema', 'digital']);
  assert.equal(record(2, { genres: [{ id: 16 }] }).classification, 'animation');
  assert.equal(record(3, { keywords: { keywords: [{ name: 'anime' }] } }).classification, 'animation');
  assert.equal(record(4, { original_language: 'ja', production_countries: [{ iso_3166_1: 'JP' }] }).classification, 'eligible');
});

test('Films Monde retains international release dates even without TMDb primary date', () => {
  const item=record(654, {
    release_date:'',
    release_dates:{results:[
      {iso_3166_1:'US',release_dates:[{type:3,release_date:'2026-10-17T00:00:00Z'}]},
      {iso_3166_1:'FR',release_dates:[{type:4,release_date:'2026-10-30T00:00:00Z'}]}
    ]}
  });
  assert.equal(item.firstAirDate,'2026-10-17');
  assert(item.releases.some(e=>e.kind==='digital'&&e.date==='2026-10-30'));
});

test('official Prime debut belongs to its real world premiere month despite a delayed FR provider index', (t) => {
  const s = memory(t);
  const movie = record(1507696, {
    title: 'Apocalypse Z : Nouveau Monde',
    imdb_id: 'tt37522541',
    release_date: '2026-10-30',
    'watch/providers': { results: {} },
    release_dates: regional([4, '2026-10-30'])
  });
  // First Sitges public screening: Friday 9 October; Saturday 10 was the gala.
  assert.equal(movie.firstAirDate, '2026-10-09');
  s.upsert(movie);
  const halloween = new Date('2026-10-31T12:00:00Z');
  const options = { period: '2026-10', now: halloween, curated: true };
  const worldwide = s.query({ ...options, view: 'all' });
  const streaming = s.query({ ...options, view: 'streaming' });
  assert.deepEqual(worldwide.map(m => m.name), ['Apocalypse Z : Nouveau Monde']);
  assert.equal(worldwide[0].originalReleaseDate, '2026-10-09');
  assert.equal(worldwide[0].released.slice(0,10), '2026-10-09');
  assert.deepEqual(streaming[0].providersByKind.streaming, ['Prime Video']);
  assert.match(worldwide[0].description, /2026-10-30/);
  assert.equal(s.query({ ...options, period: 'today', view: 'all' }).length, 0);
  assert.equal(s.query({ ...options, period: 'yesterday', view: 'all' }).length, 0);
  // Official positive distribution evidence must survive TMDB provider lag.
  s.setFranceOffers(1507696, []);
  assert.equal(s.query({ ...options, view: 'all' }).length, 1);
  // Before the confirmed Prime launch, a title without other valid offers
  // must not be represented as already available for streaming in France.
  assert.equal(s.query({ ...options, now: new Date('2026-10-29T12:00:00Z'), view: 'streaming' }).length, 0);
});

test('Films Monde visibly includes an officially verified world premiere when the index is empty or delayed', (t) => {
  const date = new Date('2026-10-31T12:00:00Z');
  const catalog = { view:'all', genre:'all', period:'2026-10' };
  const fallback = addon._internals.verifiedWorldCatalogMetas(null, catalog, date, 0, '', []);
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].name, 'Apocalypse Z : Nouveau Monde');
  assert.equal(fallback[0].originalReleaseDate, '2026-10-09');
  assert.equal(fallback[0].released.slice(0,10), '2026-10-09');
  assert.match(fallback[0].description, /Sortie Prime Video France : 2026-10-30/);
  assert(fallback[0].links.some(l=>l.category==='Regarder' && l.url.includes('primevideo.com')));
  assert.equal(addon._internals.verifiedWorldCatalogMetas(null,{...catalog,period:'today'},date,0,'',[]).length,0);
  assert.equal(addon._internals.verifiedWorldCatalogMetas(null,{...catalog,period:'yesterday'},date,0,'',[]).length,0);
  assert.equal(addon._internals.verifiedWorldCatalogMetas(null,{...catalog,view:'vod'},date,0,'',[]).length,0);
  assert.equal(addon._internals.verifiedWorldCatalogMetas(null,{...catalog,genre:'27'},date,0,'',[]).length,0,
    'genre should not be invented before metadata arrives');
  assert.equal(addon._internals.verifiedWorldCatalogMetas(null,catalog,date,100,'',[]).length,0);
  assert.equal(addon._internals.verifiedWorldCatalogMetas(null,catalog,new Date('2026-10-29T12:00:00Z'),0,'',[]).length,0);
  const s=memory(t);
  // A premiere must still make page one despite 115 later movies.
  for(let id=1;id<=115;id++) s.upsert(record(id,{release_date:'2026-10-24'}));
  s.upsert(record(1507696,{ title:'Apocalypse Z : Nouveau Monde',
    release_date:'2026-10-30','watch/providers':{results:{}},
    release_dates:regional([4,'2026-10-30']) }));
  const page=s.query({...catalog,now:date,curated:true});
  assert.equal(page[0].name,'Apocalypse Z : Nouveau Monde');
  const merged=addon._internals.verifiedWorldCatalogMetas(s,catalog,date,0,'',page);
  assert.equal(merged.filter(m=>m.name==='Apocalypse Z : Nouveau Monde').length,1);
  assert.equal(new Set(merged.map(m=>m.id)).size,merged.length);
  // The old DB might still list the Prime streaming date as the world's
  // original release. The response must correct that stale card immediately.
  s.db.prepare("UPDATE shows SET first_air_date='2026-10-30' WHERE id='tmdb:1507696'").run();
  const stale = s.query({...catalog,now:date,curated:true});
  assert.equal(stale[0].originalReleaseDate,'2026-10-30');
  const repaired = addon._internals.verifiedWorldCatalogMetas(s,catalog,date,0,'',stale);
  assert.equal(repaired[0].originalReleaseDate,'2026-10-09');
  assert.equal(repaired[0].released.slice(0,10),'2026-10-09');
});
test('streaming, rental/purchase and cinema are independently gated by French evidence', (t) => {
  const s = memory(t);
  s.upsert(record(1)); s.upsert(record(2, { 'watch/providers': FR('rent') }));
  s.upsert(record(3, { 'watch/providers': { results: {} }, release_dates: regional([3, '2026-10-25']) }));
  s.upsert(record(4, { 'watch/providers': { results: { US: { flatrate: [{ provider_id: 8, provider_name: 'US only' }] } } } }));
  assert.deepEqual(s.query({ view: 'streaming', now: NOW }).map((m) => m.name), ['Film 1']);
  assert.deepEqual(s.query({ view: 'vod', now: NOW }).map((m) => m.name), ['Film 2']);
  assert.deepEqual(s.query({ view: 'cinema', now: NOW }).map((m) => m.name), ['Film 3']);
  assert.equal(s.query({ now: NOW }).length, 3); assert.equal(s.visible('tmdb:4'), false);
});

test('all free/ad-supported/subscription and transactional offer types are indexed', (t) => {
  const s = memory(t);
  for (const [index, kind] of ['flatrate', 'free', 'ads', 'rent', 'buy'].entries()) s.upsert(record(index + 1, { 'watch/providers': FR(kind) }));
  assert.equal(s.query({ view: 'streaming', now: NOW }).length, 3);
  assert.equal(s.query({ view: 'vod', now: NOW }).length, 2);
  assert.equal(s.query({ now: NOW }).length, 5);
});

test('cinema and digital dates do not invent availability or platform-arrival dates', (t) => {
  const s = memory(t);
  s.upsert(record(1, { release_date: '2001-01-01', 'watch/providers': { results: {} },
    release_dates: regional([3, '2026-10-20'], [4, '2026-10-25']) }));
  assert.equal(s.query({ now: NOW }).length, 0, 'a 2001 film reissued in 2026 is not a 2026 release');
  assert.equal(s.query({ view: 'cinema', now: NOW }).length, 0);
  assert.equal(s.query({ view: 'streaming', now: NOW }).length, 0);
  const original = s.meta(s.row('tmdb:1'));
  assert.equal(original.released.slice(0,10),'2001-01-01');
  assert.match(original.description, /disponibilité actuelle.*vérifier/);
  assert.match(original.description, /ne constitue pas une date d’arrivée/);
});

test('archives stop today; tomorrow and next week can show verified announced releases', (t) => {
  const s = memory(t);
  s.upsert(record(1, { release_date: '2026-10-26', 'watch/providers': { results: {} }, release_dates: regional([3, '2026-10-26']) }));
  assert.equal(s.query({ view: 'cinema', period: '2026-10', now: NOW }).length, 0);
  assert.equal(s.query({ view: 'cinema', now: NOW }).length, 0);
  assert.equal(s.query({ view: 'cinema', period: 'tomorrow', now: NOW }).length, 1);
  assert.equal(s.query({ view: 'cinema', period: 'nextweek', now: NOW }).length, 1);
  assert(!periods(NOW).some((p) => p.key === '2027-01' || p.key === '2026-11'));
});

test('each movie appears once in a period, with stable unbounded pagination', (t) => {
  const s = memory(t);
  for (let id = 1; id <= 237; id++) s.upsert(record(id, { imdb_id: `tt${1000 + id}`,
    release_dates: regional([3, '2026-10-23'], [4, '2026-10-24'], [4, '2026-10-24']) }));
  const data = [0, 100, 200].flatMap((skip) => s.query({ skip, now: NOW }));
  assert.equal(data.length, 237); assert.equal(new Set(data.map((m) => m.id)).size, 237);
  assert(data.every((m) => m.type === 'movie' && m.id.startsWith('tt')));
  assert.throws(() => s.query({ skip: -1 })); assert.throws(() => s.query({ skip: 0.5 }));
});

test('genres include Histoire, Téléfilms and Guerre and support multi-classification', (t) => {
  const s = memory(t);
  s.upsert(record(1, { genres: [{ id: 36 }, { id: 10770 }, { id: 10752 }] }));
  for (const genre of ['36', '10770', '10752']) assert.equal(s.query({ genre, now: NOW }).length, 1);
  s.upsert(record(2, { genres: [{ id: 16 }, { id: 35 }] }));
  assert.equal(s.query({ now: NOW }).length, 1); assert.equal(s.stats().animationExcluded, 1);
});

test('undated films remain indexed; unknown media classification waits for enrichment', (t) => {
  const s = memory(t); s.upsert(record(1, { release_date: null })); s.upsert(record(2, { genres: [] }));
  assert.equal(s.query({ period: 'undated', now: NOW }).length, 0);
  assert.equal(s.query({ now: NOW }).length, 0); assert(s.row('tmdb:1')); assert.equal(s.stats().awaitingClassification, 1);
});

test('provider withdrawals and expiration immediately gate streaming without deleting cinema history', (t) => {
  const s = memory(t); s.upsert(record(1, { release_dates: regional([3, '2026-10-20']) }));
  s.setFranceOffers(1, []);
  assert.equal(s.query({ view: 'streaming', now: NOW }).length, 0);
  assert.equal(s.query({ view: 'cinema', now: NOW }).length, 1);
  s.upsert(record(2)); s.db.prepare('UPDATE movie_lanes SET checked_at=? WHERE tmdb_id=2').run(Date.now() - 49 * 3600000);
  assert.equal(s.visible('tmdb:2'), false);
});

test('recent per-title negative evidence wins over stale discovery', (t) => {
  const s = memory(t); s.upsert(record(1, { 'watch/providers': FR('rent') }));
  s.markDiscovered(1, 'streaming');
  assert.equal(s.query({ view: 'streaming', now: NOW }).length, 0);
  assert.equal(s.query({ view: 'vod', now: NOW }).length, 1);
});

test('search does not turn SQL metacharacters or wildcards into extra matches', (t) => {
  const s = memory(t); s.upsert(record(1, { title: '100% réel' })); s.upsert(record(2));
  assert.equal(s.query({ search: '%', now: NOW }).length, 1);
  assert.equal(s.query({ search: "' OR 1=1 --", now: NOW }).length, 0);
});

test('discover queries cover all services, use the correct market and distinguish release types', () => {
  const stream = discoverParams('streaming', {}, 1), vod = discoverParams('vod', {}, 1);
  assert.equal(stream.watch_region, 'FR'); assert.equal(stream.with_watch_providers, undefined);
  assert.equal(stream.with_watch_monetization_types, 'flatrate|free|ads');
  assert.equal(vod.with_watch_monetization_types, 'rent|buy');
  assert.equal(discoverParams('cinema', {}, 1).with_release_type, '3|2');
  assert.equal(discoverParams('digital', {}, 1).with_release_type, '4');
  assert.equal(discoverParams('digital', {}, 1).region, 'FR');
});

test('market scans resume pages and remove departures only after successful completion', async (t) => {
  const s = memory(t); s.upsert(record(9));
  await scanLane(s, 'streaming', { maxPages: 1, delay: 0, api: async () => payload(1, 2) });
  assert.equal(s.visible('tmdb:9'), true);
  await assert.rejects(scanLane(s, 'streaming', { delay: 0, api: async () => { throw new Error('HTTP 503'); } }));
  assert.equal(s.state('scan:streaming').tasks[0].page, 2);
  assert.equal(s.visible('tmdb:9'), true);
  await scanLane(s, 'streaming', { maxPages: 1, delay: 0, api: async () => payload(2, 2) });
  assert.equal(s.state('scan:streaming').complete, true); assert.equal(s.visible('tmdb:9'), false);
  assert.equal(s.query({ view: 'streaming', now: NOW }).length, 2);
});

test('oversized scans split by dates and retain an independent undated discovery probe', async (t) => {
  const s = memory(t); const calls = [];
  const api = async (_, params) => {
    calls.push(params);
    if (params.sort_by === 'primary_release_date.asc') return payload(3, 900, { results: [{ id: 3, title: 'Sans date', genre_ids: [18], release_date: '' }, { id: 4, title: 'Dated', genre_ids: [18], release_date: '1950-01-01' }] });
    if (!params['primary_release_date.gte'] && !params['primary_release_date.lte']) return payload(1, 900, { total_results: 18000 });
    return payload(1, 1);
  };
  const scan = await scanLane(s, 'streaming', { api, delay: 0, maxPages: 8 });
  assert(scan.complete); assert.equal(scan.overflow.length, 0);
  assert(calls.some((p) => p.sort_by === 'primary_release_date.asc'));
  assert(calls.some((p) => p['primary_release_date.gte']));
  assert.equal(s.row('tmdb:3').title, 'Sans date', 'undated discovery remains indexed');
});

test('movie date shards preserve open ends without invalid ancient or distant bounds', () => {
  const [past, future] = splitMovieDates({ lane: 'streaming', page: 1 });
  assert.equal(past.from, undefined); assert.equal(future.to, undefined);
  assert.equal(new Date(Date.parse(past.to) + 86400000).toISOString().slice(0, 10), future.from);
  for (const task of [past, future]) {
    const params = discoverParams('streaming', task, 1);
    assert(!Object.values(params).some((v) => /^(0001|9999)-/.test(String(v))));
  }
  const regional = splitMovieDates({ lane: 'cinema', to: '2026-11-01', page: 1 });
  assert.equal(regional[0].from, undefined); assert.equal(regional[1].to, '2026-11-01');
});

test('oversized responses consume the request budget and resume instead of looping', async (t) => {
  const s = memory(t); let calls = 0;
  const api = async () => { calls++; return payload(1, 1001, { total_results: 20001 }); };
  const first = await scanLane(s, 'streaming', { api, maxPages: 6, delay: 0 });
  assert.equal(calls, 6); assert.equal(first.requests, 6); assert.equal(first.complete, false);
  assert(first.tasks.length > 0);
  await scanLane(s, 'streaming', { api, maxPages: 4, delay: 0 });
  assert.equal(calls, 10); assert.equal(s.state('scan:streaming').requests, 10);
});

test('upgrading the date scanner replaces invalid persisted shards without deleting films', async (t) => {
  const s = memory(t); s.upsert(record(9));
  s.state('scan:streaming', { id: 'old', complete: false, tasks: [{ lane: 'streaming', from: '0001-01-01', to: '0001-01-01', page: 1 }] });
  const calls = [];
  await scanLane(s, 'streaming', { maxPages: 1, delay: 0, api: async (_, params) => { calls.push(params); return payload(1, 2); } });
  assert.equal(calls[0]['primary_release_date.gte'], undefined);
  assert.equal(s.state('scan:streaming').revision, 2); assert(s.visible('tmdb:9'));
});

test('detail corrections remove animation and replace revoked regional releases', async (t) => {
  const s = memory(t); s.upsert(record(1, { release_dates: regional([3, '2026-10-25']) }));
  s.enqueue('movie-detail', [1]);
  await runDetailJobs(s, { delay: 0, api: async () => ({ id: 1, title: 'Animated correction', genres: [{ id: 16 }],
    'watch/providers': FR(), release_dates: { results: [] } }) });
  assert.equal(s.query({ now: NOW }).length, 0); assert.equal(s.stats().cinemaReleases, 0);
});

test('every import source has a named manifest catalog, with stable standalone identities', () => {
  const origin = 'https://example.test/movies';
  const manifest = addon._internals.buildManifest(origin, NOW);
  const names = new Map(manifest.catalogs.map((c) => [c.id, c.name]));
  assert(!manifest.catalogs.some(c => c.id.includes('-unclassified-')));
  assert.equal(names.size, manifest.catalogs.length); assert.equal(manifest.types[0], 'movie');
  assert.equal(VIEWS.length, 4); assert.equal(GENRES.length, 21);
  assert.notEqual(manifest.id, 'com.nuvio.series.france.liveaction.v2');
  for (const mode of ['shield', 'desktop']) {
    const imported = addon._internals.buildCollections(origin, NOW, mode);
    assert.equal(imported.length, 4);
    for (const collection of imported) for (const folder of collection.folders) {
      assert(!folder.id.endsWith('-unclassified'));
      assert.equal(folder.tileShape, 'LANDSCAPE');
      assert.deepEqual(folder.sources.slice(0, 5).map((s) => parseCatalog(s.catalogId).period), ['today', 'tomorrow', 'yesterday', 'lastweek', 'nextweek']);
      assert(!folder.sources.some((s) => /-all$|-2027-|-2026-11/.test(s.catalogId)));
      const keys = folder.sources.map((s) => parseCatalog(s.catalogId).period);
      const western = parseCatalog(folder.sources[0].catalogId).genre === '37';
      assert(keys.includes('2018-01'));
      for (const old of ['2017-12', '2015-01', '1950', 'before1900', 'undated']) assert.equal(keys.includes(old), western);
      for (const source of folder.sources) { assert.equal(source.addonId, manifest.id); assert(names.has(source.catalogId)); }
    }
  }
});

test('all genre covers use the approved 16:9 design and include three previously missing film themes', async () => {
  assert(progress().ready);
  for (const genre of GENRES) {
    const info = await sharp(genreBytes(genre.id)).metadata();
    assert.equal(info.width, 1600); assert.equal(info.height, 900); assert.equal(info.format, 'webp');
  }
  for (const id of ['36', '10770', '10752']) assert(genreBytes(id));
});

test('movie cards preserve custom Modern/desktop targeting and detail art, including no-photo fallback', (t) => {
  const s = memory(t); s.upsert(record(1, { poster_path: '/poster.jpg', backdrop_path: '/backdrop.jpg' }));
  const raw = s.query({ now: NOW })[0];
  const [decorated] = decorateMovieMetas('https://example.test/movies', [raw], { period: 'all' });
  assert.equal(decorated.posterShape, 'landscape');
  assert.equal(new URL(decorated.background).pathname, '/fr/calendar-card.jpg');
  assert.equal(new URL(decorated.banner).pathname, '/fr/desktop-content-card.jpg');
  assert.equal(new URL(decorated.background).searchParams.get('type'), 'movie');
  assert.equal(raw.background, 'https://image.tmdb.org/t/p/w1280/backdrop.jpg');
  const [fallback] = decorateMovieMetas('https://example.test/movies', [{ ...raw, poster: undefined, background: undefined }], { period: 'all' });
  assert.equal(new URL(fallback.background).pathname, '/fr/calendar-card.jpg');
});

test('streaming and VOD cards display a provider for that offer type', (t) => {
  const s = memory(t);
  s.upsert(record(1, { poster_path: '/poster.jpg', backdrop_path: '/backdrop.jpg', 'watch/providers': { results: { FR: {
    flatrate: [{ provider_id: 8, provider_name: 'Netflix' }], rent: [{ provider_id: 10, provider_name: 'Amazon Video' }]
  } } } }));
  for (const [view, expected] of [['streaming', 'Netflix'], ['vod', 'Amazon Video']]) {
    const metas = s.query({ view, now: NOW });
    const card = decorateMovieMetas('https://example.test/movies', metas, { view, period: 'all' })[0];
    assert.equal(new URL(card.background).searchParams.get('provider'), expected);
  }
});


test('2018 cutoff covers all four movie views while Western retains every historical period', (t) => {
  const s = memory(t);
  for (const [id, date] of [[801, '2017-12-31'], [802, '2018-01-01'], [803, '1890-01-01']]) {
    s.upsert(record(id, { release_date: date, genres: [{ id: 18 }, { id: 37 }],
      release_dates: regional([3, date], [4, date]) }));
    s.markDiscovered(id, 'vod');
  }
  for (const { id: view } of VIEWS) {
    assert.deepEqual(s.query({ view, now: NOW }).map((m) => m.name), ['Film 802']);
    assert.equal(s.query({ view, genre: '18', period: '2017-12', now: NOW }).length, 0);
    assert.equal(s.query({ view, genre: '18', period: '2017', now: NOW }).length, 0);
    assert.equal(s.query({ view, search: '801', now: NOW }).length, 0);
    assert.equal(s.query({ view, genre: '37', period: '2017-12', now: NOW }).length, 1);
    assert.equal(s.query({ view, genre: '37', period: 'before1900', now: NOW }).length, 1);
    assert.equal(s.query({ view, genre: '37', now: NOW }).length, 3);
  }
  assert(s.row('tmdb:801'));
});
