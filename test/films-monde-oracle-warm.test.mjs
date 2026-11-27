import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { catalogPaths, run } from '../scripts/warm-films-monde-artwork.mjs';

const root = resolve(import.meta.dirname, '..');
const now = new Date('2026-11-01T11:00:00Z');

test('warmer covers current catalog profiles and rotates existing genre, date and annual routes', () => {
  const first = catalogPaths(now, 0);
  assert(first.includes('/movies/catalog/movie/movies-fr-cinema-all-2026-11.json'));
  assert(first.includes('/movies/native-bridge/catalog/movie/movies-fr-all-all-2026-11.json'));
  assert(first.includes('/movies/native-bridge/mobile/catalog/movie/movies-fr-all-all-2026-11.json'));
  assert(first.includes('/movies/mobile-desktop-collections/catalog/movie/movies-fr-all-all-2026-11.json'));
  assert(first.includes('/movies/catalog/movie/movies-fr-all-all-annual-2025.json'));
  assert(first.includes('/movies/catalog/movie/movies-fr-all-all-today.json'));
  assert(first.length <= 14);
  assert.notDeepEqual(first, catalogPaths(now, 1));
});

test('warmer takes film IDs from catalogs and primes the actual V4 URL on Oracle', async () => {
  const requested = [];
  const posters = [];
  let active = 0;
  let maxActive = 0;
  const metas = [
    { id: 'tt1234567', type: 'movie', poster: 'https://image.tmdb.org/t/p/w780/example.jpg' },
    { id: 'tmdb:movie:456', type: 'movie', poster: 'https://image.tmdb.org/t/p/w500/portrait.jpg' },
    { id: 'tt7654321', type: 'series', poster: 'https://image.tmdb.org/t/p/w500/series.jpg' },
    { id: 'tt7654321', type: 'movie' },
    { id: '../../foreign', type: 'movie', poster: 'https://example.com/foreign.jpg' }
  ];
  const fetcher = async (url, options) => {
    const u = new URL(url);
    assert.equal(u.origin, 'http://127.0.0.1:3000');
    assert.equal(options.redirect, 'error');
    requested.push(u.pathname);
    const headers = { 'x-nuvio-origin': 'oracle-vm' };
    if (u.pathname === '/_oracle/health') {
      return Response.json({ ok: true, runtime: 'oracle-vm' }, { headers });
    }
    if (u.pathname.startsWith('/movies/')) return Response.json({ metas }, { headers });
    posters.push(u.pathname + u.search);
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    return new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml', 'x-nuvio-cache': 'HIT' } });
  };
  const result = await run({ now, iteration: 0, fetcher });
  assert.deepEqual(requested.slice(1, -2), catalogPaths(now, 0));
  assert.deepEqual(posters, [
    '/design-meta/art/movie/tt1234567/landscape.svg?v=oracle-vector-v4-film-details',
    '/design-meta/art/movie/tmdb:movie:456/landscape.svg?v=oracle-vector-v4-film-details'
  ]);
  assert.equal(maxActive, 2);
  assert.equal(result.finished, 2);
  assert.equal(result.hits, 2);
});

test('warmer is bounded and starts after runtime health, with shutdown on rollback', () => {
  const service = readFileSync(resolve(root, 'oracle/nuvio-movies-warm.service'), 'utf8');
  const timer = readFileSync(resolve(root, 'oracle/nuvio-movies-warm.timer'), 'utf8');
  const updater = readFileSync(resolve(root, 'oracle/update.sh'), 'utf8');
  assert.match(service, /CPUQuota=15%/);
  assert.match(service, /MemoryMax=192M/);
  assert.match(service, /scripts\/warm-films-monde-artwork\.mjs/);
  assert.match(timer, /OnUnitActiveSec=4min/);
  assert.match(updater, /systemctl stop nuvio-movies-warm.timer nuvio-movies-warm.service/);
  assert.match(updater, /systemctl disable nuvio-movies-warm.timer/);
  assert.match(updater, /systemctl enable --now nuvio-movies-warm.timer/);
});
