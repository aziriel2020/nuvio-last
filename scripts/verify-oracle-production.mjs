#!/usr/bin/env node
import sharp from 'sharp';

const ORIGIN = new URL(process.env.PUBLIC_ORIGIN || 'https://141-145-215-202.nip.io').origin;
const TIMEOUT_MS = Math.max(5000, Number(process.env.VERIFY_TIMEOUT_MS || 25000));
const FORBIDDEN = /pages\.dev|workers\.dev|vercel(?:\.app)?|sslip\.io/i;
const EXTERNAL_ART_HOSTS = /^(?:image\.tmdb\.org|static\.tvmaze\.com|s[1-4]\.anilist\.co|img\.anili\.st)$/i;
const IMAGE_PATH = /\.(?:jpe?g|png|webp|svg)(?:$|\?)/i;
const stats = { requests: 0, json: 0, images: 0, catalogs: 0, metas: 0, visualBytes: 0 };

function assert(value, message) {
  if (!value) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(pathOrUrl, { json = true, attempts = 2, requireOracle = true } = {}) {
  const url = new URL(pathOrUrl, ORIGIN);
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      stats.requests += 1;
      const response = await fetch(url, {
        signal: controller.signal,
        cache: 'no-store',
        headers: {
          accept: json ? 'application/json' : 'image/avif,image/webp,image/jpeg,image/png,image/svg+xml,*/*;q=.8',
          'cache-control': 'no-cache',
          'user-agent': 'NuvioOracleFinalAudit/1.0'
        }
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      assert(response.ok, `${url.pathname} HTTP ${response.status}: ${new TextDecoder().decode(bytes).slice(0, 350)}`);
      if (requireOracle && url.origin === ORIGIN) assertOracleHeaders(response, url.pathname);
      if (!json) {
        stats.images += 1;
        stats.visualBytes += bytes.byteLength;
        return { response, bytes, text: new TextDecoder().decode(bytes), url };
      }
      stats.json += 1;
      let data;
      try { data = JSON.parse(new TextDecoder().decode(bytes)); }
      catch { throw new Error(`${url.pathname} returned invalid JSON`); }
      return { response, bytes, data, url };
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
      await sleep(500 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function assertOracleHeaders(response, label) {
  assert(response.headers.get('x-nuvio-origin') === 'oracle-vm', `${label}: X-Nuvio-Origin=${response.headers.get('x-nuvio-origin')}`);
  assert(response.headers.get('x-nuvio-edge') === 'oracle-node', `${label}: X-Nuvio-Edge=${response.headers.get('x-nuvio-edge')}`);
}

function scanForbidden(value, label) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const match = text.match(FORBIDDEN);
  assert(!match, `${label}: forbidden legacy hosting token found: ${match?.[0]}`);
}

function flattenStrings(value, output = []) {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => flattenStrings(item, output));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => flattenStrings(item, output));
  return output;
}

function sourcePath(region, source) {
  return `/${region}/catalog/${source.type}/${encodeURIComponent(source.catalogId)}.json`;
}

function collectionSources(collection) {
  return (collection?.folders || []).flatMap((folder) =>
    (folder.sources || []).map((source) => ({ ...source, folderTitle: folder.title || '', collectionTitle: collection.title || '' }))
  );
}

function rollingSource(collection, suffix, type = null) {
  return collectionSources(collection).find((source) =>
    (!type || source.type === type) && String(source.catalogId || '').toLowerCase().endsWith(`-${suffix}`)
  );
}

function recentArchiveSource(collection, type = null) {
  const sources = collectionSources(collection).filter((source) =>
    (!type || source.type === type) && /-20\d{2}-\d{2}$/.test(String(source.catalogId || ''))
  );
  sources.sort((a, b) => String(b.catalogId).localeCompare(String(a.catalogId)));
  return sources[0] || null;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      out[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, worker));
  return out;
}

function oracleOwnedUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === ORIGIN;
  } catch {
    return false;
  }
}

function nuvioUrlMustBeOracle(value, label) {
  let url;
  try { url = new URL(value); } catch { return; }
  if (EXTERNAL_ART_HOSTS.test(url.hostname)) return;
  if (/^(?:api\.themoviedb\.org|api\.tvmaze\.com|graphql\.anilist\.co|tsuzuki\.top|www\.dsmartgo\.com\.tr|bfogwjgq8dbp\.merlincdn\.net)$/i.test(url.hostname)) return;
  if (/\/(?:fr|global|tr|us)\//.test(url.pathname) || /nuvio-collections|manifest\.json|collections\.json/.test(url.pathname)) {
    assert(url.origin === ORIGIN, `${label}: Nuvio URL escaped Oracle: ${value}`);
  }
}

async function verifyVisual(urlValue, label) {
  const url = new URL(urlValue);
  assert(url.origin === ORIGIN, `${label}: generated visual escaped Oracle: ${url.origin}`);
  const result = await request(url, { json: false, attempts: 3 });
  const type = String(result.response.headers.get('content-type') || '').toLowerCase();
  assert(type.startsWith('image/'), `${label}: invalid Content-Type ${type}`);
  assert(result.bytes.byteLength > 1000, `${label}: empty/tiny image (${result.bytes.byteLength} bytes)`);
  if (/\/(?:desktop|shield)-(?:content|folder|genre)-card\.jpg$/.test(url.pathname)) {
    assert(type.startsWith('image/jpeg'), `${label}: cinematic card must be a native JPEG, got ${type}`);
    assert(result.response.headers.get('x-nuvio-card-renderer') === 'shield-desktop-jpeg-v4', `${label}: cinematic renderer marker missing`);
    assert(result.response.headers.get('x-nuvio-desktop-format') === '1600x900', `${label}: cinematic format marker missing`);
    assert(result.bytes[0] === 0xff && result.bytes[1] === 0xd8, `${label}: invalid JPEG signature`);
    const metadata = await sharp(result.bytes).metadata();
    assert(metadata.format === 'jpeg' && metadata.width === 1600 && metadata.height === 900, `${label}: expected 1600x900 JPEG, got ${metadata.format} ${metadata.width}x${metadata.height}`);
  }
  if (/platform-(?:category-card|backdrop)\.svg$/.test(url.pathname)) {
    assert(result.response.headers.get('x-nuvio-visual-renderer') === 'platform-assets-v2', `${label}: platform renderer marker missing`);
  }
  if (/\/static\/assets\/generated-covers\/.+-(?:shield|desktop)\.jpg$/.test(url.pathname)) {
    assert(type.startsWith('image/jpeg'), `${label}: generated cover must be JPEG, got ${type}`);
    const metadata = await sharp(result.bytes).metadata();
    assert(metadata.format === 'jpeg' && metadata.width === 1600 && metadata.height === 900, `${label}: generated cover expected 1600x900, got ${metadata.format} ${metadata.width}x${metadata.height}`);
  }
  if (/\/static\/assets\/generated-covers\/.+-hero\.jpg$/.test(url.pathname) || /\/static\/assets\/generated-covers\/(?:fr|global|tr|us)\/[a-z0-9-]+\/hero\.jpg$/.test(url.pathname)) {
    assert(type.startsWith('image/jpeg'), `${label}: generated hero must be JPEG, got ${type}`);
    const metadata = await sharp(result.bytes).metadata();
    assert(metadata.format === 'jpeg' && metadata.width === 1920 && metadata.height === 1080, `${label}: generated hero expected 1920x1080, got ${metadata.format} ${metadata.width}x${metadata.height}`);
  }
  return {
    type,
    bytes: result.bytes.byteLength,
    backgroundSource: result.response.headers.get('x-nuvio-background-source') || null,
    backgroundFormat: result.response.headers.get('x-nuvio-background-format') || null
  };
}

async function fetchCatalog(region, source, label, requireNonEmpty = false) {
  assert(source, `${label}: source missing`);
  const result = await request(sourcePath(region, source), { attempts: 3 });
  stats.catalogs += 1;
  assert(Array.isArray(result.data?.metas), `${label}: metas[] missing`);
  if (requireNonEmpty) assert(result.data.metas.length > 0, `${label}: catalog unexpectedly empty`);
  scanForbidden(result.data, `${label} catalog`);
  for (const meta of result.data.metas.slice(0, 3)) {
    assert(meta?.id && meta?.name && meta?.type === source.type, `${label}: malformed meta`);
    for (const value of flattenStrings(meta)) nuvioUrlMustBeOracle(value, `${label} meta`);
  }
  return result.data.metas;
}

async function fetchMeta(region, meta, label) {
  const result = await request(`/${region}/meta/${meta.type}/${encodeURIComponent(meta.id)}.json`, { attempts: 3 });
  stats.metas += 1;
  assert(result.data?.meta?.id === meta.id, `${label}: metadata route did not resolve ${meta.id}`);
  assert(result.data.meta.name, `${label}: metadata name missing`);
  scanForbidden(result.data, `${label} metadata`);
  for (const value of flattenStrings(result.data)) nuvioUrlMustBeOracle(value, `${label} metadata`);
  return result.data.meta;
}

async function fetchFirstWorkingMeta(region, metas, label, maxCandidates = 8) {
  const candidates = [];
  const seen = new Set();
  for (const meta of metas) {
    const key = `${meta?.type || ''}:${meta?.id || ''}`;
    if (!meta?.id || seen.has(key)) continue;
    seen.add(key);
    candidates.push(meta);
    if (candidates.length >= maxCandidates) break;
  }
  assert(candidates.length > 0, `${label}: no metadata candidates discovered`);
  const failures = [];
  for (const candidate of candidates) {
    try {
      const resolved = await fetchMeta(region, candidate, label);
      return { candidate, resolved, tried: failures.length + 1 };
    } catch (error) {
      const message = String(error?.message || error);
      failures.push(`${candidate.id}: ${message}`);
      console.warn(`[meta-probe-soft-fail] ${label} ${candidate.id}: ${message}`);
    }
  }
  throw new Error(`${label}: no metadata candidate resolved after ${candidates.length} candidates: ${failures.join(' | ')}`);
}

console.log(`Auditing ${ORIGIN}`);

const oracleHealth = await request('/_oracle/health');
assert(oracleHealth.data?.ok === true, '/_oracle/health ok != true');
assert(oracleHealth.data?.runtime === 'oracle-vm', '/_oracle/health runtime != oracle-vm');
assert(oracleHealth.data?.publicOrigin === ORIGIN, `PUBLIC_ORIGIN mismatch: ${oracleHealth.data?.publicOrigin}`);
assert(typeof oracleHealth.data?.gitSha === 'string' && oracleHealth.data.gitSha.length >= 7, 'deployed gitSha missing');

const health = await request('/health');
assert(health.data?.ok === true && health.data?.safe === true, '/health not safe');
assert(Array.isArray(health.data?.duplicateCollectionIds) && health.data.duplicateCollectionIds.length === 0, 'duplicate collection IDs');
assert(Array.isArray(health.data?.duplicateFolderKeys) && health.data.duplicateFolderKeys.length === 0, 'duplicate folder keys');
assert(Array.isArray(health.data?.duplicateCatalogKeys) && health.data.duplicateCatalogKeys.length === 0, 'duplicate catalog keys');

const requiredJsonPaths = [
  '/nuvio-collections-fr-global-tr-usa.json',
  '/nuvio-collections-shield.json',
  '/nuvio-collections-desktop.json',
  '/nuvio-collections-tr.json',
  '/fr/nuvio-collections.json',
  '/global/nuvio-collections.json',
  '/tr/nuvio-collections.json',
  '/us/nuvio-collections.json',
  '/fr/manifest.json',
  '/global/manifest.json',
  '/tr/manifest.json',
  '/us/manifest.json'
];
const payloads = {};
for (const pathname of requiredJsonPaths) {
  const result = await request(pathname, { attempts: 3 });
  payloads[pathname] = result.data;
  scanForbidden(result.data, pathname);
  for (const value of flattenStrings(result.data)) nuvioUrlMustBeOracle(value, pathname);
}

const standard = payloads['/nuvio-collections-fr-global-tr-usa.json'];
const desktop = payloads['/nuvio-collections-desktop.json'];
const tr = payloads['/nuvio-collections-tr.json'];
assert(Array.isArray(standard) && standard.length > 0, 'standard collection import empty');
const shieldAlias = payloads['/nuvio-collections-shield.json'];
assert(Array.isArray(shieldAlias) && shieldAlias.length === standard.length, `Shield count ${shieldAlias?.length} != standard ${standard.length}`);
const generatedManifestResult = await request('/static/assets/generated-covers/manifest.json', { attempts: 3 });
stats.json += 1;
const generatedManifest = generatedManifestResult.data;
assert(generatedManifest?.revision === 'generated-v2', `generated cover revision mismatch: ${generatedManifest?.revision}`);
assert(generatedManifest?.complete === true, 'generated cover manifest is not complete');
assert(Number(generatedManifest?.platformParents || 0) >= 40, `generated cover platform parent count too small: ${generatedManifest?.platformParents}`);
assert(Number(generatedManifest?.generatedFiles || 0) >= 100, `generated cover file count too small: ${generatedManifest?.generatedFiles}`);

const generatedShieldVisualUrls = flattenStrings(standard).filter((value) => {
  try { return /\/static\/assets\/generated-covers\/(?:fr|global|tr|us)\/[a-z0-9-]+\/(?:series|movie)-shield\.jpg$/.test(new URL(value).pathname); } catch { return false; }
});
assert(generatedShieldVisualUrls.length >= 40, `too few generated Shield covers in collection payload: ${generatedShieldVisualUrls.length}`);
for (const value of generatedShieldVisualUrls) {
  const visualUrl = new URL(value);
  assert(visualUrl.origin === ORIGIN, `generated Shield cover escaped Oracle: ${value}`);
  assert(visualUrl.searchParams.get('v') === 'generated-v2', `generated Shield cover has stale revision: ${value}`);
}

const legacyShieldVisualUrls = flattenStrings(standard).filter((value) => {
  try { return /\/shield-(?:folder|genre)-card\.jpg$/.test(new URL(value).pathname); } catch { return false; }
});
for (const value of legacyShieldVisualUrls) {
  const visualUrl = new URL(value);
  assert(visualUrl.origin === ORIGIN, `Shield fallback visual escaped Oracle: ${value}`);
}

const frNetflixReal = standard.find((collection) => collection.title === '🇫🇷 Netflix');
assert(frNetflixReal, 'France Netflix collection missing for generated-cover verification');
const frNetflixSeriesReal = (frNetflixReal.folders || []).find((folder) => /séries|series/i.test(String(folder.title || ''))) || frNetflixReal.folders?.[0];
assert(frNetflixSeriesReal?.coverImageUrl, 'France Netflix generated card missing');
assert(/\/static\/assets\/generated-covers\/fr\/netflix\/series-shield\.jpg$/.test(new URL(frNetflixSeriesReal.coverImageUrl).pathname), `France Netflix Shield is not using generated asset: ${frNetflixSeriesReal.coverImageUrl}`);
await verifyVisual(frNetflixSeriesReal.coverImageUrl, 'France Netflix generated Shield card');
assert(frNetflixSeriesReal?.heroBackdropUrl, 'France Netflix generated hero missing');
assert(/\/static\/assets\/generated-covers\/fr\/netflix\/series-hero\.jpg$/.test(new URL(frNetflixSeriesReal.heroBackdropUrl).pathname), `France Netflix hero is not using generated asset: ${frNetflixSeriesReal.heroBackdropUrl}`);
await verifyVisual(frNetflixSeriesReal.heroBackdropUrl, 'France Netflix generated hero');

const netflixManifest = (generatedManifest.results || []).find((item) => item.region === 'fr' && item.provider === 'netflix');
assert(netflixManifest, 'generated cover manifest missing France Netflix');
const netflixImportedBackdrops = (netflixManifest.sources || []).flatMap((entry) => entry.imported || []).filter((entry) => entry.backdropPath);
assert(netflixImportedBackdrops.length >= 2, `France Netflix generated cover did not import enough real TMDb backdrops: ${netflixImportedBackdrops.length}`);

assert(Array.isArray(desktop) && desktop.length === standard.length, `Desktop count ${desktop?.length} != standard ${standard.length}`);
const generatedDesktopVisualUrls = flattenStrings(desktop).filter((value) => {
  try { return /\/static\/assets\/generated-covers\/(?:fr|global|tr|us)\/[a-z0-9-]+\/(?:series|movie)-desktop\.jpg$/.test(new URL(value).pathname); } catch { return false; }
});
assert(generatedDesktopVisualUrls.length >= 40, `too few generated Desktop covers in collection payload: ${generatedDesktopVisualUrls.length}`);
for (const value of generatedDesktopVisualUrls) {
  const visualUrl = new URL(value);
  assert(visualUrl.origin === ORIGIN, `generated Desktop cover escaped Oracle: ${value}`);
  assert(visualUrl.searchParams.get('v') === 'generated-v2', `generated Desktop cover has stale revision: ${value}`);
}
assert(Array.isArray(tr) && tr.length > 0, 'Türkiye import empty');
assert(health.data.collectionCount === standard.length, `health collectionCount ${health.data.collectionCount} != ${standard.length}`);
assert(health.data.trCollectionCount === tr.length, `health trCollectionCount ${health.data.trCollectionCount} != ${tr.length}`);
assert(payloads['/tr/nuvio-collections.json'].length === tr.length, 'dedicated and regional Türkiye counts differ');

const trTitles = tr.map((c) => String(c.title || ''));
const requiredTurkey = [
  'Exxen', 'GAİN', 'tabii', 'TOD', 'puhutv', 'TV+', 'Tivibu', 'D-Smart GO', 'S Sport Plus', 'Crunchyroll', 'Max'
];
for (const name of requiredTurkey) assert(trTitles.some((title) => title.includes(name)), `Türkiye collection missing ${name}`);
assert(!JSON.stringify(tr).includes('BluTV'), 'BluTV alias leaked; Max should be used');

const trCatalogIds = collectionSources({ folders: tr.flatMap((c) => c.folders || []) }).map((s) => String(s.catalogId || '').toLowerCase());
for (const period of ['today', 'tomorrow', 'yesterday', 'lastweek', 'nextweek']) {
  assert(trCatalogIds.some((id) => id.endsWith(`-${period}`)), `Türkiye rolling period missing ${period}`);
}
assert(trCatalogIds.some((id) => /-20\d{2}-\d{2}$/.test(id)), 'Türkiye monthly archives missing');

// Fetch a representative live catalog from every Türkiye folder. This proves
// every imported source family routes through the deployed Oracle runtime.
const trCatalogJobs = [];
for (const collection of tr) {
  for (const folder of collection.folders || []) {
    const source = (folder.sources || []).find((s) => String(s.catalogId || '').endsWith('-today')) || folder.sources?.[0];
    if (source) trCatalogJobs.push({ collection, folder, source });
  }
}
const trCatalogResults = await mapLimit(trCatalogJobs, 5, async ({ collection, folder, source }) => {
  const metas = await fetchCatalog('tr', source, `${collection.title}/${folder.title}`);
  return { title: collection.title, folder: folder.title, metas, source };
});

// S Sport must expose at least one live event across its three windows.
const sSport = tr.find((c) => String(c.title).includes('S Sport Plus'));
assert(sSport, 'S Sport Plus missing');
let sSportEvents = 0;
for (const suffix of ['today', 'tomorrow', 'nextweek']) {
  const source = rollingSource(sSport, suffix);
  if (!source) continue;
  const metas = await fetchCatalog('tr', source, `S Sport Plus/${suffix}`);
  sSportEvents += metas.length;
}
assert(sSportEvents > 0, 'S Sport Plus returned no live events across Today/Tomorrow/NextWeek');

// D-Smart must resolve at least one current/recent archive route and its native meta when available.
const dsmart = tr.find((c) => String(c.title).includes('D-Smart GO'));
assert(dsmart, 'D-Smart GO missing');
const dsmartSource = recentArchiveSource(dsmart) || rollingSource(dsmart, 'today');
const dsmartMetas = await fetchCatalog('tr', dsmartSource, 'D-Smart GO', false);
if (dsmartMetas[0]) await fetchMeta('tr', dsmartMetas[0], 'D-Smart GO');

// Anime JP/KR: both media families must route correctly. Metadata validation is
// fail-closed across multiple genuine AniList IDs so one temporarily unavailable
// title cannot become a false negative while a systemic AniList failure still fails.
const anime = standard.find((c) => /Anime Japon \+ Corée/.test(String(c.title || '')));
assert(anime, 'Anime Japon + Corée collection missing');
const animeSeriesSource = rollingSource(anime, 'today', 'series') || recentArchiveSource(anime, 'series');
const animeMovieSource = rollingSource(anime, 'today', 'movie') || recentArchiveSource(anime, 'movie');
const animeSeriesMetas = await fetchCatalog('global', animeSeriesSource, 'Anime Séries');
const animeMovieMetas = await fetchCatalog('global', animeMovieSource, 'Anime Films');
let animeCandidatePool = [...animeSeriesMetas, ...animeMovieMetas];
let animeAniListCandidates = animeCandidatePool.filter((m) => String(m?.id || '').startsWith('anilist:'));

if (animeAniListCandidates.length < 2) {
  const extraSources = [
    rollingSource(anime, 'yesterday', 'series'),
    rollingSource(anime, 'lastweek', 'series'),
    recentArchiveSource(anime, 'series'),
    rollingSource(anime, 'yesterday', 'movie'),
    rollingSource(anime, 'lastweek', 'movie'),
    recentArchiveSource(anime, 'movie')
  ].filter(Boolean);
  const seenSource = new Set([animeSeriesSource?.catalogId, animeMovieSource?.catalogId]);
  for (const source of extraSources) {
    if (seenSource.has(source.catalogId)) continue;
    seenSource.add(source.catalogId);
    try {
      const metas = await fetchCatalog('global', source, `Anime fallback ${source.type}/${source.catalogId}`);
      animeCandidatePool.push(...metas);
      animeAniListCandidates = animeCandidatePool.filter((m) => String(m?.id || '').startsWith('anilist:'));
      if (animeAniListCandidates.length >= 8) break;
    } catch (error) {
      console.warn(`[anime-catalog-probe-soft-fail] ${source.catalogId}: ${String(error?.message || error)}`);
    }
  }
}

assert(animeAniListCandidates.length > 0, 'Anime catalogs exposed no AniList metadata IDs across current/recent windows');
const animeMetaProbe = await fetchFirstWorkingMeta('global', animeAniListCandidates, 'Anime AniList', 8);

// Today/Tomorrow are live routes, not frozen static data.
for (const suffix of ['today', 'tomorrow']) {
  const netflixTr = tr.find((c) => /Netflix/.test(String(c.title || '')));
  const source = rollingSource(netflixTr, suffix) || collectionSources(netflixTr)[0];
  await fetchCatalog('tr', source, `Türkiye Netflix ${suffix}`);
}

// Validate every distinct Oracle-owned image URL actually emitted by collection imports.
const visualUrls = new Set();
for (const payload of [standard, desktop, tr]) {
  for (const value of flattenStrings(payload)) {
    if (!/^https?:\/\//i.test(value)) continue;
    const url = new URL(value);
    if (url.origin === ORIGIN && IMAGE_PATH.test(url.pathname + url.search)) visualUrls.add(url.toString());
  }
}
assert(visualUrls.size > 0, 'No Oracle-owned collection visuals discovered');
await mapLimit([...visualUrls], 6, (url, index) => verifyVisual(url, `collection visual #${index + 1}`));

// Explicit renderer routes requested for the migration contract.
// Content-card validation must use a URL actually emitted by a live catalog so
// its source artwork is real; a fabricated source-less URL is intentionally invalid.
const liveDesktopContentVisual = flattenStrings([
  ...animeSeriesMetas,
  ...animeMovieMetas,
  ...trCatalogResults.flatMap((row) => row.metas || [])
]).find((value) => {
  try {
    const u = new URL(value);
    return u.origin === ORIGIN && /\/desktop-content-card\.jpg$/.test(u.pathname) && Boolean(u.searchParams.get('src'));
  } catch {
    return false;
  }
});
assert(liveDesktopContentVisual, 'No emitted Desktop content-card URL with a real source was discovered');

const explicitVisuals = [
  '/tr/platform-category-card.svg?provider=exxen&category=series',
  '/tr/platform-backdrop.svg?provider=exxen&type=series',
  '/tr/desktop-folder-card.jpg?provider=exxen&type=series&title=Exxen',
  liveDesktopContentVisual,
  '/fr/genre-folder-art.svg?genre=action&variant=card&type=movie&label=Action',
  '/static/assets/platform-art/tr/exxen-card.jpg',
  '/static/assets/platform-art/tr/d-smart-go-backdrop.jpg',
  '/static/assets/platform-art/global/anime-asia-card.jpg'
];
for (const visual of explicitVisuals) await verifyVisual(new URL(visual, ORIGIN).toString(), visual);

const nonEmptyTurkishFamilies = new Set(trCatalogResults.filter((row) => row.metas.length > 0).map((row) => row.title));
const summary = {
  ok: true,
  origin: ORIGIN,
  gitSha: oracleHealth.data.gitSha,
  health: { oracle: true, coexistence: true, collisions: 0 },
  counts: {
    standard: standard.length,
    desktop: desktop.length,
    turkiye: tr.length,
    france: health.data.frCollectionCount,
    global: health.data.globalCollectionCount,
    usa: health.data.usCollectionCount
  },
  manifests: {
    fr: payloads['/fr/manifest.json'].catalogs.length,
    global: payloads['/global/manifest.json'].catalogs.length,
    tr: payloads['/tr/manifest.json'].catalogs.length,
    us: payloads['/us/manifest.json'].catalogs.length
  },
  turkiye: {
    requiredServices: requiredTurkey,
    foldersChecked: trCatalogJobs.length,
    nonEmptyFamilies: [...nonEmptyTurkishFamilies],
    sSportLiveEvents: sSportEvents,
    dsmartSampleMetas: dsmartMetas.length
  },
  anime: {
    seriesChecked: true,
    filmsChecked: true,
    seriesMetas: animeSeriesMetas.length,
    filmMetas: animeMovieMetas.length,
    anilistCandidates: animeAniListCandidates.length,
    metaRouteChecked: true,
    resolvedMetaId: animeMetaProbe.candidate.id,
    candidatesTried: animeMetaProbe.tried
  },
  assets: {
    collectionVisualUrlsChecked: visualUrls.size,
    explicitVisualsChecked: explicitVisuals.length,
    generatedCoverRevision: generatedManifest.revision,
    generatedCoverFiles: generatedManifest.generatedFiles,
    generatedPlatformParents: generatedManifest.platformParents,
    generatedShieldUrls: generatedShieldVisualUrls.length,
    generatedDesktopUrls: generatedDesktopVisualUrls.length,
    totalVisualBytes: stats.visualBytes
  },
  antiLegacyScan: {
    pagesDev: 0,
    workersDev: 0,
    vercel: 0,
    sslipIo: 0
  },
  requests: stats
};
console.log(JSON.stringify(summary, null, 2));
