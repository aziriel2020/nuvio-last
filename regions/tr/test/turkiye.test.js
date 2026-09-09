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
  '🇹🇷 D-Smart GO','🇹🇷 S Sport Plus','🇹🇷 Bi Kanal','🇹🇷 Crunchyroll + AniList','🇹🇷 Türkiye Takvim','🇹🇷 VOD Türkiye'
];

test('Turkey market constants are forced', () => {
  assert.equal(cal.DEFAULT_COUNTRY, 'TR');
  assert.equal(cal.DEFAULT_LANGUAGE, 'tr-TR');
  assert.equal(cal.DEFAULT_TIMEZONE, 'Europe/Istanbul');
});

test('Turkey collections have requested platforms and global Turkey calendar', () => {
  const collections = I.buildNuvioCollectionsImport(NOW, TZ, ORIGIN);
  assert.deepEqual(collections.map(c => c.title), expectedPlatforms);
  assert.equal(collections.length, 19);
  assert.deepEqual(collections.at(-1).folders.map(f => f.title), ['Films']);
  assert.deepEqual(collections.at(-2).folders.map(f => f.title), ['Séries', 'Films']);
});

test('Turkey folders expose their real operational periods', () => {
  const collections = I.buildNuvioCollectionsImport(NOW, TZ, ORIGIN);
  for (const collection of collections) {
    for (const folder of collection.folders) {
      if (collection.title === '🇹🇷 S Sport Plus') {
        assert.equal(folder.title, 'Sports en direct');
        assert.equal(folder.sources.length, 3);
        assert.match(folder.sources[0].catalogId, /-today$/);
        assert.match(folder.sources[1].catalogId, /-tomorrow$/);
        assert.match(folder.sources[2].catalogId, /-nextweek$/);
        continue;
      }
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


test('Exxen, GAİN and tabii keep stable TMDb provider fallbacks', () => {
  const exxen = I.PROVIDERS.find((entry) => entry.slug === 'exxen');
  const gain = I.PROVIDERS.find((entry) => entry.slug === 'gain');
  const tabii = I.PROVIDERS.find((entry) => entry.slug === 'tabii');
  assert.deepEqual(exxen.fallbackIds, [1791]);
  assert.deepEqual(gain.fallbackIds, [2240]);
  assert.deepEqual(tabii.fallbackIds, [2235]);
  assert.equal(exxen.tvmazeArchive, true);
  assert.equal(gain.tvmazeArchive, true);
  assert.equal(tabii.tvmazeArchive, true);
});

test('TVmaze exact Turkish web channels are accepted as authoritative provider matches', () => {
  for (const [slug, webChannelName] of [
    ['exxen', 'Exxen'],
    ['gain', 'GAIN'],
    ['tabii', 'tabii'],
    ['tod', 'beIN CONNECT'],
    ['puhutv', 'Puhu TV']
  ]) {
    const provider = I.PROVIDERS.find((entry) => entry.slug === slug);
    assert(provider, slug);
    assert.equal(
      I.webChannelMatchesProvider({ webChannel: { name: webChannelName, country: { code: 'TR' } } }, provider),
      true,
      slug
    );
  }
});


test('Bi Kanal is a series-only TVmaze-authoritative Türkiye collection', () => {
  const provider = I.PROVIDERS.find((entry) => entry.slug === 'bi-kanal');
  assert(provider);
  assert.equal(provider.tvmazeArchive, true);
  assert.equal(provider.seriesOnly, true);
  assert.equal(I.webChannelMatchesProvider({ webChannel: { name: 'Bi Kanal', country: { code: 'TR' } } }, provider), true);
  const collection = I.buildNuvioCollectionsImport(NOW, TZ, ORIGIN).find((entry) => entry.title === '🇹🇷 Bi Kanal');
  assert(collection);
  assert.deepEqual(collection.folders.map((folder) => folder.title), ['Séries']);
});


test('S Sport Plus is a live-only collection backed by its official schedule parser', () => {
  const provider = I.PROVIDERS.find((entry) => entry.slug === 's-sport-plus');
  assert(provider);
  assert.equal(provider.seriesOnly, true);
  assert.equal(provider.liveSports, true);
  const collection = I.buildNuvioCollectionsImport(NOW, TZ, ORIGIN).find((entry) => entry.title === '🇹🇷 S Sport Plus');
  assert(collection);
  assert.deepEqual(collection.folders.map((folder) => folder.title), ['Sports en direct']);
  assert.deepEqual(
    collection.folders[0].sources.map((source) => source.catalogId.split('-').at(-1)),
    ['today', 'tomorrow', 'nextweek']
  );

  const fixture = `
    <section>
      <h2>Gelecek Canlı Yayınlar</h2>
      <h5>FIBA Basketball Women's World Cup / Porto Riko - Çin / Çeyrek Final Elemeleri</h5>
      <div>9 Eylül Çarşamba 18:45</div>
      <h5>Roshn Saudi League 6. Hafta / Al Nassr - Abha</h5>
      <div>9 Eylül Çarşamba 21:00</div>
      <h5>NFL Kickoff Game / New England Patriots - Seattle Seahawks</h5>
      <div>10 Eylül Perşembe 03:20</div>
      <h2>Neden S Sport Plus?</h2>
    </section>
  `;
  const events = I.parseSSportUpcomingHtml(fixture, new Date('2026-09-09T10:00:00Z'), TZ);
  assert.equal(events.length, 3);
  assert.deepEqual(events.map((event) => [event.calendarDate, event.time]), [
    ['2026-09-09', '18:45'],
    ['2026-09-09', '21:00'],
    ['2026-09-10', '03:20']
  ]);
  assert.match(events[0].title, /Porto Riko/);
});


test('S Sport official iCalendar parser filters only S Sport Plus and preserves exact Istanbul datetime', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'DTSTART;TZID=Europe/Istanbul:20260909T184500',
    'DTEND;TZID=Europe/Istanbul:20260909T191500',
    'SUMMARY:Porto Riko - Çin',
    'DESCRIPTION:FIBA Kadinlar Dünya Kupasi, Platform/Kanal : S Sport Plus',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
  const other = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'DTSTART;TZID=Europe/Istanbul:20260909T200000',
    'SUMMARY:Other Event',
    'DESCRIPTION:Football, Platform/Kanal : Eurosport',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
  const html = [
    '<a href="text/calendar;charset=utf8;base64,' + Buffer.from(ics).toString('base64') + '">Takvime ekle</a>',
    '<a href="text/calendar;charset=utf8;base64,' + Buffer.from(other).toString('base64') + '">Takvime ekle</a>'
  ].join('');
  const events = I.parseSSportIcsEvents(html);
  assert.equal(events.length, 1);
  assert.equal(events[0].calendarDate, '2026-09-09');
  assert.equal(events[0].time, '18:45');
  assert.equal(events[0].title, 'Porto Riko - Çin');
  assert.equal(events[0].category, 'FIBA Kadinlar Dünya Kupasi');
});


test('D-Smart archive descriptors use the native CMS source for Series and Movies', () => {
  const provider = I.PROVIDERS.find((entry) => entry.slug === 'd-smart-go');
  assert(provider);
  const series = I.archiveDynamicDescriptor('series', provider, 'today');
  const movie = I.archiveDynamicDescriptor('movie', provider, 'today');
  assert.equal(series.source, 'dsmart-cms');
  assert.equal(movie.source, 'dsmart-cms');
});

test('D-Smart native item maps official dates, artwork and stable IDs', () => {
  const item = {
    id: 1383256,
    name: 'Tudorlar: Taht, İhanet ve İnfaz',
    displayTitle: 'Tudorlar: Taht, İhanet ve İnfaz',
    displayStart: '2026-09-06T21:00:00+00:00',
    createdDate: '2026-09-09T07:07:00+00:00',
    updatedDate: '2026-09-09T07:22:15.6565044+00:00',
    description: '<p>D-Smart test açıklaması</p>',
    images: [
      { type: 'Poster', url: 'https://zdi2vdd5r0wt.merlincdn.net/content/test/poster.jpg' },
      { type: 'Thumbnail', url: 'https://zdi2vdd5r0wt.merlincdn.net/content/test/thumbnail.jpg' },
      { type: 'Background', url: 'https://zdi2vdd5r0wt.merlincdn.net/content/test/background.jpg' }
    ]
  };
  assert.equal(I.dsmartItemAvailabilityDate(item, 'Europe/Istanbul'), '2026-09-07');
  const meta = I.dsmartItemToMeta(item, 'series', 'Europe/Istanbul');
  assert.equal(meta.id, 'dsmart:1383256');
  assert.equal(meta.type, 'series');
  assert.equal(meta.name, item.displayTitle);
  assert.equal(meta.poster, item.images[0].url);
  assert.equal(meta.background, item.images[2].url);
  assert.equal(meta.landscapePoster, item.images[2].url);
  assert.match(meta.description, /D-Smart GO Türkiye/);
  assert.equal(meta._calendarSource, 'dsmart-cms');
  assert.equal(I.isAllowedPosterSource(meta.poster), true);
});

test('D-Smart 1969 availability sentinel falls back to CMS creation date', () => {
  const item = {
    id: 1357051,
    name: 'Sekizinci Aile',
    displayStart: '1969-12-31T22:00:00+00:00',
    createdDate: '2026-09-07T10:59:25+00:00',
    updatedDate: '2026-09-08T09:47:17.852317+00:00',
    images: [{ type: 'Poster', url: 'https://zdi2vdd5r0wt.merlincdn.net/content/test/poster.jpg' }]
  };
  assert.equal(I.dsmartItemAvailabilityInstant(item), '2026-09-07T10:59:25.000Z');
  assert.equal(I.dsmartItemAvailabilityDate(item, 'Europe/Istanbul'), '2026-09-07');
});

test('Türkiye manifest exposes native D-Smart meta IDs', () => {
  const manifest = I.buildManifest(ORIGIN, NOW, TZ);
  assert(manifest.idPrefixes.includes('dsmart:'));
  const metaResource = manifest.resources.find((entry) => entry.name === 'meta');
  assert(metaResource.idPrefixes.includes('dsmart:'));
});
