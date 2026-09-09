'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/index');
const cal = require('../src/calendar');

const I = handler._internals;
const NOW = new Date('2026-08-30T12:00:00Z');
const TZ = 'Europe/Istanbul';
const ORIGIN = 'https://nuvio-last.vercel.app/tr';

const expectedPlatforms = [
  '🇹🇷 Netflix','🇹🇷 Prime Video','🇹🇷 Disney+','🇹🇷 Max','🇹🇷 Apple TV+','🇹🇷 MUBI',
  '🇹🇷 Exxen','🇹🇷 GAİN','🇹🇷 tabii','🇹🇷 TOD','🇹🇷 puhutv','🇹🇷 TV+','🇹🇷 Tivibu',
  '🇹🇷 D-Smart GO','🇹🇷 S Sport Plus','🇹🇷 Crunchyroll + AniList','🇹🇷 Türkiye Takvim','🇹🇷 VOD Türkiye'
];

test('Turkey market constants are forced', () => {
  assert.equal(cal.DEFAULT_COUNTRY, 'TR');
  assert.equal(cal.DEFAULT_LANGUAGE, 'tr-TR');
  assert.equal(cal.DEFAULT_TIMEZONE, 'Europe/Istanbul');
});

test('Turkey collections have requested platforms and global Turkey calendar', () => {
  const collections = I.buildNuvioCollectionsImport(NOW, TZ, ORIGIN);
  assert.deepEqual(collections.map(c => c.title), expectedPlatforms);
  assert.equal(collections.length, 18);
  assert.deepEqual(collections.at(-1).folders.map(f => f.title), ['Films']);
  assert.deepEqual(collections.at(-2).folders.map(f => f.title), ['Séries', 'Films']);
});

test('Every Turkey folder uses all 197 predefined periods', () => {
  const collections = I.buildNuvioCollectionsImport(NOW, TZ, ORIGIN);
  for (const collection of collections) {
    for (const folder of collection.folders) {
      assert.equal(folder.sources.length, 197, `${collection.title}/${folder.title}`);
      assert.match(folder.sources[0].catalogId, /-today$/);
      assert.match(folder.sources[1].catalogId, /-tomorrow$/);
      assert.match(folder.sources[2].catalogId, /-yesterday$/);
      assert.match(folder.sources[3].catalogId, /-lastweek$/);
      assert.match(folder.sources[4].catalogId, /-nextweek$/);
      assert.match(folder.sources[5].catalogId, /-2030-12$/);
      assert.match(folder.sources.at(-1).catalogId, /-2015-01$/);
    }
  }
});

test('Turkey manifest has unique catalog IDs and correct addon identity', () => {
  const manifest = I.buildManifest(ORIGIN, NOW, TZ);
  assert.equal(manifest.id, 'com.nuvio.calendar.archives.tr.coexist');
  assert.equal(manifest.language, 'tr');
  assert.equal(manifest.catalogs.length, 6895);
  const keys = manifest.catalogs.map(c => `${c.type}:${c.id}`);
  assert.equal(new Set(keys).size, keys.length);
});

test('dynamic periods resolve to Istanbul-local calendar windows', () => {
  const today = cal.dateWindow('today', NOW, TZ);
  const tomorrow = cal.dateWindow('tomorrow', NOW, TZ);
  const lastweek = cal.dateWindow('lastweek', NOW, TZ);
  assert.equal(today.start, today.end);
  assert.notEqual(today.start, tomorrow.start);
  assert.ok(lastweek.start < lastweek.end);
});


test('desktop gets a dedicated cinematic JPEG while Shield keeps its SVG background', () => {
  const meta = {
    id: 'tt1234567',
    type: 'movie',
    name: 'Desktop Cinematic Test',
    poster: 'https://image.tmdb.org/t/p/w500/demo.jpg',
    background: 'https://image.tmdb.org/t/p/original/demo-bg.jpg',
    landscapePoster: 'https://image.tmdb.org/t/p/original/demo-bg.jpg',
    releaseInfo: 'Test',
    released: '2026-08-30',
    _calendarProvider: 'Netflix',
    _calendarSource: 'tmdb-streaming'
  };
  const [decorated] = I.decorateCatalogMetas(
    'https://catalog.example',
    [meta],
    { period: 'today', type: 'movie', cardProvider: 'Netflix' },
    TZ
  );
  assert.equal(decorated.posterShape, 'landscape');
  assert.match(decorated.background, /calendar-card\.svg/);
  assert.match(decorated.banner, /desktop-content-card\.jpg/);
  assert.notEqual(decorated.banner, decorated.background);
});


test('Max resolver also accepts legacy BluTV naming and Crunchyroll is a native Turkey platform', () => {
  const max = I.resolveProviderFromDirectory(
    I.PROVIDERS.find((p) => p.slug === 'max'),
    [{ id: 9991, name: 'BluTV', normalized: 'blutv', logoPath: '/blu.png' }]
  );
  assert.deepEqual(max.ids, [9991]);
  assert.equal(max.matchedNames[0], 'BluTV');

  const crunchy = I.PROVIDERS.find((p) => p.slug === 'crunchyroll');
  assert(crunchy);
  assert.equal(crunchy.label, 'Crunchyroll');
  const collection = I.buildNuvioCollectionsImport(NOW, TZ, ORIGIN).find((c) => c.title.includes('Crunchyroll'));
  assert(collection);
  assert.deepEqual(collection.folders.map((f) => f.title), ['Séries', 'Films']);
});


test('local Türkiye network fallback accepts platform originals when watch-provider metadata is missing', () => {
  for (const [slug, network] of [
    ['exxen', 'Exxen'],
    ['gain', 'GAİN'],
    ['tabii', 'tabii'],
    ['puhutv', 'Puhu TV'],
    ['tv-plus', 'Turkcell TV+'],
    ['tivibu', 'Tivibu'],
    ['d-smart-go', 'D-Smart']
  ]) {
    const provider = I.PROVIDERS.find((entry) => entry.slug === slug);
    assert(provider, slug);
    assert.equal(
      I.hasProviderAccess({ networks: [{ name: network }], 'watch/providers': { results: { TR: {} } } }, { ...provider, ids: [] }),
      true,
      slug
    );
  }
});
