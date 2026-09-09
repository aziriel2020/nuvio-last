#!/usr/bin/env node

const origin = new URL(process.env.PUBLIC_ORIGIN || 'https://141-145-215-202.nip.io').origin;
const timeoutMs = Number(process.env.VERIFY_TIMEOUT_MS || 35000);
const requestStats = { total: 0, json: 0, image: 0, retries: 0 };

function assert(value, message) {
  if (!value) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(pathOrUrl, { json = true, attempts = 4, allowHttpError = false } = {}) {
  const url = new URL(pathOrUrl, origin);
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    requestStats.total += 1;
    if (attempt > 1) requestStats.retries += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        cache: 'no-store',
        headers: {
          accept: json ? 'application/json' : 'image/jpeg,image/svg+xml,image/*;q=.9,*/*;q=.8',
          'cache-control': 'no-cache',
          'user-agent': 'NuvioOracleOperationalVerify/2.0'
        }
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      const text = new TextDecoder().decode(bytes);
      if (!response.ok && !allowHttpError) {
        throw new Error(`${url.pathname} HTTP ${response.status}: ${text.slice(0, 500)}`);
      }
      if (!json) {
        requestStats.image += 1;
        return { response, bytes, text, url };
      }
      requestStats.json += 1;
      let data = null;
      try { data = JSON.parse(text); } catch {}
      if (json && data === null && response.ok) {
        throw new Error(`${url.pathname} returned invalid JSON`);
      }
      return { response, data, bytes, text, url };
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
      await sleep(Math.min(3500, 600 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function catalogPath(region, source) {
  return `/${region}/catalog/${source.type}/${encodeURIComponent(source.catalogId)}.json`;
}

function sourceKey(source) {
  return `${source.type}:${source.catalogId}`;
}

function normalizeCollectionShape(collection) {
  return {
    id: collection.id,
    title: collection.title,
    folders: (collection.folders || []).map((folder) => ({
      id: folder.id,
      title: folder.title,
      sources: (folder.sources || []).map(sourceKey)
    }))
  };
}

function assertOracleHeaders(response, label) {
  const originHeader = response.headers.get('x-nuvio-origin');
  const edgeHeader = response.headers.get('x-nuvio-edge');
  assert(originHeader === 'oracle-vm', `${label}: X-Nuvio-Origin=${originHeader || '<missing>'}`);
  assert(edgeHeader === 'oracle-node', `${label}: X-Nuvio-Edge=${edgeHeader || '<missing>'}`);
}

function assertNoLegacyOrigins(value, label) {
  const text = JSON.stringify(value);
  assert(!/vercel\.app/i.test(text), `${label} still references Vercel`);
  assert(!/sslip\.io/i.test(text), `${label} still references sslip.io`);
}

function assertMetaBasics(meta, expectedType, label) {
  assert(meta && typeof meta === 'object', `${label}: invalid meta`);
  assert(typeof meta.id === 'string' && meta.id.length > 1, `${label}: meta id missing`);
  assert(meta.type === expectedType, `${label}: expected type ${expectedType}, got ${meta.type}`);
  assert(typeof meta.name === 'string' && meta.name.trim(), `${label}: meta name missing`);
  assert(meta.poster || meta.landscapePoster || meta.background || meta.banner, `${label}: all artwork missing`);
}

async function verifyVisual(urlValue, label, { shield = false, platform = false } = {}) {
  const url = new URL(urlValue);
  assert(url.origin === origin, `${label}: visual escaped Oracle origin: ${url.origin}`);
  const result = await request(url, { json: false, attempts: 3 });
  assertOracleHeaders(result.response, label);
  const type = result.response.headers.get('content-type') || '';
  assert(type.includes('image/jpeg') || type.includes('image/svg+xml'), `${label}: bad content type ${type}`);
  assert(result.bytes.byteLength > 1000, `${label}: visual too small (${result.bytes.byteLength} bytes)`);
  if (shield && type.includes('image/svg+xml')) {
    assert(result.response.headers.get('x-nuvio-card-renderer') === 'calendar-overlay-v2', `${label}: missing calendar-overlay-v2`);
    assert(/data-renderer="shield-desktop-v3"/.test(result.text), `${label}: missing shield-desktop-v3`);
  }
  if (platform && type.includes('image/svg+xml')) {
    assert(
      result.response.headers.get('x-nuvio-visual-renderer') === 'platform-assets-v2' ||
      /data:image\/(?:jpeg|png|webp);base64,/i.test(result.text),
      `${label}: platform artwork renderer missing`
    );
  }
  return { type, bytes: result.bytes.byteLength };
}

console.log('=== ORACLE RUNTIME ===');
const oracleHealth = await request('/_oracle/health');
assert(oracleHealth.response.status === 200, '/_oracle/health is not 200');
assertOracleHeaders(oracleHealth.response, '/_oracle/health');
assert(oracleHealth.data?.ok === true, 'Oracle health ok=false');
assert(oracleHealth.data?.runtime === 'oracle-vm', 'Oracle runtime is not oracle-vm');
assert(oracleHealth.data?.publicOrigin === origin, `Oracle publicOrigin mismatch: ${oracleHealth.data?.publicOrigin}`);
console.log('[ORACLE HEALTH] OK', oracleHealth.data.publicOrigin);

const coexistHealth = await request('/health');
assert(coexistHealth.response.status === 200, '/health is not 200');
assertOracleHeaders(coexistHealth.response, '/health');
assert(coexistHealth.data?.ok === true && coexistHealth.data?.safe === true, 'Coexistence health is not safe');
assert(coexistHealth.data?.collectionCount === 49, `/health collectionCount=${coexistHealth.data?.collectionCount}`);
assert(coexistHealth.data?.trCollectionCount === 19, `/health trCollectionCount=${coexistHealth.data?.trCollectionCount}`);
assert(Array.isArray(coexistHealth.data?.duplicateCollectionIds) && coexistHealth.data.duplicateCollectionIds.length === 0, 'Duplicate collection IDs');
assert(Array.isArray(coexistHealth.data?.duplicateFolderKeys) && coexistHealth.data.duplicateFolderKeys.length === 0, 'Duplicate folder keys');
assert(Array.isArray(coexistHealth.data?.duplicateCatalogKeys) && coexistHealth.data.duplicateCatalogKeys.length === 0, 'Duplicate catalog keys');
console.log('[COEXISTENCE] 49 collections / 19 Türkiye / no collisions');

console.log('=== MANIFESTS ===');
const manifestEntries = await Promise.all(['fr','global','tr','us'].map(async (region) => {
  const result = await request(`/${region}/manifest.json`);
  assertOracleHeaders(result.response, `/${region}/manifest.json`);
  assert(Array.isArray(result.data?.catalogs) && result.data.catalogs.length > 0, `${region} manifest has no catalogs`);
  const keys = result.data.catalogs.map((entry) => `${entry.type}:${entry.id}`);
  assert(new Set(keys).size === keys.length, `${region} manifest has duplicate catalog IDs`);
  console.log(`[MANIFEST] ${region} catalogs=${keys.length}`);
  return [region, { data: result.data, keys: new Set(keys) }];
}));
const manifests = Object.fromEntries(manifestEntries);
assert(manifests.tr.keys.size > 6000, `Türkiye manifest unexpectedly small: ${manifests.tr.keys.size}`);

console.log('=== STANDARD + DESKTOP IMPORTS ===');
const [standardResult, desktopResult, trDedicatedResult, trRegionResult] = await Promise.all([
  request('/nuvio-collections-fr-global-tr-usa.json'),
  request('/nuvio-collections-desktop.json'),
  request('/nuvio-collections-tr.json'),
  request('/tr/nuvio-collections.json')
]);
for (const [label, result] of [
  ['standard combined', standardResult],
  ['desktop combined', desktopResult],
  ['Turkey dedicated', trDedicatedResult],
  ['Turkey region', trRegionResult]
]) {
  assertOracleHeaders(result.response, label);
  assertNoLegacyOrigins(result.data, label);
}
const standard = standardResult.data;
const desktop = desktopResult.data;
const trDedicated = trDedicatedResult.data;
const trRegion = trRegionResult.data;
assert(Array.isArray(standard) && standard.length === 49, `Standard combined count=${standard?.length}`);
assert(Array.isArray(desktop) && desktop.length === 49, `Desktop combined count=${desktop?.length}`);
assert(Array.isArray(trDedicated) && trDedicated.length === 19, `Turkey dedicated count=${trDedicated?.length}`);
assert(Array.isArray(trRegion) && trRegion.length === 19, `Turkey region count=${trRegion?.length}`);

assert.deepEqual = undefined;
const standardShape = standard.map(normalizeCollectionShape);
const desktopShape = desktop.map(normalizeCollectionShape);
assert(JSON.stringify(standardShape) === JSON.stringify(desktopShape), 'Standard and Desktop collection/source topology differs');

const trStandard = standard.filter((entry) => String(entry.title || '').startsWith('🇹🇷 '));
const trDesktop = desktop.filter((entry) => String(entry.title || '').startsWith('🇹🇷 '));
assert(trStandard.length === 19 && trDesktop.length === 19, 'Combined Türkiye collection count mismatch');
assert(
  JSON.stringify(trStandard.map(normalizeCollectionShape)) === JSON.stringify(trDedicated.map(normalizeCollectionShape)),
  'Combined standard Türkiye differs from dedicated Türkiye import'
);
assert(
  JSON.stringify(trDedicated.map(normalizeCollectionShape)) === JSON.stringify(trRegion.map(normalizeCollectionShape)),
  'Dedicated Türkiye import differs from /tr/nuvio-collections.json'
);
console.log('[IMPORTS] standard=49 desktop=49 Türkiye=19 topology identical');

const requiredTurkey = [
  '🇹🇷 Netflix','🇹🇷 Prime Video','🇹🇷 Disney+','🇹🇷 Max','🇹🇷 Apple TV+','🇹🇷 MUBI',
  '🇹🇷 Exxen','🇹🇷 GAİN','🇹🇷 tabii','🇹🇷 TOD','🇹🇷 puhutv','🇹🇷 TV+','🇹🇷 Tivibu',
  '🇹🇷 D-Smart GO','🇹🇷 S Sport Plus','🇹🇷 Bi Kanal','🇹🇷 Crunchyroll + AniList','🇹🇷 Türkiye Takvim','🇹🇷 VOD Türkiye'
];
for (const title of requiredTurkey) assert(trDedicated.some((entry) => entry.title === title), `Missing ${title}`);

console.log('=== TÜRKİYE SOURCE CONTRACT ===');
let turkeySources = 0;
let turkeyFolders = 0;
for (const collection of trDedicated) {
  for (const folder of collection.folders || []) {
    turkeyFolders += 1;
    const isSSport = collection.title === '🇹🇷 S Sport Plus';
    const expectedSuffixes = isSSport
      ? ['-today','-tomorrow','-nextweek']
      : ['-today','-tomorrow','-yesterday','-lastweek','-nextweek'];
    assert(
      Array.isArray(folder.sources) && folder.sources.length >= expectedSuffixes.length,
      `${collection.title}/${folder.title}: insufficient sources`
    );
    if (isSSport) {
      assert(folder.title === 'Sports en direct', 'S Sport folder must be Sports en direct');
      assert(folder.sources.length === 3, `S Sport must expose exactly 3 live windows, got ${folder.sources.length}`);
    }
    for (let index = 0; index < expectedSuffixes.length; index += 1) {
      assert(
        String(folder.sources[index]?.catalogId || '').endsWith(expectedSuffixes[index]),
        `${collection.title}/${folder.title}: dynamic source order mismatch at ${expectedSuffixes[index]}`
      );
    }
    for (const source of folder.sources) {
      turkeySources += 1;
      assert(manifests.tr.keys.has(sourceKey(source)), `${collection.title}/${folder.title}: source missing from TR manifest: ${sourceKey(source)}`);
    }
  }
}
console.log(`[TR CONTRACT] folders=${turkeyFolders} source-links=${turkeySources} all resolve in manifest`);

console.log('=== TÜRKİYE VISUALS STANDARD + DESKTOP ===');
for (let index = 0; index < trStandard.length; index += 1) {
  const regular = trStandard[index];
  const desk = trDesktop[index];
  const regularFolder = regular.folders?.[0];
  const deskFolder = desk.folders?.[0];
  assert(regularFolder?.coverImageUrl, `${regular.title}: standard cover missing`);
  assert(deskFolder?.coverImageUrl, `${desk.title}: desktop cover missing`);
  await verifyVisual(regularFolder.coverImageUrl, `${regular.title} standard cover`, { platform: true });
  await verifyVisual(deskFolder.coverImageUrl, `${desk.title} desktop cover`, { platform: true });
}
console.log('[TR VISUALS] 19 standard + 19 Desktop parent covers OK');

console.log('=== TÜRKİYE DYNAMIC ROUTES ===');
const dynamicJobs = [];
for (const collection of trDedicated) {
  for (const folder of collection.folders || []) {
    for (const source of (folder.sources || []).slice(0, 2)) {
      dynamicJobs.push({ collection, folder, source, period: String(source.catalogId).endsWith('-today') ? 'today' : 'tomorrow' });
    }
  }
}
const localTitles = new Set(['🇹🇷 Exxen','🇹🇷 GAİN','🇹🇷 tabii','🇹🇷 TOD','🇹🇷 puhutv','🇹🇷 TV+','🇹🇷 Tivibu','🇹🇷 D-Smart GO','🇹🇷 S Sport Plus']);
for (const collection of trDedicated.filter((entry) => localTitles.has(entry.title))) {
  for (const folder of collection.folders || []) {
    const source = (folder.sources || []).find((entry) => String(entry.catalogId).endsWith('-nextweek'));
    if (source) dynamicJobs.push({ collection, folder, source, period: 'nextweek' });
  }
}

const serviceStats = new Map();
await mapLimit(dynamicJobs, 5, async ({ collection, folder, source, period }) => {
  const result = await request(catalogPath('tr', source), { attempts: 3 });
  assertOracleHeaders(result.response, `${collection.title}/${folder.title}/${period}`);
  assert(Array.isArray(result.data?.metas), `${collection.title}/${folder.title}/${period}: metas[] missing`);
  for (const meta of result.data.metas.slice(0, 4)) {
    assertMetaBasics(meta, source.type, `${collection.title}/${folder.title}/${period}`);
  }
  const current = serviceStats.get(collection.title) || { routes: 0, metas: 0, nonEmptyRoutes: 0 };
  current.routes += 1;
  current.metas += result.data.metas.length;
  if (result.data.metas.length) current.nonEmptyRoutes += 1;
  serviceStats.set(collection.title, current);
});

let localServicesWithContent = 0;
for (const title of requiredTurkey) {
  const stats = serviceStats.get(title) || { routes: 0, metas: 0, nonEmptyRoutes: 0 };
  if (localTitles.has(title) && stats.metas > 0) localServicesWithContent += 1;
  console.log(`[TR ROUTES] ${title} routes=${stats.routes} metas=${stats.metas} nonEmpty=${stats.nonEmptyRoutes}`);
}
assert(localServicesWithContent >= 2, `Only ${localServicesWithContent} local Turkish services returned any content across Today/Tomorrow/NextWeek`);
console.log(`[TR DYNAMIC] routes=${dynamicJobs.length}; local services with live content=${localServicesWithContent}`);

console.log('=== S SPORT PLUS OFFICIAL LIVE CALENDAR ===');
const ssportCollection = trDedicated.find((entry) => entry.title === '🇹🇷 S Sport Plus');
assert(ssportCollection, 'S Sport Plus collection missing');
const ssportFolder = ssportCollection.folders?.find((entry) => entry.title === 'Sports en direct');
assert(ssportFolder, 'S Sport Plus live folder missing');
assert(ssportFolder.sources?.length === 3, 'S Sport Plus must expose Today/Tomorrow/NextWeek only');

let ssportMetas = [];
for (const source of ssportFolder.sources) {
  const label = String(source.catalogId).split('-').at(-1);
  const result = await request(catalogPath('tr', source), { attempts: 4 });
  assertOracleHeaders(result.response, `S Sport Plus/${label}`);
  assert(Array.isArray(result.data?.metas), `S Sport Plus/${label}: metas[] missing`);
  for (const meta of result.data.metas.slice(0, 8)) {
    assertMetaBasics(meta, 'series', `S Sport Plus/${label}`);
    assert(String(meta.id || '').startsWith('ssport:'), `S Sport Plus/${label}: invalid official event id ${meta.id}`);
    assert(/Sport/i.test(JSON.stringify(meta.genres || [])), `S Sport Plus/${label}: Sport genre missing`);
    assert(meta.released && !Number.isNaN(Date.parse(meta.released)), `S Sport Plus/${label}: event timestamp missing`);
    assert(/S Sport Plus/i.test(String(meta.description || '')), `S Sport Plus/${label}: official source label missing`);
    const visual = meta.banner || meta.landscapePoster || meta.background || meta.poster;
    assert(visual, `S Sport Plus/${label}: cinematic visual missing`);
    const visualUrl = new URL(visual);
    assert(visualUrl.origin === origin, `S Sport Plus/${label}: visual escaped Oracle`);
    assert(visualUrl.pathname === '/tr/desktop-content-card.jpg', `S Sport Plus/${label}: not using cinematic renderer`);
    assert(visualUrl.searchParams.get('provider') === 's-sport-plus', `S Sport Plus/${label}: provider renderer mismatch`);
  }
  if (result.data.metas[0]) {
    await verifyVisual(
      result.data.metas[0].banner || result.data.metas[0].landscapePoster || result.data.metas[0].poster,
      `S Sport Plus/${label} live card`,
      { shield: true }
    );
  }
  ssportMetas.push(...result.data.metas);
  console.log(`[S SPORT] ${label} metas=${result.data.metas.length}`);
}
assert(ssportMetas.length > 0, 'S Sport Plus official live schedule returned no events across Today/Tomorrow/NextWeek');
console.log(`[S SPORT] official live events validated=${ssportMetas.length}`);

console.log('=== TÜRKİYE RECENT ARCHIVES ===');
const archiveTargets = [
  '🇹🇷 MUBI','🇹🇷 Exxen','🇹🇷 GAİN','🇹🇷 tabii','🇹🇷 TOD','🇹🇷 puhutv',
  '🇹🇷 TV+','🇹🇷 Tivibu','🇹🇷 D-Smart GO'
];
const archiveMonths = [];
{
  const d = new Date();
  for (let offset = 0; offset < 6; offset += 1) {
    const month = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - offset, 1));
    archiveMonths.push(month.toISOString().slice(0, 7));
  }
}
const archiveServiceStats = new Map();
for (const title of archiveTargets) {
  const collection = trDedicated.find((entry) => entry.title === title);
  assert(collection, `Archive target missing: ${title}`);
  const stats = { routes: 0, metas: 0, nonEmptyRoutes: 0, byMonth: {} };
  for (const month of archiveMonths) {
    stats.byMonth[month] = { routes: 0, metas: 0 };
    for (const folder of collection.folders || []) {
      const source = (folder.sources || []).find((entry) => String(entry.catalogId).endsWith(`-${month}`));
      if (!source) continue;
      const result = await request(catalogPath('tr', source), { attempts: 3 });
      assertOracleHeaders(result.response, `${title}/${folder.title}/${month}`);
      assert(Array.isArray(result.data?.metas), `${title}/${folder.title}/${month}: metas[] missing`);
      for (const meta of result.data.metas.slice(0, 3)) {
        assertMetaBasics(meta, source.type, `${title}/${folder.title}/${month}`);
      }
      stats.routes += 1;
      stats.metas += result.data.metas.length;
      stats.byMonth[month].routes += 1;
      stats.byMonth[month].metas += result.data.metas.length;
      if (result.data.metas.length) stats.nonEmptyRoutes += 1;
    }
  }
  archiveServiceStats.set(title, stats);
  console.log(`[TR ARCHIVE] ${title} routes=${stats.routes} metas=${stats.metas} nonEmpty=${stats.nonEmptyRoutes} months=${JSON.stringify(stats.byMonth)}`);
}

const archiveServicesWithContent = [...archiveServiceStats.values()].filter((stats) => stats.metas > 0).length;
console.log(`[TR ARCHIVE SUMMARY] servicesWithRecentContent=${archiveServicesWithContent}/${archiveTargets.length}`);

console.log('=== TÜRKİYE AUTHORITATIVE HISTORICAL PROOFS ===');
for (const proof of [
  { title: '🇹🇷 Exxen', month: '2025-11', folder: 'Séries', minimum: 1 },
  { title: '🇹🇷 GAİN', month: '2026-02', folder: 'Séries', minimum: 1 },
  { title: '🇹🇷 tabii', month: '2026-04', folder: 'Séries', minimum: 1 },
  { title: '🇹🇷 Bi Kanal', month: '2026-09', folder: 'Séries', minimum: 1 }
]) {
  const collection = trDedicated.find((entry) => entry.title === proof.title);
  const folder = collection?.folders?.find((entry) => entry.title === proof.folder);
  const source = folder?.sources?.find((entry) => String(entry.catalogId).endsWith(`-${proof.month}`));
  assert(source, `${proof.title}: missing ${proof.month} archive source`);
  const result = await request(catalogPath('tr', source), { attempts: 3 });
  assertOracleHeaders(result.response, `${proof.title}/${proof.month}`);
  assert(Array.isArray(result.data?.metas), `${proof.title}/${proof.month}: metas[] missing`);
  assert(result.data.metas.length >= proof.minimum, `${proof.title}/${proof.month}: expected >= ${proof.minimum}, got ${result.data.metas.length}`);
  for (const meta of result.data.metas.slice(0, 4)) {
    assertMetaBasics(meta, source.type, `${proof.title}/${proof.month}`);
  }
  console.log(`[TR PROOF] ${proof.title} ${proof.month} metas=${result.data.metas.length}`);
}

console.log('=== ANIME STANDARD + DESKTOP ===');
const animeStandard = standard.find((entry) => entry.title === '🌍 Anime Japon + Corée');
const animeDesktop = desktop.find((entry) => entry.title === '🌍 Anime Japon + Corée');
assert(animeStandard && animeDesktop, 'Anime Japon + Corée missing from standard/Desktop');
assert(
  JSON.stringify(normalizeCollectionShape(animeStandard)) === JSON.stringify(normalizeCollectionShape(animeDesktop)),
  'Anime standard/Desktop source topology mismatch'
);

async function validateAnimePayload(source, label) {
  const result = await request(catalogPath('global', source), { attempts: 3 });
  assertOracleHeaders(result.response, label);
  assert(Array.isArray(result.data?.metas), `${label}: metas[] missing`);
  for (const meta of result.data.metas.slice(0, 3)) {
    assertMetaBasics(meta, source.type, label);
    const urls = [meta.poster, meta.landscapePoster, meta.background, meta.banner].filter(Boolean);
    assert(urls.length >= 3, `${label}: insufficient cinematic artwork fields for ${meta.id}`);
    for (const value of urls) {
      const url = new URL(value);
      assert(url.origin === origin, `${label}: Anime artwork escaped Oracle origin: ${value}`);
      assert(url.pathname === '/global/desktop-content-card.jpg', `${label}: Anime artwork is not Shield cinematic: ${url.pathname}`);
      assert(url.searchParams.get('provider') === 'anime-asia', `${label}: provider != anime-asia`);
      assert(url.searchParams.get('design') === 'shield3', `${label}: design != shield3`);
    }
  }
  if (result.data.metas[0]) {
    await verifyVisual(result.data.metas[0].banner || result.data.metas[0].poster, `${label} cinematic image`, { shield: true });
  }
  console.log(`[ANIME] ${label} metas=${result.data.metas.length}`);
  return result.data.metas.length;
}

let animeLiveNonEmpty = 0;
for (const folder of animeStandard.folders || []) {
  const rolling = (folder.sources || []).slice(0, 5);
  for (const source of rolling) {
    const count = await validateAnimePayload(source, `${folder.title}/${source.catalogId}`);
    if (count) animeLiveNonEmpty += 1;
  }
}
assert(animeLiveNonEmpty > 0, 'All Anime rolling periods are empty');

const now = new Date();
const recentMonths = [];
for (let offset = 0; offset < 3; offset += 1) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
  recentMonths.push(d.toISOString().slice(0, 7));
}
let animeArchiveSeries = false;
let animeArchiveMovies = false;
for (const month of recentMonths) {
  if (!animeArchiveSeries) {
    const source = { type: 'series', catalogId: `archives-global-v1-series-anime-asia-${month}` };
    const count = await validateAnimePayload(source, `Anime archive Séries ${month}`);
    animeArchiveSeries = count > 0;
  }
  if (!animeArchiveMovies) {
    const source = { type: 'movie', catalogId: `archives-global-v1-movie-anime-asia-${month}` };
    const count = await validateAnimePayload(source, `Anime archive Films ${month}`);
    animeArchiveMovies = count > 0;
  }
}
assert(animeArchiveSeries, 'No populated recent Anime series archive validated');
assert(animeArchiveMovies, 'No populated recent Anime movie archive validated');
console.log('[ANIME ARCHIVES] Series + Films cinematic Shield validated');

console.log('=== FINAL ===');
console.log(JSON.stringify({
  ok: true,
  origin,
  runtime: oracleHealth.data.runtime,
  standardCollections: standard.length,
  desktopCollections: desktop.length,
  turkeyCollections: trDedicated.length,
  turkeyFolders,
  turkeySourceLinks: turkeySources,
  turkeyDynamicRoutesChecked: dynamicJobs.length,
  localTurkishServicesWithContent: localServicesWithContent,
  sSportLiveEvents: ssportMetas.length,
  recentArchiveTurkishServicesWithContent: archiveServicesWithContent,
  recentArchiveServiceStats: Object.fromEntries(archiveServiceStats),
  animeRollingNonEmptyChecks: animeLiveNonEmpty,
  animeArchiveSeries,
  animeArchiveMovies,
  requests: requestStats
}, null, 2));
