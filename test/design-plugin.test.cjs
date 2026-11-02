'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  posterPattern, parsePosterQuery, sourceInfo, resolveInfo,
  pickProvider, cardSvg, isoDate, handle, RENDER_REV
} = require('../runtime/design-plugin.cjs');

const parse = s => parsePosterQuery(new URL('https://example.test/design-plugin/poster.jpg?' + s));
function response() {
  const headers = {};
  return {
    statusCode: 200, headers,
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    end(body) { this.body = body; }
  };
}

test('one native Custom Posters URL keeps its type/id/shape placeholders and busts old cache', () => {
  const pattern = posterPattern('https://example.test');
  assert.equal(pattern, 'https://example.test/design-plugin/poster.jpg?type={type}&id={id}&shape={shape}&v=' + RENDER_REV);
  assert.deepEqual(parse('type=movie&id=tt1234567&shape=landscape'),
    { kind: 'movie', id: 'tt1234567', shape: 'landscape' });
  assert.deepEqual(parse('type=series&id=tmdb%3Atv%3A123&shape=poster'),
    { kind: 'series', id: 'tmdb:tv:123', shape: 'poster' });
  assert.deepEqual(parse('type=movie&id=tmdb%3Amovie%3A123&shape=landscape'),
    { kind: 'movie', id: 'tmdb:movie:123', shape: 'landscape' });
  for (const p of [
    'type=movie&id=abc&shape=landscape',
    'type=movie&id=tmdb%3Atv%3A123',
    'type=series&id=tmdb%3Amovie%3A123',
    'type=movie&id=tt1234567&shape=evil',
    'type=other&id=tt1234567',
    'type=movie&id=https%3A%2F%2Fevil.test'
  ]) assert.equal(parse(p), null, p);
});

test('local source images stay restricted to TMDB with original native fallback', () => {
  const row = {
    title: 'Titre français', poster: 'https://image.tmdb.org/t/p/w500/film.jpg',
    background: 'https://image.tmdb.org/t/p/w1280/backdrop.jpg'
  };
  const store = { row(id) { assert.equal(id, 'tmdb:123'); return row; } };
  assert.deepEqual(sourceInfo({ kind: 'movie', id: 'tmdb:movie:123', shape: 'landscape' }, store, null), {
    type: 'movie', layout: 'landscape', src: row.background,
    fallback: row.poster, title: row.title
  });
  assert.equal(sourceInfo({ kind: 'movie', id: 'tt12345', shape: 'poster' }, null, null), null);
  assert.equal(sourceInfo({ kind: 'movie', id: 'tt12345', shape: 'landscape' },
    { row: () => ({ title: 'x', poster: 'https://evil.test/a.jpg' }) }, null), null);
});

test('provider is labeled ONLY when unequivocal; no fabricated Netflix for mixed catalogs', () => {
  assert.equal(pickProvider({ results: { FR: { flatrate: [{ provider_name: 'Netflix' }] } } }), 'Netflix');
  assert.equal(pickProvider({ results: { FR: { flatrate: [
    { provider_name: 'Netflix' }, { provider_name: 'Amazon Prime Video' }
  ] } } }), null);
  assert.equal(pickProvider(null, [{ name: 'Prime Video', kind: 'flatrate' }]), 'Prime Video');
  assert.equal(pickProvider(null, [{ name: 'Netflix', kind: 'flatrate' }, { name: 'Prime Video', kind: 'flatrate' }]), null);
  assert.equal(pickProvider(null, [{ name: 'Netflix', kind: 'rent' }]), null);
});

test('global TMDB item, outside local collections, gains approved dynamic details', async () => {
  const request = { kind: 'series', id: 'tmdb:tv:987654321', shape: 'landscape' };
  const mockTmdb = async (path, params) => {
    assert.equal(path, '/tv/987654321');
    assert.equal(params.language, 'fr-FR');
    return {
      id: 987654321, name: 'Série exemple', first_air_date: '2024-11-05',
      backdrop_path: '/background.jpg', poster_path: '/poster.jpg',
      number_of_seasons: 3, vote_average: 8.36,
      genres: [{ id: 18, name: 'Drame' }, { id: 80, name: 'Crime' }],
      images: { logos: [{
        file_path: '/logo.png', iso_639_1: 'fr', width: 600, height: 200
      }] },
      'watch/providers': { results: { FR: {
        flatrate: [{ provider_name: 'Netflix' }]
      } } }
    };
  };
  const info = await resolveInfo(request, null, null, mockTmdb);
  assert.equal(info.layout, 'landscape');
  assert.equal(info.src, 'https://image.tmdb.org/t/p/w1280/background.jpg');
  assert.equal(info.logo, 'https://image.tmdb.org/t/p/w500/logo.png');
  assert.equal(info.provider, 'Netflix');
  assert.equal(info.date, '2024-11-05');
  assert.equal(info.year, '2024');
  assert.equal(info.rating, 8.4);
  assert.equal(info.seasons, 3);
  assert.deepEqual(info.genres, ['Drame', 'Crime']);
  const card = cardSvg(info, true);
  assert.match(card, /NETFLIX/);
  assert.match(card, /3 SAISONS/);
  assert.match(card, /05\/11\/2024/);
  assert.match(card, /Drame/);
  assert.match(card, /8\.4\/10/);
  assert.doesNotMatch(card, />Série exemple</);
});

test('movie shows real title when official logo absent and no seasons', async () => {
  const request = { kind: 'movie', id: 'tmdb:movie:987654322', shape: 'landscape' };
  const info = await resolveInfo(request, null, null, async () => ({
    title: 'Le film & exemple', release_date: '2020-03-10',
    backdrop_path: '/film.jpg', vote_average: 6.81,
    genres: [{ name: 'Action' }]
  }));
  assert.equal(info.seasons, null);
  assert.equal(info.provider, null);
  const card = cardSvg(info, false);
  assert.match(card, /Le film &amp; exemple/);
  assert.match(card, /10\/03\/2020/);
  assert.match(card, /FILM/);
  assert.doesNotMatch(card, /SAISON/);
  assert.equal(isoDate('2024-02-30'), null);
});

test('config exposes real limitations and unsupported portrait/square requests use native fallback', async () => {
  const config = response();
  await handle({ url: '/design-plugin/config.json', headers: {} }, config, 'https://example.test');
  const data = JSON.parse(config.body);
  assert.equal(config.statusCode, 200);
  assert.equal(data.requiresModifiedApk, false);
  assert.equal(data.imageRatio, '16:9');
  assert.match(data.platformPolicy, /collection/);
  assert.match(data.existingCollections, /nuvio-collections-unified\.json$/);

  for (const shape of ['poster', 'square']) {
    const fallback = response();
    await handle({ url: '/design-plugin/poster.jpg?type=movie&id=tmdb:movie:123&shape=' + shape, headers: {} },
      fallback, 'https://example.test');
    assert.equal(fallback.statusCode, 404);
  }
  const bad = response();
  await handle({ url: '/design-plugin/poster.jpg?type=movie&id=unknown&shape=landscape', headers: {} },
    bad, 'https://example.test');
  assert.equal(bad.statusCode, 400);
});
