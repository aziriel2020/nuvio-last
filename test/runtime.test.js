'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const TEST_ORIGIN = 'https://oracle-runtime-test.example';
const FORBIDDEN_HOSTS = /pages\.dev|workers\.dev|vercel\.app|sslip\.io/i;

function filesUnder(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(absolute));
    else out.push(absolute);
  }
  return out;
}

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(DIST, rel), 'utf8'));
}

function flattenStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => flattenStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => flattenStrings(v, out));
  return out;
}

test('runtime build emits every Nuvio JSON surface with one supplied public origin', () => {
  execFileSync(process.execPath, ['scripts/build-runtime.js'], {
    cwd: ROOT,
    env: { ...process.env, PUBLIC_ORIGIN: TEST_ORIGIN, NUVIO_RUNTIME: 'oracle-vm' },
    stdio: 'pipe'
  });

  const combined = readJson('nuvio-collections-fr-global-tr-usa.json');
  const desktop = readJson('nuvio-collections-desktop.json');
  const report = readJson('coexistence-check.json');
  const tr = readJson('nuvio-collections-tr.json');

  assert(Array.isArray(combined) && combined.length > 0, 'combined collections must not be empty');
  assert.equal(desktop.length, combined.length, 'desktop and standard collection counts must stay aligned');
  assert.equal(report.collectionCount, combined.length, 'health/coexistence count must be derived from current code');
  assert.equal(report.frCollectionCount + report.globalCollectionCount + report.trCollectionCount + report.usCollectionCount, combined.length);
  assert.equal(tr.length, report.trCollectionCount, 'Türkiye count must match coexistence report');

  for (const region of ['fr', 'global', 'tr', 'us']) {
    const manifest = readJson(`${region}/manifest.json`);
    const collections = readJson(`${region}/nuvio-collections.json`);
    assert(manifest.catalogs.length > 0, `${region} manifest catalogs missing`);
    assert(collections.length > 0, `${region} collections missing`);
  }

  const jsonFiles = filesUnder(DIST).filter((file) => file.endsWith('.json'));
  for (const file of jsonFiles) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, FORBIDDEN_HOSTS, path.relative(DIST, file));
  }

  const allStrings = flattenStrings(combined);
  const nuvioUrls = allStrings.filter((value) => /^https?:\/\//.test(value) && /\/(?:fr|global|tr|us)\//.test(value));
  assert(nuvioUrls.length > 0, 'expected Nuvio-owned URLs in collections');
  for (const value of nuvioUrls) {
    if (/image\.tmdb\.org|anili\.st|anilist\.co|tvmaze\.com/i.test(value)) continue;
    assert(value.startsWith(TEST_ORIGIN + '/'), `Nuvio URL escaped test origin: ${value}`);
  }
});

test('Türkiye collections preserve the current service set and rolling periods', () => {
  const tr = readJson('nuvio-collections-tr.json');
  const text = JSON.stringify(tr).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  for (const token of ['exxen', 'gain', 'tabii', 'tod', 'puhutv', 'tv+', 'tivibu', 'd-smart', 's sport', 'crunchyroll', 'max']) {
    assert(text.includes(token), `Türkiye collection/service missing: ${token}`);
  }
  assert(!text.includes('blutv'), 'BluTV must remain aliased to Max');

  const catalogIds = tr.flatMap((collection) =>
    (collection.folders || []).flatMap((folder) =>
      (folder.sources || []).map((source) => String(source.catalogId || '').toLowerCase())
    )
  );
  const joined = catalogIds.join('\n');
  for (const period of ['today', 'tomorrow', 'yesterday', 'lastweek', 'nextweek']) {
    assert(joined.includes(period), `rolling period missing: ${period}`);
  }
  assert(/20\d{2}-\d{2}/.test(joined), 'monthly archive sources missing');
});

test('runtime router serves repository artwork and retains Shield Desktop v3 renderer', async () => {
  const router = await import(pathToFileURL(path.join(ROOT, 'runtime/router.mjs')).href + `?t=${Date.now()}`);
  assert.equal(router.localAssetPath('https://oracle.example/tr/platform-card.jpg?provider=exxen'), '/static/assets/platform-art/tr/exxen-card.jpg');
  assert.equal(router.platformStaticAssetPath('https://oracle.example/tr/desktop-folder-card.jpg?provider=tod&type=series'), '/static/assets/platform-art/tr/tod-card.jpg');
  assert.equal(router.platformStaticAssetPath('https://oracle.example/tr/desktop-folder-card.jpg?provider=crunchyroll&type=series'), '/static/assets/platform-art/global/anime-asia-card.jpg');
  assert.equal(router.localAssetPath('https://oracle.example/fr/platform-card.jpg?provider=../bad'), null);

  const svg = router.desktopContentCardSvg('https://oracle.example/global/desktop-content-card.jpg?title=Oracle%20Runtime&append=S01E01&label=Anime%20JP%2FKR&provider=anime-asia&type=series');
  assert.match(svg, /data-renderer="shield-desktop-v3"/);
  assert.match(svg, /desktop-title/);
  assert.match(svg, /desktop-subtitle/);
  assert.match(svg, /desktop-provider/);
});

test('Anime resilience recognizes URL-encoded AniList metadata IDs', async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, 'runtime/anime-resilience.mjs')).href + `?encoded=${Date.now()}`);
  assert.equal(mod.isGlobalAnimeResilienceRequest('https://oracle.example/global/meta/series/anilist%3A197715.json'), true);
  assert.equal(mod.isGlobalAnimeResilienceRequest('https://oracle.example/global/meta/series/anilist%3a197715.json'), true);
  assert.equal(mod.isGlobalAnimeResilienceRequest('https://oracle.example/global/meta/series/anilist:197715.json'), true);
  assert.equal(mod.isGlobalAnimeResilienceRequest('https://oracle.example/global/meta/movie/anilist%3A197715.json'), false);
});

test('Oracle runtime sources contain no legacy hosting/runtime markers', () => {
  const files = [
    'runtime/index.mjs',
    'runtime/router.mjs',
    'runtime/anime-resilience.mjs',
    'oracle/server.mjs',
    'scripts/build-runtime.js'
  ];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.doesNotMatch(text, /cloudflare|pages\.dev|workers\.dev|vercel\.app|sslip\.io/i, rel);
  }
});
