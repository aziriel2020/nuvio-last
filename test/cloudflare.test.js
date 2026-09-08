'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PUBLIC_ORIGIN = 'https://nuvio-edge-test.example';

function filesUnder(root) {
  const output = [];
  if (!fs.existsSync(root)) return output;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...filesUnder(absolute));
    else output.push(absolute);
  }
  return output;
}

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(DIST, relative), 'utf8'));
}

test('Cloudflare build emits the stable Nuvio surface as static assets', () => {
  execFileSync(process.execPath, ['scripts/build-cloudflare.js'], {
    cwd: ROOT,
    env: { ...process.env, PUBLIC_ORIGIN },
    stdio: 'pipe'
  });

  const allFiles = filesUnder(DIST);
  assert(allFiles.length > 20, 'expected generated files');
  assert(allFiles.length < 20000, `Cloudflare Pages static file limit exceeded: ${allFiles.length}`);

  for (const file of allFiles) {
    const size = fs.statSync(file).size;
    assert(size < 25 * 1024 * 1024, `${path.relative(DIST, file)} is larger than 25 MiB`);
  }

  const collections = readJson('nuvio-collections-fr-global-tr-usa.json');
  assert.equal(collections.length, 47);
  assert.equal(collections[0].title, '🇫🇷 Netflix');
  assert.equal(collections.at(-1).title, '🇺🇸 Genres · Séries');

  const desktop = readJson('nuvio-collections-desktop.json');
  assert.equal(desktop.length, 47);

  const install = readJson('install.json');
  assert.equal(install.combinedCollections, `${PUBLIC_ORIGIN}/nuvio-collections-fr-global-tr-usa.json`);
  assert.equal(install.franceManifest, `${PUBLIC_ORIGIN}/fr/manifest.json`);

  const expectedManifestIds = {
    fr: 'com.nuvio.calendar.archives.fr.coexist',
    global: 'com.nuvio.calendar.archives.global.coexist',
    tr: 'com.nuvio.calendar.archives.tr.coexist',
    us: 'com.nuvio.calendar.archives.us.coexist'
  };
  for (const [region, id] of Object.entries(expectedManifestIds)) {
    const manifest = readJson(`${region}/manifest.json`);
    assert.equal(manifest.id, id);
    assert(manifest.catalogs.length > 0);
  }

  const staticJsonFiles = allFiles.filter((file) => file.endsWith('.json') && !file.endsWith('edge-build.json') && !file.endsWith('_routes.json'));
  for (const file of staticJsonFiles) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /nuvio-last\.vercel\.app/, path.relative(DIST, file));
  }

  const combinedText = fs.readFileSync(path.join(DIST, 'nuvio-collections-fr-global-tr-usa.json'), 'utf8');
  assert.match(combinedText, /nuvio-edge-test\.example\/fr\//);
  assert.match(combinedText, /nuvio-edge-test\.example\/global\//);
  assert.match(combinedText, /nuvio-edge-test\.example\/tr\//);
  assert.match(combinedText, /nuvio-edge-test\.example\/us\//);

  const edgeBuild = readJson('edge-build.json');
  assert.equal(edgeBuild.runtime, 'cloudflare-native');
  assert.equal(edgeBuild.usesVercel, false);

  const workerBundle = fs.readFileSync(path.join(DIST, '_worker.js'), 'utf8');
  assert.doesNotMatch(workerBundle, /nuvio-last\.vercel\.app/i);
  assert.match(workerBundle, /cloudflare-native/);

  assert(fs.existsSync(path.join(DIST, '_worker.js')));
  assert(fs.existsSync(path.join(DIST, '_routes.json')));
  assert(fs.existsSync(path.join(DIST, '_headers')));
  assert(fs.existsSync(path.join(DIST, 'static', 'assets')));
});

test('Cloudflare routing excludes the large static JSON from Function invocations', () => {
  const routes = readJson('_routes.json');
  assert.deepEqual(routes.include, ['/*']);
  for (const route of [
    '/nuvio-collections-fr-global-tr-usa.json',
    '/nuvio-collections-desktop.json',
    '/fr/manifest.json',
    '/global/manifest.json',
    '/tr/manifest.json',
    '/us/manifest.json',
    '/static/*'
  ]) {
    assert(routes.exclude.includes(route), route);
  }
});

test('Cloudflare worker keeps dynamic data fresh and maps repository artwork locally', async () => {
  const workerUrl = pathToFileURL(path.join(ROOT, 'cloudflare', 'worker.mjs')).href;
  const worker = await import(workerUrl);

  assert.equal(worker.edgeTtl('https://edge.example/us/catalog/movie/archives-v3-movie-netflix-today.json'), 300);
  assert.equal(worker.edgeTtl('https://edge.example/fr/catalog/movie/archives-fr-v1-movie-netflix-2020-01.json'), 21600);
  assert.equal(worker.edgeTtl('https://edge.example/fr/calendar-card.svg?src=x'), 604800);
  assert.equal(worker.edgeTtl('https://edge.example/health'), 0);

  assert.equal(
    worker.localAssetPath('https://edge.example/fr/platform-card.jpg?provider=netflix'),
    '/static/assets/platform-art/fr/netflix-card.jpg'
  );
  assert.equal(
    worker.localAssetPath('https://edge.example/us/genre-backdrop.jpg?genre=action'),
    '/static/assets/genre-art/shared/action-backdrop.jpg'
  );
  assert.equal(
    worker.localAssetPath('https://edge.example/tr/genre-collection-art.jpg'),
    '/static/assets/collection-art/fr-genres-backdrop.jpg'
  );
  assert.equal(
    worker.localAssetPath('https://edge.example/fr/desktop-folder-card.jpg?provider=netflix&type=series'),
    '/static/assets/platform-art/fr/netflix-card.jpg'
  );
  assert.equal(
    worker.localAssetPath('https://edge.example/us/desktop-genre-card.jpg?genre=action&type=movie'),
    '/static/assets/genre-art/shared/action-card.jpg'
  );
  assert.equal(
    worker.localAssetPath('https://edge.example/fr/genre-poster.png?type=series&genre=action-adventure'),
    '/static/assets/genre-posters/action.png'
  );
  assert.equal(worker.localAssetPath('https://edge.example/fr/platform-card.jpg?provider=../bad'), null);

  const cardSvg = worker.desktopContentCardSvg(
    'https://edge.example/fr/desktop-content-card.jpg?title=WWE%20Raw&append=S33E12%20%E2%80%A2%20LUN%2008%20SEPT%20%E2%80%A2%20NETFLIX&label=Netflix&provider=netflix&type=series'
  );
  assert.match(cardSvg, /WWE Raw/);
  assert.match(cardSvg, /S33E12/);
  assert.match(cardSvg, /NETFLIX/);
  assert.match(cardSvg, /<svg/);
});

test('Cloudflare native adapter preserves public origin and viewer timezone for the shared engine', () => {
  const handler = require('../api/index');
  const req = {
    headers: {
      host: 'internal-origin.invalid',
      'x-forwarded-proto': 'https',
      'x-nuvio-public-origin': PUBLIC_ORIGIN
    }
  };
  assert.equal(handler._internals.originFromRequest(req), PUBLIC_ORIGIN);

  const us = handler._internals.usHandler._internals;
  const globalApi = handler._internals.globalHandler._internals;
  const tzReq = {
    headers: {
      'x-nuvio-timezone': 'Asia/Tokyo',
      'x-vercel-ip-timezone': 'America/New_York'
    }
  };
  assert.equal(us.requestTimeZone(tzReq), 'Asia/Tokyo');
  assert.equal(globalApi.requestTimeZone(tzReq), 'Asia/Tokyo');
});

test('desktop catalog cards always keep the metadata renderer, even without usable artwork', () => {
  const handler = require('../api/index');
  const fr = handler._internals.frHandler._internals;
  const [meta] = fr.decorateCatalogMetas(
    'https://edge.example/fr',
    [{
      id: 'tmdb:series:123',
      type: 'series',
      name: 'The Chosen',
      poster: null,
      background: null,
      landscapePoster: null,
      releaseInfo: 'S05E08',
      released: '2026-09-08',
      _calendarProvider: 'Netflix'
    }],
    {
      type: 'series',
      period: 'today',
      providerSlug: 'netflix',
      archiveProvider: 'netflix',
      cardProvider: 'Netflix',
      name: 'Netflix'
    },
    'Europe/Paris'
  );

  assert.match(meta.banner, /\/fr\/desktop-content-card\.jpg\?/);
  assert.match(meta.banner, /desktop11/);
  assert.match(meta.banner, /title=The(?:\+|%20)Chosen/);
  assert.match(meta.banner, /append=/);
  assert.match(meta.banner, /label=Netflix/);
});
