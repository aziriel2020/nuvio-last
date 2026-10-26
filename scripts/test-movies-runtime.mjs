#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import sharp from 'sharp';
const require = createRequire(import.meta.url);
const { MovieStore } = require('../regions/movies/src/store.cjs');
const { fromTmdb } = require('../regions/movies/src/model.cjs');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nuvio-movies-http-'));
const port = process.env.MOVIES_TEST_PORT || '3329', origin = `http://127.0.0.1:${port}`;
const filename = path.join(temp, 'movies.sqlite');
const store = new MovieStore(filename);
const fixture = (id, extra = {}) => fromTmdb({ id, title: `Film HTTP ${id}`, genres: [{ id: 18 }],
  poster_path: '/portrait.jpg', backdrop_path: '/backdrop.jpg', release_date: '2026-10-24',
  release_dates: { results: [{ iso_3166_1: 'FR', release_dates: [{ type: 3, release_date: '2026-10-24T00:00:00Z' }] }] },
  'watch/providers': { results: { FR: { flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] } } }, ...extra });
for (let id = 1; id <= 205; id++) store.upsert(fixture(id));
store.upsert(fixture(999, { genres: [{ id: 16 }] }));
store.upsert(fixture(998, { 'watch/providers': { results: { US: { flatrate: [{ provider_id: 8, provider_name: 'US only' }] } } }, release_dates: { results: [] } }));
const env = { ...process.env, PUBLIC_ORIGIN: origin, PORT: port, HOST: '127.0.0.1', NUVIO_MOVIES_DB: filename,
  NUVIO_CACHE_DIR: path.join(temp, 'cache'), NUVIO_NOW_OVERRIDE: '2026-10-25T10:00:00Z' };
execFileSync(process.execPath, ['scripts/build-runtime.js'], { env, stdio: 'pipe' });
const child = spawn(process.execPath, ['oracle/server.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
child.stdout.on('data', (b) => { logs += b; }); child.stderr.on('data', (b) => { logs += b; });
async function get(route) { return fetch(origin + route, { signal: AbortSignal.timeout(15000) }); }
try {
  let ready = false;
  for (let n = 0; n < 40; n++) {
    try { if ((await get('/_oracle/health')).ok) { ready = true; break; } } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  assert(ready, logs);
  const install = await (await get('/install.json')).json();
  assert.equal(install.moviesManifest, origin + '/movies/manifest.json');
  const response = await get('/movies/manifest.json'); assert.equal(response.headers.get('cache-control'), 'no-store');
  const manifest = await response.json(); assert.equal(manifest.id, install.moviesAddonId);
  const names = new Map(manifest.catalogs.map((c) => [c.id, c.name]));
  assert.equal(names.get('movies-fr-cinema-all-today'), 'Aujourd’hui');
  for (const mode of ['', '-desktop']) {
    const imported = await (await get(`/movies/nuvio-collections${mode}.json`)).json();
    assert.equal(imported.length, 4);
    for (const c of imported) for (const f of c.folders) for (const s of f.sources) { assert.equal(s.addonId, manifest.id); assert(names.has(s.catalogId)); }
  }
  const ids = [];
  for (const skip of [0, 100, 200]) {
    const r = await get(`/movies/catalog/movie/movies-fr-all-all-all/skip=${skip}.json`);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const data = await r.json(); ids.push(...data.metas.map((m) => m.id));
    assert(data.metas.every((m) => m.posterShape === 'landscape' && new URL(m.background).pathname === '/fr/calendar-card.jpg'));
  }
  assert.equal(ids.length, 205); assert.equal(new Set(ids).size, 205);
  assert.equal((await get('/movies/meta/movie/tmdb%3Amovie%3A998.json')).status, 404);
  assert.equal((await get('/movies/meta/movie/tmdb%3Amovie%3A999.json')).status, 404);
  const detail = await (await get('/movies/meta/movie/tmdb%3Amovie%3A1.json')).json();
  assert.equal(new URL(detail.meta.background).pathname, '/images/original.jpg');
  assert.equal(new URL(detail.meta.background).searchParams.get('src'), 'https://image.tmdb.org/t/p/w1280/backdrop.jpg');
  store.upsert(fixture(1, { genres: [{ id: 16 }] }));
  const refreshed = await (await get('/movies/catalog/movie/movies-fr-all-all-all/search=Film%20HTTP%201.json')).json();
  assert(!refreshed.metas.some((m) => m.id === 'tmdb:movie:1'));
  for (const id of ['all', '36', '10770', '10752']) {
    const image = await get(`/movies/artwork/genre/${id}.webp`); assert.equal(image.status, 200);
    const meta = await sharp(Buffer.from(await image.arrayBuffer())).metadata();
    assert.equal(meta.width, 1600); assert.equal(meta.height, 900);
  }
  const fallback = await get('/movies/content-card.jpg?title=Film%20sans%20photo&label=VOD');
  assert.equal((await sharp(Buffer.from(await fallback.arrayBuffer())).metadata()).width, 1600);
  const status = await (await get('/movies/status.json')).json(); assert.equal(status.eligible, 204); assert(status.genreArtwork.ready);
  const replay = { results: { FR: { free: [{provider_id:1967,provider_name:'Molotov TV'}] } } };
  store.upsert(fixture(2001,{title:'Cleanup replay fiction',release_dates:{results:[]},'watch/providers':replay}));
  store.upsert(fixture(2002,{title:'Cleanup replay documentary',genres:[{id:99}],release_dates:{results:[]},'watch/providers':replay}));
  const clean = await (await get('/movies/catalog/movie/movies-fr-streaming-all-2026-10/search=Cleanup.json')).json();
  assert.equal(clean.metas.length,0);
  const docs = await (await get('/movies/catalog/movie/movies-fr-streaming-99-2026-10/search=Cleanup.json')).json();
  assert.equal(docs.metas.length,1);assert.equal(docs.metas[0].name,'Cleanup replay documentary');
  store.upsert(fixture(1980,{title:'Original 1980 reissue 2026',genres:[{id:37}],release_date:'1980-05-01',
    'watch/providers':{results:{FR:{flatrate:[{provider_id:8,provider_name:'Netflix'}],rent:[{provider_id:10,provider_name:'Amazon Video'}]}}},
    release_dates:{results:[{iso_3166_1:'FR',release_dates:[{type:3,release_date:'2026-10-24'},{type:4,release_date:'2026-10-24'}]}]}}));
  for(const view of ['all','streaming','vod','cinema']) {
    const reissued=await (await get(`/movies/catalog/movie/movies-fr-${view}-37-2026-10/search=Original.json`)).json();
    assert.equal(reissued.metas.length,0,view+' excludes a 2026 reissue from the 2026 calendar');
    const original=await (await get(`/movies/catalog/movie/movies-fr-${view}-37-1980/search=Original.json`)).json();
    assert.equal(original.metas.length,1);assert.equal(original.metas[0].released.slice(0,10),'1980-05-01');
  }
  for(const mode of ['', '-desktop']) {
    const imported=await (await get(`/movies/nuvio-collections${mode}.json`)).json();
    assert(imported.every(c=>c.folders.every(f=>!f.id.endsWith('-unclassified'))));
  }
  assert.equal(status.datePolicy,'first-release-worldwide');
  console.log('Films Monde Oracle HTTP passed: 4 collections, named sources, 205 paginated movies, FR gates, live animation correction, raw detail art and custom 16:9 covers.');
} finally {
  child.kill('SIGTERM'); await new Promise((r) => child.once('exit', r));
  store.close(); fs.rmSync(temp, { recursive: true, force: true });
}
