#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { imageUrl } = require('../regions/fr/api/original-images.cjs');
const origin = process.env.ARTWORK_BENCHMARK_ORIGIN || 'http://127.0.0.1:3000';
async function json(path) {
  const response = await fetch(origin + path, { signal: AbortSignal.timeout(30000) });
  assert(response.ok, `${path} HTTP ${response.status}`); return response.json();
}
async function main() {
  const samples = [];
  for (const [base, catalog, count] of [
    ['movies', '/movies/catalog/movie/movies-fr-streaming-all-all.json', 2],
    ['series-v2', '/series-v2/catalog/series/series-fr-premieres-all-all.json', 1]
  ]) {
    const data = await json(catalog);
    for (const movie of data.metas.slice(0, count)) {
      const meta = (await json(`/${base}/meta/${movie.type}/${encodeURIComponent(movie.id)}.json`)).meta;
      for (const field of ['poster', 'background', 'logo']) if (meta[field]) samples.push(meta[field]);
      for (const video of (meta.videos || []).filter((v) => v.thumbnail).slice(0, 2)) samples.push(video.thumbnail);
    }
  }
  // An independent TVmaze photo verifies the second original-image CDN as well.
  try {
    const maze = await (await fetch('https://api.tvmaze.com/shows/1', { signal: AbortSignal.timeout(10000) })).json();
    if (maze.image?.original) samples.push(imageUrl(origin, maze.image.original, 'poster'));
  } catch { console.log(JSON.stringify({ event: 'original-images-directory', tvmaze: 'temporarily-unavailable' })); }
  const urls = [...new Set(samples)].filter((value) => new URL(value).pathname.startsWith('/images/original.'));
  assert(urls.length >= 4, 'Original poster/background metadata did not use the relay');
  for (const pass of ['first', 'repeat']) {
    let cursor = 0; const results = [];
    await Promise.all(Array.from({ length: 6 }, async () => {
      for (;;) {
        const i = cursor++; if (i >= urls.length) return;
        const url = new URL(urls[i]), started = performance.now();
        const response = await fetch(origin + url.pathname + url.search, { signal: AbortSignal.timeout(20000) });
        assert.equal(response.status, 200, 'Original image failed');
        assert.equal(response.headers.get('x-nuvio-original-image'), 'original-images-v1');
        const bytes = Buffer.from(await response.arrayBuffer()), info = await sharp(bytes).metadata();
        assert(info.width > 0 && info.height > 0); assert(info.width <= (url.searchParams.get('role') === 'background' ? 1280 : 780));
        results.push({ ms: Math.round(performance.now() - started), bytes: bytes.length,
          host: response.headers.get('x-nuvio-image-source'), hit: response.headers.get('x-nuvio-cache') === 'HIT' });
      }
    }));
    console.log(JSON.stringify({ event: 'original-images-benchmark', pass, count: results.length,
      hosts: [...new Set(results.map((r) => r.host))], hits: results.filter((r) => r.hit).length,
      maxMs: Math.max(...results.map((r) => r.ms)), bytes: results.reduce((n, r) => n + r.bytes, 0) }));
    await new Promise((r) => setTimeout(r, 300));
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
