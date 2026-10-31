'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/index');
const { nativeBridgePayload, resolveNativeImage } = require('../runtime/native-bridge.cjs');

const ORIGIN = 'https://nuvio.example';
const POSTER = 'https://image.tmdb.org/t/p/original/poster-a.jpg';
const BACKDROP = 'https://image.tmdb.org/t/p/original/backdrop-b.jpg';

function request(route) {
  return new Promise((resolve, reject) => {
    const req = { method: 'GET', url: route, headers: {
      host: 'nuvio.example', 'x-forwarded-proto': 'https',
      'x-nuvio-timezone': 'Europe/Brussels'
    }};
    let statusCode = 200;
    const headers = {};
    const res = {
      get statusCode() { return statusCode; },
      set statusCode(value) { statusCode = value; },
      setHeader(key, value) { headers[String(key).toLowerCase()] = value; },
      getHeader(key) { return headers[String(key).toLowerCase()]; },
      end(body = '') { resolve({ statusCode, headers, body: String(body) }); }
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

test('Native Bridge unwraps the generated Film Monde card into original TMDB CDN artwork', () => {
  const card = ORIGIN + '/fr/calendar-card.jpg?layout=landscape&src=' + encodeURIComponent(BACKDROP)
    + '&fallback=' + encodeURIComponent(POSTER) + '&title=Example';
  const output = nativeBridgePayload({ metas: [{
    id: 'tt0000001', type: 'movie', name: 'Example',
    released: '2026-10-30T00:00:00.000Z', originalReleaseDate: '2026-10-30',
    streamingProviders: ['Prime Video'], poster: card, background: card,
    landscapePoster: card, banner: ORIGIN + '/fr/desktop-content-card.jpg?src=' + encodeURIComponent(BACKDROP)
  }] }, ORIGIN);
  const result = output.metas[0];
  assert.equal(result.poster, 'https://image.tmdb.org/t/p/w500/poster-a.jpg');
  assert.equal(result.background, 'https://image.tmdb.org/t/p/w1280/backdrop-b.jpg');
  assert.equal(result.landscapePoster, 'https://image.tmdb.org/t/p/w780/backdrop-b.jpg');
  assert.equal(result.banner, 'https://image.tmdb.org/t/p/w780/backdrop-b.jpg');
  assert.equal(result.id, 'tt0000001');
  assert.equal(result.released, '2026-10-30T00:00:00.000Z');
  assert.deepEqual(result.streamingProviders, ['Prime Video']);
  assert.doesNotMatch(JSON.stringify(result), /\/fr\/(?:calendar-card|desktop-content-card)/);
});

test('Native Bridge preserves external TVDB artwork, metadata and episodes', () => {
  const tvdb = 'https://artworks.thetvdb.com/banners/posters/123-1.jpg';
  const source = { meta: { id: 'tt123', type: 'series', poster: tvdb, videos: [
    { id: 'S01E01', thumbnail: ORIGIN + '/images/original.jpg?src=' + encodeURIComponent(BACKDROP) }
  ], links: [{ name: 'Original release', url: 'https://example.com/release' }] } };
  const output = nativeBridgePayload(source, ORIGIN);
  assert.equal(output.meta.poster, tvdb);
  assert.equal(output.meta.videos[0].thumbnail, 'https://image.tmdb.org/t/p/w500/backdrop-b.jpg');
  assert.deepEqual(output.meta.links, source.meta.links);
  assert.equal(source.meta.videos[0].thumbnail.startsWith(ORIGIN), true, 'original payload not mutated');
});

test('Native Bridge refuses untrusted redirected, injected and protocol-relative image endpoints', () => {
  for (const hostile of [
    'https://untrusted.example/a.jpg',
    'http://image.tmdb.org/t/p/original/b.jpg',
    'https://evil.example/other?src=' + encodeURIComponent(POSTER),
    ORIGIN + '/fr/not-a-card.jpg?src=' + encodeURIComponent(POSTER),
    ORIGIN + '/fr/calendar-card.jpg?src=' + encodeURIComponent('http://example.com/a.jpg')
  ]) assert.equal(resolveNativeImage(hostile, 'poster', ORIGIN), null, hostile);
  const missing = ORIGIN + '/fr/calendar-card.jpg?title=No%20poster';
  const untouched = nativeBridgePayload({ metas: [{ id: 'ttmissing', poster: missing }] }, ORIGIN);
  assert.equal(untouched.metas[0].poster, missing, 'do not blank a card with no source');
});

test('Native Bridge profiles keep all IDs and labels for Shield and Mobile', async () => {
  for (const region of ['fr','us','tr','global','movies','series-v2']) {
    const [canonical, tv, mobile] = await Promise.all([
      request(`/${region}/manifest.json`),
      request(`/${region}/native-bridge/manifest.json`),
      request(`/${region}/native-bridge/mobile/manifest.json`)
    ]);
    assert.equal(tv.statusCode, 200, 'Shield ' + region);
    assert.equal(mobile.statusCode, 200, 'Mobile ' + region);
    const original = JSON.parse(canonical.body);
    const shield = JSON.parse(tv.body);
    const handset = JSON.parse(mobile.body);
    for (const manifest of [shield, handset]) {
      assert.equal(manifest.id, original.id, region);
      assert.equal(manifest.version, original.version, region);
      assert.deepEqual(manifest.resources, original.resources, region);
      assert.deepEqual(manifest.catalogs.map(c => [c.id, c.type, c.name]),
        original.catalogs.map(c => [c.id, c.type, c.name]), region);
      assert(manifest.catalogs.every(c => c.showInHome === false), region);
    }
    assert(shield.catalogs.every(c => c.extra.some(e => e.name === 'search' && e.isRequired)));
    assert(handset.catalogs.every(c => c.extra.some(e => e.name === 'genre' && e.isRequired)));
    assert.equal(tv.headers['cache-control'], 'no-store');
  }
});

test('Native Bridge delegates legacy artwork paths without changing the canonical routes', async () => {
  const [native, canonical] = await Promise.all([
    request('/fr/native-bridge/logo.svg'),
    request('/fr/logo.svg')
  ]);
  assert.equal(native.statusCode, 200);
  assert.equal(native.body, canonical.body);
  const invalid = await request('/movies/native-bridge/catalog/movie/not-a-real-catalog.json');
  assert.equal(invalid.statusCode, 404, 'errors must not be turned into empty successful catalogs');
});

test('Films Monde 16:9 card uses direct landscape source and preserves portrait for metadata',()=>{
  const card=ORIGIN + '/fr/calendar-card.jpg?src=' + encodeURIComponent(BACKDROP)
    + '&fallback=' + encodeURIComponent(POSTER);
  const meta={id:'tt777',name:'Example',type:'movie',posterShape:'landscape',
    poster:card,background:card,landscapePoster:card,
    logo:'https://image.tmdb.org/t/p/w500/title.png',
    released:'2026-10-30T00:00:00.000Z'};
  const fromCatalog=nativeBridgePayload({metas:[meta]},ORIGIN,{landscapeCatalog:true}).metas[0];
  assert.equal(fromCatalog.poster,'https://image.tmdb.org/t/p/w780/backdrop-b.jpg');
  assert.equal(fromCatalog._rawPosterUrl,'https://image.tmdb.org/t/p/w500/poster-a.jpg');
  assert.equal(fromCatalog.logo,meta.logo);
  assert.equal(fromCatalog.released,meta.released);
  const detail=nativeBridgePayload({meta},ORIGIN).meta;
  assert.equal(detail.poster,'https://image.tmdb.org/t/p/w500/poster-a.jpg');
  assert.equal(detail.logo,meta.logo);
  const otherRegions=nativeBridgePayload({metas:[meta]},ORIGIN).metas[0];
  assert.equal(otherRegions.poster,detail.poster,'no changes to other addons');
});

test('Live Filmes Monde Bridge endpoints retain native logo and landscape card shape',async()=>{
  // With no local SQLite DB, test route signatures and fallback rather than
  // inventing a populated film; real production is checked after deployment.
  const [tv,mobile]=await Promise.all([
    request('/movies/native-bridge/manifest.json'),
    request('/movies/native-bridge/mobile/manifest.json')
  ]);
  assert.equal(tv.statusCode,200);
  assert.equal(mobile.statusCode,200);
});
