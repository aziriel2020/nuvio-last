#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const sharp = require('sharp');
const origin = process.env.ARTWORK_BENCHMARK_ORIGIN || 'http://127.0.0.1:3000';
async function main() {
  const urls = [];
  for (const path of ['/movies/catalog/movie/movies-fr-all-all-today.json', '/series-v2/catalog/series/series-fr-premieres-all-' + new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit' }).format(new Date()) + '.json']) {
    const response = await fetch(origin + path, { signal: AbortSignal.timeout(20000) });
    assert(response.ok, 'Catalog HTTP ' + response.status); const data = await response.json();
    for (const meta of data.metas.slice(0, path.startsWith('/movies') ? 6 : 12)) for (const field of ['background', 'banner']) {
      if (!meta[field]) continue;
      const url = new URL(meta[field]);
      // Films Monde collection posters intentionally use the smaller 896x504
      // profile; all standard calendar and series thumbnails remain 960x540.
      // Other image variants must not silently weaken the production guard.
      const worldMovie = url.pathname.endsWith('/calendar-card.jpg')
        && url.searchParams.get('world') === '1'
        && url.searchParams.get('type') === 'movie'
        && url.searchParams.get('layout') === 'landscape';
      urls.push({ field, worldMovie, url: origin + url.pathname + url.search });
    }
  }
  assert(urls.length > 0, 'No artwork available for the live test');
  for (const pass of ['first', 'repeat']) {
    let cursor = 0; const samples = [];
    await Promise.all(Array.from({ length: 8 }, async () => {
      for (;;) {
        const i = cursor++; if (i >= urls.length) return;
        const start = performance.now(), response = await fetch(urls[i].url, { signal: AbortSignal.timeout(20000) });
        const data = Buffer.from(await response.arrayBuffer());
        const ms = Math.round(performance.now() - start);
        assert.equal(response.status, 200, 'Artwork response');
        assert.match(response.headers.get('content-type'), /^image\/jpeg/, 'Native cards must be JPEG');
        const info = await sharp(data).metadata();
        assert.equal(info.width, urls[i].worldMovie ? 896 : 960,
          'Unexpected artwork width for ' + (urls[i].worldMovie ? 'Films Monde' : 'standard'));
        assert.equal(info.height, urls[i].worldMovie ? 504 : 540,
          'Unexpected artwork height for ' + (urls[i].worldMovie ? 'Films Monde' : 'standard'));
        samples.push({ ms, bytes: data.length, cache: response.headers.get('x-nuvio-cache'), photo: response.headers.get('x-nuvio-artwork-photo') });
      }
    }));
    const times = samples.map((v) => v.ms).sort((a, b) => a - b);
    console.log(JSON.stringify({ event: 'artwork-benchmark', pass, count: samples.length,
      medianMs: times[Math.floor(times.length / 2)], p95Ms: times[Math.floor(times.length * .95)], maxMs: times.at(-1),
      bytes: samples.reduce((n, v) => n + v.bytes, 0), hits: samples.filter((v) => v.cache === 'HIT').length,
      photoFallbacks: samples.filter((v) => v.photo === 'fallback').length }));
    if (pass === 'first') await new Promise((r) => setTimeout(r, 300));
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
