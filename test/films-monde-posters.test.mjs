import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import api from '../api/index.js';
import { edgeTtl } from '../runtime/router.mjs';
import { fastContentCards, REVISION } from '../regions/fr/api/fast-content-cards.cjs';

function directRequest(uri) {
  return new Promise((resolve, reject) => {
    const req = { method: 'GET', url: uri, headers: {
      host: 'nuvio.example', 'x-forwarded-proto': 'https',
      'x-nuvio-timezone': 'Europe/Brussels'
    }};
    let status = 200;
    const headers = new Map();
    const res = {
      get statusCode() { return status; },
      set statusCode(code) { status = code; },
      setHeader(name, value) { headers.set(name.toLowerCase(), String(value)); },
      getHeader(name) { return headers.get(name.toLowerCase()); },
      end(body) { resolve({ status, headers, bytes: Buffer.isBuffer(body) ? body : Buffer.from(body || '') }); }
    };
    Promise.resolve(api(req, res)).catch(reject);
  });
}

test('Films Monde versioned genre posters and backdrops stay in Oracle disk cache', async () => {
  const prefix = 'https://nuvio.example';
  const paths = [
    '/movies/artwork/genre/action.webp?v=movies-premium-20261025-v2',
    '/movies/artwork/backdrop/action.jpg?v=movies-premium-20261025-v2',
    '/movies/cover.jpg?v=movies-premium-20261025-v2',
    '/movies/backdrop.jpg?v=movies-premium-20261025-v2'
  ];
  for (const path of paths) assert.equal(edgeTtl(prefix + path), 604800, path);
  for (const path of [
    '/movies/artwork/genre/action.webp',
    '/movies/catalog/movie/movies-fr-all-action-today.json',
    '/movies/meta/movie/tt123.json',
    '/movies/manifest.json',
    '/movies/status.json',
    '/movies/artwork/genre/action.webp?v=%3Cbad%3E'
  ]) assert.equal(edgeTtl(prefix + path), 0, 'Dynamic or unversioned URL must not be cached: ' + path);

  const image = await directRequest('/movies/artwork/genre/action.webp?v=movies-premium-20261025-v2');
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/webp');
  assert.equal(image.bytes.toString('ascii', 0, 4), 'RIFF');
  const metadata = await sharp(image.bytes).metadata();
  assert(metadata.width > 0 && metadata.height > 0);
});

test('Films Monde rows use one compact landscape thumbnail without altering titles or period data', () => {
  const origin = 'https://nuvio.example/fr';
  const photo = 'https://image.tmdb.org/t/p/w500/film123.jpg';
  const decorated = {
    poster: photo, background: origin + '/calendar-card.svg?src=' + encodeURIComponent(photo) + '&title=Example',
    landscapePoster: photo,
    banner: origin + '/desktop-content-card.jpg?src=' + encodeURIComponent(photo),
    releaseInfo: '31 OCT 2026 • CINÉMA FRANCE'
  };
  const meta = { name: 'Exemple', type: 'movie', poster: photo, background: photo };
  const result = fastContentCards(origin, meta, { ...decorated });
  const uri = new URL(result.poster);
  assert.equal(uri.searchParams.get('world'), '1');
  assert.equal(uri.searchParams.get('layout'), 'landscape');
  assert.equal(uri.searchParams.get('v'), REVISION);
  assert.equal(uri.searchParams.get('title'), 'Example');
  assert.equal(uri.searchParams.get('fallback'), photo);
  assert.equal(result.poster, result.background);
  assert.equal(result.poster, result.landscapePoster);
  assert.equal(new URL(result.banner).searchParams.get('fast'), '1');
  assert.equal(new URL(result.banner).searchParams.get('v'), REVISION);
});

test('Films Monde render has smaller pixels and bytes without affecting default French calendar renderer', async () => {
  const base = '/fr/calendar-card.jpg?layout=landscape&type=movie&title=Film%20monde&provider=CINEMA&append=31%20OCT%202026';
  const [regular, world] = await Promise.all([
    directRequest(base + '&v=filmworld-test-regular'),
    directRequest(base + '&world=1&v=filmworld-test-compact')
  ]);
  assert.equal(regular.status, 200);
  assert.equal(world.status, 200);
  assert.equal(regular.headers.get('content-type'), 'image/jpeg');
  assert.equal(world.headers.get('content-type'), 'image/jpeg');
  const [originalInfo, compactInfo] = await Promise.all([
    sharp(regular.bytes).metadata(), sharp(world.bytes).metadata()
  ]);
  assert.deepEqual([originalInfo.width, originalInfo.height], [960, 540]);
  assert.deepEqual([compactInfo.width, compactInfo.height], [896, 504]);
  assert(world.bytes.length < regular.bytes.length,
    'Films Monde JPEG should transfer fewer bytes than the default equivalent');

  const portrait = await directRequest('/fr/calendar-card.jpg?layout=portrait&type=movie&world=1&title=Portrait');
  const portraitInfo = await sharp(portrait.bytes).metadata();
  assert.deepEqual([portraitInfo.width, portraitInfo.height], [500, 750],
    'Portrait and non-Films Monde cards keep existing quality');
});
