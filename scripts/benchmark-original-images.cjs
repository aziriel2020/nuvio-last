#!/usr/bin/env node
'use strict';
// Production gate for native artwork. Older versions required the Oracle JPEG
// relay, which is intentionally bypassed by Films Mondiaux V4.
const assert = require('node:assert/strict');
const sharp = require('sharp');
const origin = process.env.ARTWORK_BENCHMARK_ORIGIN || 'http://127.0.0.1:3000';
const provider = /^https:\/\/(?:image\.tmdb\.org|artworks\.thetvdb\.com)\//i;
const forbidden = /\/(?:images\/original\.(?:jpg|png)|(?:calendar-card|desktop-content-card|content-card|shield-content-card)\.jpg)(?:[?#]|$)/i;

async function json(path) {
  const response = await fetch(origin + path, { signal: AbortSignal.timeout(30000) });
  assert(response.ok, path + ' HTTP ' + response.status);
  return response.json();
}
function verifyMovieArt(meta, label) {
  for (const key of ['poster', 'background', 'landscapePoster', 'banner', 'logo']) {
    const value = meta?.[key];
    if (typeof value === 'string') assert(!forbidden.test(value), label + ' still uses the JPEG relay for ' + key);
  }
  for (const video of meta?.videos || []) {
    if (typeof video.thumbnail === 'string') assert(!forbidden.test(video.thumbnail), label + ' video thumbnail uses the JPEG relay');
  }
  assert(provider.test(meta?.poster || ''), label + ' poster is not a direct TMDB/TVDB URL');
}
async function main() {
  const canonical = await json('/movies/catalog/movie/movies-fr-streaming-all-all.json');
  const bridge = await json('/movies/native-bridge/catalog/movie/movies-fr-streaming-all-all.json');
  assert(canonical.metas?.length >= 2 && bridge.metas?.length >= 2, 'Movies World sample catalogue is empty');
  assert.deepEqual(canonical.metas.slice(0, 2).map(m => m.id), bridge.metas.slice(0, 2).map(m => m.id),
    'Native Bridge changed catalogue ordering or IDs');
  const sources = [];
  for (let i = 0; i < 2; i++) {
    const entry = canonical.metas[i];
    verifyMovieArt(entry, 'canonical film ' + entry.id);
    verifyMovieArt(bridge.metas[i], 'native bridge film ' + entry.id);
    const detail = (await json('/movies/meta/' + entry.type + '/' + encodeURIComponent(entry.id) + '.json')).meta;
    verifyMovieArt(detail, 'film detail ' + entry.id);
    sources.push(entry.poster, detail.poster);
    if (provider.test(detail.background || '')) sources.push(detail.background);
  }

  // Series are deliberately not migrated by this film-specific change.
  const series = await json('/series-v2/catalog/series/series-fr-premieres-all-all.json');
  assert(series.metas?.length > 0, 'Previously approved series catalogue disappeared');
  const sample = series.metas[0];
  const seriesDetail = (await json('/series-v2/meta/' + sample.type + '/' + encodeURIComponent(sample.id) + '.json')).meta;
  assert(seriesDetail && seriesDetail.id === sample.id, 'Series metadata lookup regressed');

  // Validate real, untranscoded original bytes from the provider, not Oracle JPEG copies.
  const urls = [...new Set(sources)].filter(url => provider.test(url)).slice(0, 3);
  assert(urls.length >= 2, 'Missing native movie images to benchmark');
  for (const pass of ['first', 'repeat']) {
    const results = [];
    for (const url of urls) {
      const started = performance.now();
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      assert(response.ok, 'Native provider image HTTP ' + response.status);
      const bytes = Buffer.from(await response.arrayBuffer());
      const info = await sharp(bytes).metadata();
      assert(info.width > 0 && info.height > 0, 'Invalid native provider image dimensions');
      results.push({ ms: Math.round(performance.now() - started), bytes: bytes.length });
    }
    console.log(JSON.stringify({ event: 'native-artwork-benchmark', pass, photos: results.length,
      maxMs: Math.max(...results.map(r => r.ms)), bytes: results.reduce((n, r) => n + r.bytes, 0),
      oracleJpegRelay: false, seriesMetadataPreserved: true }));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
