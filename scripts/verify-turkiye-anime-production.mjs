#!/usr/bin/env node

const origin = new URL(process.env.PUBLIC_ORIGIN || 'https://141-145-215-202.nip.io').origin;
const timeoutMs = Number(process.env.VERIFY_TIMEOUT_MS || 30000);

async function request(pathOrUrl, { json = true, attempts = 3, allowHttpError = false } = {}) {
  const url = new URL(pathOrUrl, origin);
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: json ? 'application/json' : 'image/jpeg,image/*;q=.9,*/*;q=.8', 'user-agent': 'NuvioTurkeyAnimeVerify/1.0' }
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      const text = new TextDecoder().decode(bytes);
      if (!response.ok && !allowHttpError) {
        throw new Error(`${url.pathname} HTTP ${response.status}: ${text.slice(0, 500)}`);
      }
      if (!json) return { response, bytes, text };
      let data;
      try { data = JSON.parse(text); } catch { data = null; }
      return { response, data, bytes, text };
    } catch (error) {
      last = error;
      if (attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    } finally {
      clearTimeout(timer);
    }
  }
  throw last;
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

function catalogPath(region, source) {
  return `/${region}/catalog/${source.type}/${encodeURIComponent(source.catalogId)}.json`;
}

const healthProbe = await request('/tr/health', { allowHttpError: true, attempts: 2 });
const health = healthProbe.data || {};
console.log('[TR HEALTH]', healthProbe.response.status, JSON.stringify({
  ok: health.ok,
  tmdb: health.tmdb,
  tvmaze: health.tvmaze,
  anilist: health.anilist,
  providers: health.providers || null,
  tmdbStatus: health.tmdbStatus || null
}));
if (healthProbe.response.status >= 500) {
  console.log('[TR HEALTH WARNING] Provider health probe is degraded; catalog routes will be tested directly.');
}

const trCollections = (await request('/tr/nuvio-collections.json')).data;
assert(Array.isArray(trCollections), 'Türkiye collections are not an array');
assert(trCollections.length === 18, `Expected 18 Türkiye collections, got ${trCollections.length}`);

const titles = trCollections.map((collection) => collection.title);
for (const required of [
  '🇹🇷 Netflix', '🇹🇷 Max', '🇹🇷 Exxen', '🇹🇷 GAİN', '🇹🇷 tabii', '🇹🇷 TOD',
  '🇹🇷 puhutv', '🇹🇷 TV+', '🇹🇷 Tivibu', '🇹🇷 D-Smart GO', '🇹🇷 S Sport Plus',
  '🇹🇷 Crunchyroll + AniList', '🇹🇷 Türkiye Takvim', '🇹🇷 VOD Türkiye'
]) {
  assert(titles.includes(required), `Missing Türkiye collection: ${required}`);
}

let trRoutes = 0;
for (const collection of trCollections) {
  assert(Array.isArray(collection.folders) && collection.folders.length > 0, `${collection.title} has no folders`);
  const folder = collection.folders[0];
  assert(folder.sources?.[0]?.catalogId?.endsWith('-today'), `${collection.title} does not start with Today`);
  assert(folder.sources?.[1]?.catalogId?.endsWith('-tomorrow'), `${collection.title} does not keep Tomorrow second`);
  const payload = (await request(catalogPath('tr', folder.sources[0]), { attempts: 2 })).data;
  assert(Array.isArray(payload?.metas), `${collection.title} Today did not return metas[]`);
  trRoutes += 1;
  console.log('[TR]', collection.title, folder.title, 'today metas=' + payload.metas.length);
}

// Explicitly validate Tomorrow for local Turkish services.
for (const title of ['🇹🇷 Exxen','🇹🇷 GAİN','🇹🇷 tabii','🇹🇷 TOD','🇹🇷 puhutv','🇹🇷 TV+','🇹🇷 Tivibu','🇹🇷 D-Smart GO','🇹🇷 S Sport Plus','🇹🇷 Crunchyroll + AniList']) {
  const collection = trCollections.find((entry) => entry.title === title);
  const source = collection?.folders?.[0]?.sources?.[1];
  assert(source, `${title} Tomorrow source missing`);
  const payload = (await request(catalogPath('tr', source), { attempts: 2 })).data;
  assert(Array.isArray(payload?.metas), `${title} Tomorrow did not return metas[]`);
  trRoutes += 1;
  console.log('[TR TOMORROW]', title, 'metas=' + payload.metas.length);
}

const desktop = (await request('/nuvio-collections-desktop.json')).data;
assert(Array.isArray(desktop), 'Desktop collections are not an array');
assert(desktop.length === 48, `Expected 48 Desktop collections, got ${desktop.length}`);

const crunchyDesktop = desktop.find((collection) => collection.title === '🇹🇷 Crunchyroll + AniList');
assert(crunchyDesktop, 'Crunchyroll Türkiye missing from Desktop collections');
const crunchyCover = crunchyDesktop.folders?.[0]?.coverImageUrl;
assert(crunchyCover, 'Crunchyroll Türkiye Desktop cover is missing');
const crunchyUrl = new URL(crunchyCover);
assert(crunchyUrl.origin === origin, 'Crunchyroll cover escaped Oracle origin');
assert(crunchyUrl.pathname === '/tr/desktop-folder-card.jpg', 'Crunchyroll cover is not the cinematic Desktop route');
const crunchyImage = await request(crunchyUrl, { json: false });
assert((crunchyImage.response.headers.get('content-type') || '').includes('image/jpeg'), 'Crunchyroll cover is not JPEG');
assert(crunchyImage.bytes.byteLength > 5000, 'Crunchyroll cover is unexpectedly small');
console.log('[TR ART] Crunchyroll cinematic bytes=' + crunchyImage.bytes.byteLength);

const globalCollections = (await request('/global/nuvio-collections.json')).data;
const anime = globalCollections.find((collection) => collection.title === '🌍 Anime Japon + Corée');
assert(anime, 'Global Anime Japon + Corée collection missing');
const animeSeries = anime.folders.find((folder) => folder.title === 'Séries');
assert(animeSeries, 'Anime Series folder missing');

let liveAnimeValidated = false;
for (const source of animeSeries.sources.slice(0, 5)) {
  const payload = (await request(catalogPath('global', source), { attempts: 2 })).data;
  if (!Array.isArray(payload?.metas) || payload.metas.length === 0) continue;
  const meta = payload.metas.find((entry) => entry.banner) || payload.metas[0];
  const banner = new URL(meta.banner);
  assert(banner.origin === origin, 'Anime banner escaped Oracle origin');
  assert(banner.pathname === '/global/desktop-content-card.jpg', 'Anime banner is not cinematic Desktop');
  assert(banner.searchParams.get('provider') === 'anime-asia', 'Anime banner provider is not anime-asia');
  assert(banner.searchParams.get('design') === 'shield3', 'Anime banner is not Shield3');
  const image = await request(banner, { json: false });
  assert((image.response.headers.get('content-type') || '').includes('image/jpeg'), 'Anime banner is not JPEG');
  assert(image.bytes.byteLength > 5000, 'Anime banner is unexpectedly small');
  console.log('[ANIME LIVE]', source.catalogId, 'metas=' + payload.metas.length, 'bytes=' + image.bytes.byteLength);
  liveAnimeValidated = true;
  break;
}
assert(liveAnimeValidated, 'No populated live Anime period was available to validate');

// Current/previous month archive must also publish the same cinematic banner when populated.
const now = new Date();
const months = [];
for (let offset = 0; offset < 3; offset += 1) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
  months.push(d.toISOString().slice(0, 7));
}
let archiveChecked = false;
for (const month of months) {
  const id = `archives-global-v1-series-anime-asia-${month}`;
  const payload = (await request(`/global/catalog/series/${encodeURIComponent(id)}.json`, { attempts: 2 })).data;
  if (!Array.isArray(payload?.metas) || payload.metas.length === 0) continue;
  const meta = payload.metas.find((entry) => entry.banner);
  assert(meta?.banner, `Anime archive ${month} has content but no Desktop banner`);
  const banner = new URL(meta.banner);
  assert(banner.pathname === '/global/desktop-content-card.jpg', `Anime archive ${month} fell back to raw artwork`);
  assert(banner.searchParams.get('provider') === 'anime-asia', `Anime archive ${month} provider mismatch`);
  assert(banner.searchParams.get('design') === 'shield3', `Anime archive ${month} design mismatch`);
  console.log('[ANIME ARCHIVE]', month, 'metas=' + payload.metas.length);
  archiveChecked = true;
  break;
}
assert(archiveChecked, 'No populated recent Anime archive month was available to validate');

console.log(JSON.stringify({
  ok: true,
  origin,
  turkeyCollections: trCollections.length,
  desktopCollections: desktop.length,
  turkeyCatalogRoutesChecked: trRoutes,
  crunchyrollCinematic: true,
  animeLiveCinematic: true,
  animeArchiveCinematic: true
}, null, 2));
