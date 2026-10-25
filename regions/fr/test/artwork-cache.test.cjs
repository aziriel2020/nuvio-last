'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { ByteCache, createArtworkCache } = require('../api/artwork-cache.cjs');
const handler = require('../api/index.js');
const photo = () => fs.readFileSync(path.resolve(__dirname, '../../../assets/genre-art/shared/drama-card.jpg'));
const response = () => new Response(photo(), { headers: { 'content-type': 'image/jpeg' } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('photo cache shares concurrent downloads and reuses persisted photos in a fresh worker', async () => {
  let fetched = 0; const persisted = new Map();
  const disk = () => ({ match: async (r) => persisted.get(r.url)?.clone(), put: async (r, v) => { persisted.set(r.url, v.clone()); } });
  const fetcher = async () => { fetched++; await sleep(10); return response(); };
  const first = createArtworkCache({ fetcher, disk });
  const all = await Promise.all(Array.from({ length: 20 }, () => first.photo('https://image.tmdb.org/t/p/w780/shared.jpg')));
  assert.equal(fetched, 1); assert(all.every((r) => r.bytes.equals(all[0].bytes)));
  await createArtworkCache({ fetcher, disk }).photo('https://image.tmdb.org/t/p/w780/shared.jpg');
  assert.equal(fetched, 1);
});

test('temporary errors and corrupt images are retried, never cached as successful photos', async () => {
  let calls = 0;
  const cache = createArtworkCache({ disk: () => null, fetcher: async () => {
    calls++; if (calls === 1) return new Response('outage', { status: 503 });
    if (calls === 2) return new Response('not a bitmap', { headers: { 'content-type': 'image/jpeg' } });
    return response();
  } });
  const src = 'https://image.tmdb.org/t/p/w780/retry.jpg';
  await assert.rejects(cache.photo(src)); await assert.rejects(cache.photo(src));
  assert((await cache.photo(src)).bytes.length); await cache.photo(src); assert.equal(calls, 3);
});

test('render bursts are bounded and duplicate renders share one result', async () => {
  const cache = createArtworkCache({ concurrency: 3 }); let active = 0, max = 0, calls = 0;
  const work = () => cache.raster(async () => { calls++; active++; max = Math.max(max, active); await sleep(10); active--; return { data: Buffer.alloc(100) }; });
  await Promise.all(Array.from({ length: 30 }, (_, i) => cache.render(String(i % 10), work)));
  assert.equal(calls, 10); assert.equal(max, 3);
  await cache.render('0', work); assert.equal(calls, 10);
  let failures = 0;
  await cache.render('transient', async () => ({ data: Buffer.alloc(10), cacheable: false, retry: ++failures }));
  const again = await cache.render('transient', async () => ({ data: Buffer.alloc(10), retry: ++failures }));
  assert.equal(again.retry, 2);
});

test('memory cache evicts by byte budget and preserves the recently used entry', () => {
  const cache = new ByteCache(10, 5);
  cache.put('a', 'a', 5, 10000); cache.put('b', 'b', 5, 10000);
  cache.get('a'); cache.put('c', 'c', 5, 10000);
  assert.equal(cache.get('b'), null); assert.equal(cache.get('a'), 'a'); assert.equal(cache.bytes, 10);
});

async function call(route) {
  const out = { headers: {} };
  await handler({ method: 'GET', url: route, headers: { host: 'test.example' } }, {
    set statusCode(v) { out.status = v; }, get statusCode() { return out.status; },
    setHeader(k, v) { out.headers[k.toLowerCase()] = v; }, getHeader(k) { return out.headers[k.toLowerCase()]; },
    end(body) { out.body = body; }
  });
  return out;
}

test('Shield JPEG keeps photography/title/date and is smaller than the embedded SVG', async (t) => {
  t.mock.method(global, 'fetch', async () => response());
  const args = new URLSearchParams({ src: 'https://image.tmdb.org/t/p/w780/light-card.jpg', layout: 'landscape',
    title: 'Le grand voyage', provider: 'Netflix', append: 'DIM 25 OCT', type: 'movie' });
  const jpeg = await call('/calendar-card.jpg?' + args), svg = await call('/calendar-card.svg?' + args);
  assert.equal(jpeg.status, 200); assert.equal(jpeg.headers['content-type'], 'image/jpeg');
  assert.equal(jpeg.headers['x-nuvio-artwork-photo'], 'ready');
  const metadata = await sharp(jpeg.body).metadata(); assert.equal(metadata.width, 960); assert.equal(metadata.height, 540);
  assert(jpeg.body.length < Buffer.byteLength(svg.body) * .7, 'thumbnail should materially reduce transfer size');
  assert.match(svg.body, /Le grand voyage/); assert.match(svg.body, /DIM 25 OCT/);
  fs.writeFileSync('/tmp/nuvio-fast-card-preview.jpg', jpeg.body);
});

test('a transient missing photo returns an uncached title card and can recover on the same URL', async (t) => {
  let up = false;
  t.mock.method(global, 'fetch', async () => up ? response() : new Response('unavailable', { status: 503 }));
  const route = '/calendar-card.jpg?' + new URLSearchParams({ src: 'https://image.tmdb.org/t/p/w780/outage-card.jpg',
    layout: 'landscape', title: 'Toujours lisible', type: 'series' });
  const missing = await call(route);
  assert.equal(missing.status, 200); assert.equal(missing.headers['cache-control'], 'no-store');
  assert.equal(missing.headers['x-nuvio-artwork-photo'], 'fallback');
  assert.equal((await sharp(missing.body).metadata()).width, 960);
  up = true;
  const recovered = await call(route); assert.equal(recovered.headers['x-nuvio-artwork-photo'], 'ready');
  assert.notEqual(recovered.headers['cache-control'], 'no-store');
});

test('an unavailable backdrop can use the original poster and fast desktop output stays 16:9', async (t) => {
  t.mock.method(global, 'fetch', async (src) => String(src).includes('missing-backdrop') ? new Response('', { status: 404 }) : response());
  const args = new URLSearchParams({ src: 'https://image.tmdb.org/t/p/w780/missing-backdrop.jpg',
    fallback: 'https://image.tmdb.org/t/p/w500/poster-backup.jpg', layout: 'landscape', title: 'Plan B', label: 'Netflix', type: 'series', fast: '1' });
  for (const route of ['/calendar-card.jpg?', '/desktop-content-card.jpg?']) {
    const result = await call(route + args); assert.equal(result.status, 200);
    assert.equal(result.headers['x-nuvio-artwork-photo'], 'ready');
    const metadata = await sharp(result.body).metadata(); assert.equal(metadata.width, 960); assert.equal(metadata.height, 540);
  }
});
