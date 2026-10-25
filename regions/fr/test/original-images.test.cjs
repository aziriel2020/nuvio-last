'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { relayMediaImages, imageUrl, handleOriginalImage } = require('../api/original-images.cjs');
const { createArtworkCache } = require('../api/artwork-cache.cjs');

async function call(src, role = 'poster', fallback) {
  const out = { headers: {} };
  await handleOriginalImage({}, { set statusCode(v) { out.status = v; },
    setHeader(k, v) { out.headers[k.toLowerCase()] = v; }, end(v) { out.body = v; } },
  new URL(imageUrl('https://nuvio.example', src, role, fallback)));
  return out;
}

test('all original metadata artwork, including episode thumbnails, uses the relay without changing native cards or links', () => {
  const raw = { meta: { id: 'tt1', poster: 'https://image.tmdb.org/t/p/w500/p.jpg',
    background: 'https://image.tmdb.org/t/p/w1280/b.jpg', logo: 'https://image.tmdb.org/t/p/original/l.png',
    banner: 'https://nuvio.example/fr/desktop-content-card.jpg?v=approved',
    videos: [{ id: 'tt1:1:1', thumbnail: 'https://static.tvmaze.com/uploads/images/original_untouched/1/2.jpg' }],
    links: [{ url: 'https://www.themoviedb.org/movie/1' }] } };
  const relayed = relayMediaImages(raw, 'https://nuvio.example');
  for (const key of ['poster', 'background', 'logo']) assert.match(relayed.meta[key], /^https:\/\/nuvio.example\/images\/original\./);
  assert.equal(new URL(relayed.meta.poster).searchParams.get('src'), raw.meta.poster);
  assert.match(relayed.meta.videos[0].thumbnail, /\/images\/original\.jpg/);
  assert.equal(relayed.meta.banner, raw.meta.banner); assert.deepEqual(relayed.meta.links, raw.meta.links);
  assert.deepEqual(relayMediaImages(relayed, 'https://nuvio.example'), relayed);
  assert.equal(raw.meta.poster, 'https://image.tmdb.org/t/p/w500/p.jpg');
});

test('a correctly sized TMDB poster is returned byte-for-byte, without titles or cropping', async (t) => {
  const original = await sharp({ create: { width: 100, height: 150, channels: 3, background: '#927d50' } }).jpeg().toBuffer();
  t.mock.method(global, 'fetch', async () => new Response(original, { headers: { 'content-type': 'image/jpeg' } }));
  const result = await call('https://image.tmdb.org/t/p/w500/original-poster.jpg');
  assert.equal(result.status, 200); assert.deepEqual(result.body, original);
  const info = await sharp(result.body).metadata(); assert.equal(info.width, 100); assert.equal(info.height, 150);
  assert.equal(result.headers['x-nuvio-image-source'], 'image.tmdb.org');
});

test('original logos preserve transparency when normalized from SVG references to TMDB PNG', async (t) => {
  const original = await sharp({ create: { width: 120, height: 40, channels: 4, background: '#ffffff00' } }).png().toBuffer();
  let requested;
  t.mock.method(global, 'fetch', async (url) => { requested = String(url); return new Response(original, { headers: { 'content-type': 'image/png' } }); });
  const result = await call('https://image.tmdb.org/t/p/original/transparent-logo.svg', 'logo');
  assert.equal(requested, 'https://image.tmdb.org/t/p/w500/transparent-logo.png');
  assert.equal(result.status, 200); assert.equal(result.headers['content-type'], 'image/png');
  assert.equal((await sharp(result.body).metadata()).hasAlpha, true);
});

test('a transient CDN error is retried and a missing poster can use another photo of that title', async (t) => {
  const original = await sharp({ create: { width: 100, height: 150, channels: 3, background: '#804010' } }).jpeg().toBuffer();
  let retryCalls = 0;
  t.mock.method(global, 'fetch', async (url) => {
    if (String(url).includes('missing-photo')) return new Response('', { status: 404 });
    if (String(url).includes('retry-photo') && retryCalls++ === 0) return new Response('', { status: 503 });
    return new Response(original, { headers: { 'content-type': 'image/jpeg' } });
  });
  assert.equal((await call('https://image.tmdb.org/t/p/w500/retry-photo.jpg')).status, 200); assert.equal(retryCalls, 2);
  assert.equal((await call('https://image.tmdb.org/t/p/w500/missing-photo.jpg', 'poster', 'https://image.tmdb.org/t/p/w1280/other-photo.jpg')).status, 200);
});

test('unavailable originals stay uncached and redirects cannot leave image hosts', async (t) => {
  const seen = [];
  const cache = createArtworkCache({ disk: () => null, fetcher: async (url) => {
    seen.push(url); return new Response('', { status: 302, headers: { location: 'http://127.0.0.1/private' } });
  } });
  await assert.rejects(cache.photo('https://image.tmdb.org/t/p/w500/redirect.jpg'));
  assert.deepEqual(seen, ['https://image.tmdb.org/t/p/w500/redirect.jpg']);
  await assert.rejects(cache.photo('https://image.tmdb.org:8443/private.jpg')); assert.equal(seen.length, 1);
  t.mock.method(global, 'fetch', async () => new Response('', { status: 404 }));
  const result = await call('https://image.tmdb.org/t/p/w500/permanently-missing.jpg');
  assert.equal(result.status, 503); assert.equal(result.headers['cache-control'], 'no-store');
});
