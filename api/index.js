'use strict';

const { titleSvg } = require('../runtime/collection-titles.cjs');
const fs = require('fs');
const path = require('path');

const usHandler = require('../regions/us/api/index');
const frHandler = require('../regions/fr/api/index');
const globalHandler = require('../regions/global/api/index');
const trHandler = require('../regions/tr/api/index');
const seriesHandler = require('../regions/series/index.cjs');
const moviesHandler = require('../regions/movies/index.cjs');
const { handleOriginalImage } = require('../regions/fr/api/original-images.cjs');
const { ADDON_ID: MOVIES_ADDON_ID, VERSION: MOVIES_VERSION } = require('../regions/movies/src/model.cjs');

const VERSION = '1.4.0';
const LARGE_JSON_CACHE = 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800';
const CINEMA_COLLECTION_CACHE = 'public, max-age=60, s-maxage=300, stale-while-revalidate=900';

function publicOriginFromRequest(req) {
  const raw = String(req?.headers?.['x-nuvio-public-origin'] || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return /^https?:$/.test(url.protocol) ? url.origin : null;
  } catch (_) {
    return null;
  }
}

function originFromRequest(req) {
  const publicOrigin = publicOriginFromRequest(req);
  if (publicOrigin) return publicOrigin;
  const proto = req?.headers?.['x-forwarded-proto'] || 'https';
  const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host || 'localhost';
  return `${proto}://${host}`;
}

function sendJson(res, status, body, cache = 'no-store') {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.end(JSON.stringify(body));
}

function sendHtml(res, body) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

async function delegate(req, res, prefix, handler) {
  const originalUrl = req.url;
  const originalHeaders = req.headers;
  let stripped = originalUrl.slice(prefix.length) || '/';
  stripped = stripped
    .replace(/^\/shield-folder-card\.jpg(?=\?|$)/, '/desktop-folder-card.jpg')
    .replace(/^\/shield-content-card\.jpg(?=\?|$)/, '/desktop-content-card.jpg')
    .replace(/^\/shield-genre-card\.jpg(?=\?|$)/, '/desktop-genre-card.jpg');
  req.url = stripped.startsWith('/') ? stripped : `/${stripped}`;
  req.headers = { ...originalHeaders, 'x-nuvio-base-path': prefix };
  try {
    return await handler(req, res);
  } finally {
    req.url = originalUrl;
    req.headers = originalHeaders;
  }
}


// Nuvio TV needs named manifest catalogs to render collection period rows.
// Previously catalogs: [] hid Home/Discover but silently replaced every label
// (Aujourd'hui, Octobre 2026, etc.) with generic "Films" / "Séries".
// Keep lightweight *named* descriptors with the same id/type and paging extras.
// NuvioTV's current client predicates:
//   Home: isSearchOnlyCatalog() => false, and explicit showInHome=false.
//   Search: isSearchable() rejects required non-search extras.
//   Discover: filters catalogs with a required 'search' extra.
//   Collections: findCollectionCatalog(type,id) uses catalog.name for row labels
//                and fetches data by unchanged direct catalog routes.
// Both required extras are display-only markers; underlying handlers do NOT
// require them, and original unmodified manifests remain available.
const COLLECTIONS_ONLY_HANDLERS = Object.freeze({
  fr: frHandler, us: usHandler, tr: trHandler, global: globalHandler,
  movies: moviesHandler, series: seriesHandler, 'series-v2': seriesHandler
});

function shieldCollectionOnlyCatalog(catalog) {
  const extra = Array.isArray(catalog.extra) ? catalog.extra : [];
  const skip = extra.find((item) => item.name === 'skip');
  return {
    type: catalog.type,
    id: catalog.id,
    name: catalog.name,
    pageSize: catalog.pageSize,
    showInHome: false,
    extraSupported: skip || (Array.isArray(catalog.extraSupported) && catalog.extraSupported.includes('skip'))
      ? ['skip', 'search', 'genre']
      : ['search', 'genre'],
    extra: [
      ...(skip ? [{ name: 'skip', isRequired: false }] : []),
      { name: 'search', isRequired: true },
      { name: 'genre', isRequired: true, options: [] }
    ]
  };
}

async function collectionsOnlyAddon(req, res, region, handler, pathname) {
  const prefix = `/${region}/collections-only`;
  if (pathname === `${prefix}/manifest.json`) {
    const canonicalOrigin = `${originFromRequest(req)}/${region}`;
    const now = handler._internals.runtimeNow?.() || new Date();
    const timeZone = handler._internals.requestTimeZone?.(req);
    const manifest = handler._internals.buildManifest(canonicalOrigin, now, timeZone);
    return sendJson(res, 200, {
      ...manifest,
      // Preserve exact catalog IDs + human-readable period names in Collections.
      // Do not publish them to Home, Search or Discover.
      catalogs: manifest.catalogs.map(shieldCollectionOnlyCatalog)
    }, 'no-store');
  }
  return delegate(req, res, prefix, handler);
}

// Opt-in compatibility profile for Nuvio Mobile / Desktop.
// Both clients (HomeCatalogDefinitions.kt) create Home rows for every
// manifest catalog with no required extras, ignoring showInHome=false.
// Their collection resolver, however, requires the catalog to be declared.
// A required "genre" extra with no options is the only required extra their
// collection editor permits and both SearchRepository implementations exclude
// from Discover. It keeps collection IDs registered but suppresses Home,
// Search and Discover loads; existing folders keep requesting canonical IDs
// without genre (all regional handlers accept this).
// Do not enable globally until Nuvio UI behavior is validated on devices.
function mobileDesktopCollectionManifest(manifest) {
  return {
    ...manifest,
    catalogs: manifest.catalogs.map((catalog) => {
      const originalExtra = Array.isArray(catalog.extra) ? catalog.extra : [];
      // SearchRepository.kt#supportsDiscover excludes required genre
      // descriptors with no options; #supportsSearch excludes required
      // non-search extras. CollectionCatalogResolver still finds the ID.
      const requiredGenre = { name: 'genre', isRequired: true, options: [] };
      const extra = [
        requiredGenre,
        ...originalExtra.filter((extra) => extra.name !== 'genre' && extra.name !== 'search')
      ];
      return {
        ...catalog,
        showInHome: false,
        extra,
        extraSupported: [...new Set([
          ...(Array.isArray(catalog.extraSupported) ? catalog.extraSupported : []),
          'genre'
        ])].filter((name) => name !== 'search')
      };
    })
  };
}

async function mobileDesktopCollectionsAddon(req, res, region, handler, pathname) {
  const prefix = `/${region}/mobile-desktop-collections`;
  if (pathname === `${prefix}/manifest.json`) {
    const canonicalOrigin = `${originFromRequest(req)}/${region}`;
    const now = handler._internals.runtimeNow?.() || new Date();
    const timeZone = handler._internals.requestTimeZone?.(req);
    const manifest = handler._internals.buildManifest(canonicalOrigin, now, timeZone);
    return sendJson(res, 200, mobileDesktopCollectionManifest(manifest), 'no-store');
  }
  return delegate(req, res, prefix, handler);
}

const GENERATED_COVER_REV = 'generated-v11-genre-photo-frames-period-labels';
const GENERATED_COVER_ROOT = path.resolve(__dirname, '../assets/generated-covers');

function generatedCoverStaticUrl(urlValue, folder = null, variant = 'card', mode = 'shield', collectionTitle = '') {
  const value = String(urlValue || '');
  if (!value) return null;
  let url;
  try { url = new URL(value); } catch (_) { return null; }
  // Force live-rendered artwork when the folder title itself must be baked into the card.
  if (url.searchParams.get('dynamic') === '1') return null;
  const region = url.pathname.match(/^\/(fr|global|tr|us)\//)?.[1];
  if (!region) return null;

  const genre = String(url.searchParams.get('genre') || '').trim().toLowerCase();
  if (/^[a-z0-9-]+$/.test(genre)) {
    const genreFile = variant === 'backdrop'
      ? `${genre}-hero.jpg`
      : `${genre}-${mode === 'desktop' ? 'desktop' : 'shield'}.jpg`;
    const genreLocal = path.join(GENERATED_COVER_ROOT, region, 'genres', genreFile);
    if (fs.existsSync(genreLocal)) {
      return `${url.origin}/static/assets/generated-covers/${region}/genres/${genreFile}?v=${GENERATED_COVER_REV}`;
    }
  }

  const provider = String(url.searchParams.get('provider') || '').trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(provider)) return null;
  const context = `${folder?.title || ''} ${collectionTitle || ''}`.toLowerCase();
  const type = context.includes('film') ? 'movie' : 'series';
  const file = variant === 'backdrop'
    ? (folder ? `${type}-hero.jpg` : 'hero.jpg')
    : `${type}-${mode === 'desktop' ? 'desktop' : 'shield'}.jpg`;
  const local = path.join(GENERATED_COVER_ROOT, region, provider, file);
  if (!fs.existsSync(local)) return null;

  return `${url.origin}/static/assets/generated-covers/${region}/${provider}/${file}?v=${GENERATED_COVER_REV}`;
}

function cleanVisualQuery(url, removeKeys) {
  let value = String(url || '');
  for (const key of removeKeys) {
    value = value.replace(new RegExp(`([?&])${key}=[^&]*`, 'g'), '$1');
  }
  return value
    .replace(/\?&/, '?')
    .replace(/&&+/g, '&')
    .replace(/[?&]+$/, '');
}

const DESKTOP_VISUAL_REV = 'desktop14-safe-badges';

function desktopCollectionVisualUrl(url, folder = null, variant = 'card', collectionTitle = '') {
  const generated = generatedCoverStaticUrl(url, folder, variant, 'desktop', collectionTitle);
  if (generated) return generated;
  const value = String(url || '');
  const typeContext = `${folder?.title || ''} ${collectionTitle || ''}`.toLowerCase();
  const type = typeContext.includes('film') ? 'movie' : 'series';

  if (value.includes('/platform-category-card.svg') || value.includes('/platform-card.jpg')) {
    const next = value
      .replace('/platform-category-card.svg', '/desktop-folder-card.jpg')
      .replace('/platform-card.jpg', '/desktop-folder-card.jpg');
    const cleaned = cleanVisualQuery(next, ['category', 'v']);
    const extra = new URLSearchParams({ type, v: DESKTOP_VISUAL_REV, title: folder?.title || '', label: collectionTitle || '' });
    return cleaned + (cleaned.includes('?') ? '&' : '?') + extra.toString();
  }

  if (value.includes('/genre-folder-art.svg') || value.includes('/genre-card.jpg')) {
    const next = value
      .replace('/genre-folder-art.svg', '/desktop-genre-card.jpg')
      .replace('/genre-card.jpg', '/desktop-genre-card.jpg');
    const colorMatch = value.match(/[?&]color=([^&]+)/);
    const cleaned = cleanVisualQuery(next, ['variant', 'label', 'type', 'icon', 'v', 'color']);
    const extra = new URLSearchParams({ type, v: DESKTOP_VISUAL_REV, title: folder?.title || '', label: collectionTitle || '' });
    if (colorMatch) {
      let color = colorMatch[1];
      try { color = decodeURIComponent(color); } catch {}
      extra.set('color', color);
    }
    return cleaned + (cleaned.includes('?') ? '&' : '?') + extra.toString();
  }

  if (variant === 'backdrop' && value.includes('/platform-backdrop.svg')) {
    const cleaned = cleanVisualQuery(value.replace('/platform-backdrop.svg', '/platform-backdrop.jpg'), ['v']);
    return cleaned + (cleaned.includes('?') ? '&' : '?') + `v=${DESKTOP_VISUAL_REV}`;
  }

  return value;
}

const SHIELD_VISUAL_REV = 'shield15-safe-badges';

function shieldCollectionVisualUrl(url, folder = null, variant = 'card', collectionTitle = '') {
  const generated = generatedCoverStaticUrl(url, folder, variant, 'shield', collectionTitle);
  if (generated) return generated;
  const value = String(url || '');
  const typeContext = `${folder?.title || ''} ${collectionTitle || ''}`.toLowerCase();
  const type = typeContext.includes('film') ? 'movie' : 'series';

  if (value.includes('/platform-category-card.svg') || value.includes('/platform-card.jpg')) {
    const next = value
      .replace('/platform-category-card.svg', '/shield-folder-card.jpg')
      .replace('/platform-card.jpg', '/shield-folder-card.jpg');
    const cleaned = cleanVisualQuery(next, ['category', 'v']);
    const extra = new URLSearchParams({ type, v: SHIELD_VISUAL_REV, title: folder?.title || '', label: collectionTitle || '' });
    return cleaned + (cleaned.includes('?') ? '&' : '?') + extra.toString();
  }

  if (value.includes('/genre-folder-art.svg') || value.includes('/genre-card.jpg')) {
    const next = value
      .replace('/genre-folder-art.svg', '/shield-genre-card.jpg')
      .replace('/genre-card.jpg', '/shield-genre-card.jpg');
    const colorMatch = value.match(/[?&]color=([^&]+)/);
    const cleaned = cleanVisualQuery(next, ['variant', 'label', 'type', 'icon', 'v', 'color']);
    const extra = new URLSearchParams({ type, v: SHIELD_VISUAL_REV, title: folder?.title || '', label: collectionTitle || '' });
    if (colorMatch) {
      let color = colorMatch[1];
      try { color = decodeURIComponent(color); } catch {}
      extra.set('color', color);
    }
    return cleaned + (cleaned.includes('?') ? '&' : '?') + extra.toString();
  }

  if (variant === 'backdrop' && value.includes('/platform-backdrop.svg')) {
    const cleaned = cleanVisualQuery(value.replace('/platform-backdrop.svg', '/platform-backdrop.jpg'), ['v']);
    return cleaned + (cleaned.includes('?') ? '&' : '?') + `v=${SHIELD_VISUAL_REV}`;
  }

  return value;
}

function shieldizeCollectionArt(collection) {
  const folders = (collection.folders || []).map((folder) => ({
    ...folder,
    coverImageUrl: shieldCollectionVisualUrl(folder.coverImageUrl, folder, 'card', collection.title),
    focusGifUrl: null,
    focusGifEnabled: false,
    hideTitle: true,
    heroBackdropUrl: shieldCollectionVisualUrl(folder.heroBackdropUrl, folder, 'backdrop', collection.title)
  }));
  return {
    ...collection,
    backdropImageUrl: shieldCollectionVisualUrl(collection.backdropImageUrl, null, 'backdrop', collection.title),
    folders
  };
}

function desktopizeCollectionArt(collection) {
  const folders = (collection.folders || []).map((folder) => ({
    ...folder,
    coverImageUrl: desktopCollectionVisualUrl(folder.coverImageUrl, folder, 'card', collection.title),
    focusGifUrl: null,
    focusGifEnabled: false,
    hideTitle: false,
    heroBackdropUrl: desktopCollectionVisualUrl(folder.heroBackdropUrl, folder, 'backdrop', collection.title),
    titleLogoUrl: null
  }));
  return {
    ...collection,
    backdropImageUrl: desktopCollectionVisualUrl(collection.backdropImageUrl, null, 'backdrop', collection.title),
    folders
  };
}

function combinedDesktopCollections(req) {
  return combinedRawCollections(req).map(desktopizeCollectionArt);
}

function combinedCollections(req) {
  return combinedRawCollections(req).map(shieldizeCollectionArt);
}

function mobileizeCollectionArt(collection) {
  const base = shieldizeCollectionArt(collection);
  return {
    ...base,
    // Mobile FOLLOW_LAYOUT renders one poster row per period at the same time.
    // A tabbed grid exposes the period names and paints posters for only the
    // selected tab; source IDs, ordering and date range are unchanged.
    viewMode: 'TABBED_GRID',
    showAllTab: false,
    folders: base.folders.map((folder) => ({ ...folder, hideTitle: false }))
  };
}

function combinedMobileCollections(req) {
  return combinedRawCollections(req).map(mobileizeCollectionArt);
}

async function cinemaAvailableKeys(req) {
  try {
    const now = frHandler._internals.runtimeNow();
    const timeZone = frHandler._internals.requestTimeZone(req);
    const keys = await frHandler._internals.cinemaAvailableBucketKeys(timeZone, now);
    // Live imports must fail closed: if availability cannot be evaluated,
    // do not expose clickable Cinema folders that may be empty.
    return keys instanceof Set ? keys : new Set();
  } catch (error) {
    console.error('[cinema-collection-availability]', error);
    return new Set();
  }
}

async function combinedRawCollectionsLive(req) {
  // The legacy Torrentio Cinema parent remains callable for backwards compatibility,
  // but it is no longer injected into combined imports. The editorial France
  // collection owns the current-cinema folder now, so all aliases share one
  // deterministic collection payload.
  return combinedRawCollections(req);
}

async function combinedCollectionsLive(req) {
  return (await combinedRawCollectionsLive(req)).map(shieldizeCollectionArt);
}

async function combinedDesktopCollectionsLive(req) {
  return (await combinedRawCollectionsLive(req)).map(desktopizeCollectionArt);
}

function cinemaTorrentioCollection(req, availableKeys = null) {
  const origin = originFromRequest(req);
  const frOrigin = `${origin}/fr`;
  const buckets = [
    { key: 'nowplaying', title: 'À l’affiche' },
    { key: 'recent', title: 'Sorties cinéma récentes' },
    { key: 'today', title: 'Aujourd’hui' },
    { key: 'yesterday', title: 'Hier' },
    { key: 'thisweek', title: 'Cette semaine' },
    { key: 'lastweek', title: 'Semaine dernière' },
    { key: 'thismonth', title: 'Ce mois-ci' },
    { key: 'previousmonth', title: 'Mois dernier' },
    { key: 'nextweek', title: 'Semaine prochaine' },
    { key: 'nextmonth', title: 'Mois prochain' }
  ];

  const visibleBuckets = availableKeys instanceof Set
    ? buckets.filter(({ key }) => availableKeys.has(key))
    : buckets;

  const folders = visibleBuckets.map(({ key, title }) => {
    const source = {
      provider: 'addon',
      addonId: 'com.nuvio.calendar.archives.fr.coexist',
      type: 'movie',
      catalogId: `cinema-torrentio-${key}`
    };
    const art = `${frOrigin}/platform-category-card.svg?provider=vod-fr&category=films&dynamic=1&color=%23e11d48&v=cinema-torrentio-v3`;
    return {
      id: `cinema-now-${key}`,
      title,
      coverImageUrl: art,
      focusGifEnabled: false,
      coverEmoji: '🎬',
      tileShape: 'LANDSCAPE',
      hideTitle: false,
      heroBackdropUrl: `${frOrigin}/platform-backdrop.svg?provider=vod-fr&type=movie&v=cinema-torrentio-v3`,
      heroVideoUrl: null,
      titleLogoUrl: `${frOrigin}/platform-logo?provider=cinema-torrentio&type=movie&v=cinema-torrentio-v3`,
      sources: [source],
      catalogSources: [{ addonId: source.addonId, type: source.type, catalogId: source.catalogId }]
    };
  });

  return {
    id: 'cinema-now-torrentio',
    title: '🎬 Cinéma du moment',
    backdropImageUrl: `${frOrigin}/platform-backdrop.svg?provider=vod-fr&type=movie&v=cinema-torrentio-v3`,
    pinToTop: true,
    focusGlowEnabled: true,
    viewMode: 'FOLLOW_LAYOUT',
    showAllTab: false,
    folders
  };
}

function combinedRawCollections(req, cinemaKeys = null) {
  const origin = originFromRequest(req);
  const nowUs = usHandler._internals.runtimeNow();
  const nowFr = frHandler._internals.runtimeNow();
  const nowGlobal = globalHandler._internals.runtimeNow();
  const nowTr = trHandler._internals.runtimeNow();
  const usTz = usHandler._internals.requestTimeZone(req);
  const frTz = frHandler._internals.requestTimeZone(req);
  const globalTz = globalHandler._internals.requestTimeZone(req);
  const trTz = trHandler._internals.requestTimeZone(req);

  const frCollections = frHandler._internals.buildNuvioCollectionsImport(nowFr, frTz, `${origin}/fr`)
    .map((collection) => ({ ...collection, pinToTop: true }));
  const globalCollections = globalHandler._internals.buildNuvioCollectionsImport(nowGlobal, globalTz, `${origin}/global`)
    .map((collection) => ({ ...collection, pinToTop: true }));
  const trCollections = trHandler._internals.buildNuvioCollectionsImport(nowTr, trTz, `${origin}/tr`)
    .map((collection) => ({ ...collection, pinToTop: true }));
  const usCollections = usHandler._internals.buildNuvioCollectionsImport(nowUs, usTz, `${origin}/us`)
    .map((collection) => ({ ...collection, pinToTop: false }));

  // Keep all regional/global VOD views:
  // 🇫🇷 VOD France = first Digital release in FR
  // 🌍 VOD Mondiale = first Digital release in any country
  // 🇺🇸 VOD = first Digital release in US
  // Do not inject the legacy top-level Cinema parent here. It caused the
  // standard/Shield/Desktop aliases to disagree while availability was changing.
  // Current cinema is now the "🎬 Films au cinéma actuellement" folder inside
  // the France editorial collection.
  return [...frCollections, ...globalCollections, ...trCollections, ...usCollections];
}

function coexistenceReport(req, collectionsOverride = null) {
  const origin = originFromRequest(req);
  const usManifest = usHandler._internals.buildManifest(`${origin}/us`, usHandler._internals.runtimeNow(), usHandler._internals.requestTimeZone(req));
  const frManifest = frHandler._internals.buildManifest(`${origin}/fr`, frHandler._internals.runtimeNow(), frHandler._internals.requestTimeZone(req));
  const globalManifest = globalHandler._internals.buildManifest(`${origin}/global`, globalHandler._internals.runtimeNow(), globalHandler._internals.requestTimeZone(req));
  const trManifest = trHandler._internals.buildManifest(`${origin}/tr`, trHandler._internals.runtimeNow(), trHandler._internals.requestTimeZone(req));
  const collections = collectionsOverride || combinedCollections(req);
  const collectionIds = collections.map((c) => c.id);
  const folderKeys = collections.flatMap((c) => c.folders.map((f) => `${c.id}/${f.id}`));
  const usCatalogIds = usManifest.catalogs.map((c) => `${usManifest.id}:${c.type}:${c.id}`);
  const frCatalogIds = frManifest.catalogs.map((c) => `${frManifest.id}:${c.type}:${c.id}`);
  const globalCatalogIds = globalManifest.catalogs.map((c) => `${globalManifest.id}:${c.type}:${c.id}`);
  const trCatalogIds = trManifest.catalogs.map((c) => `${trManifest.id}:${c.type}:${c.id}`);
  const duplicates = (values) => [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
  const addonIds = [frManifest.id, globalManifest.id, trManifest.id, usManifest.id];
  const duplicateCatalogKeys = duplicates([...frCatalogIds, ...globalCatalogIds, ...trCatalogIds, ...usCatalogIds]);
  return {
    version: VERSION,
    mode: 'single-deployment-four-addon',
    addonIds,
    manifestUrls: [`${origin}/fr/manifest.json`, `${origin}/global/manifest.json`, `${origin}/tr/manifest.json`, `${origin}/us/manifest.json`],
    combinedCollectionsUrl: `${origin}/nuvio-collections-fr-global-tr-usa.json`,
    collectionCount: collections.length,
    frCollectionCount: collections.filter((c) => c.title.startsWith('🇫🇷') || c.id === 'cinema-now-torrentio').length,
    globalCollectionCount: collections.filter((c) => c.title.startsWith('🌍')).length,
    trCollectionCount: collections.filter((c) => c.title.startsWith('🇹🇷')).length,
    usCollectionCount: collections.filter((c) => c.title.startsWith('🇺🇸')).length,
    duplicateCollectionIds: duplicates(collectionIds),
    duplicateFolderKeys: duplicates(folderKeys),
    duplicateCatalogKeys,
    safe: duplicates(collectionIds).length === 0 &&
      duplicates(folderKeys).length === 0 &&
      duplicateCatalogKeys.length === 0 &&
      new Set(addonIds).size === addonIds.length
  };
}

async function coexistenceReportLive(req) {
  const collections = await combinedCollectionsLive(req);
  return coexistenceReport(req, collections);
}

function landing(req) {
  const origin = originFromRequest(req);
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nuvio France + Türkiye + Cinéma Total + Anime/VOD + USA</title><style>body{margin:0;background:#05080f;color:#eef4ff;font-family:system-ui,sans-serif;min-height:100vh;display:grid;place-items:center}.card{max-width:960px;margin:24px;padding:32px;border:1px solid #243247;border-radius:24px;background:#0b111b}h1{margin-top:0}code{display:block;padding:12px;margin:8px 0;background:#02050a;border-radius:10px;overflow-wrap:anywhere}.ok{color:#77e1a6}a{color:#72c7ff}</style></head><body><main class="card"><h1>🇫🇷 France · 🌍 Anime + VOD · 🇹🇷 Türkiye · 🇺🇸 USA</h1><p>Une seule production Oracle avec <b>quatre addons isolés</b>. Les VOD régionales sont conservées et la VOD Mondiale est ajoutée en plus.</p><p>1. France :</p><code>${origin}/fr/manifest.json</code><p>2. VOD Mondiale :</p><code>${origin}/global/manifest.json</code><p>3. Türkiye :</p><code>${origin}/tr/manifest.json</code><p>4. USA :</p><code>${origin}/us/manifest.json</code><p>5. Collections combinées :</p><code>${origin}/nuvio-collections-fr-global-tr-usa.json</code><p><a href="${origin}/coexistence-check.json">Vérification automatique des collisions</a></p><p class="ok">Ordre Modern Shield : 🇫🇷 France, puis 🌍 Global, puis 🇹🇷 Türkiye, puis 🇺🇸 USA.</p></main></body></html>`;
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, originFromRequest(req));
  const path = url.pathname;

  if (path === '/collection-title.svg') {
    const svg = titleSvg(url.searchParams.get('title'), url.searchParams.get('label'));
    if (!svg) return sendJson(res, 400, {error:'Titre manquant'});
    res.statusCode=200;res.setHeader('Content-Type','image/svg+xml; charset=utf-8');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Cache-Control','public, max-age=604800');
    return res.end(svg);
  }

  if (/^\/images\/original\.(?:jpg|png)$/.test(path)) return handleOriginalImage(req, res, url);

  if (path === '/' || path === '/index.html') return sendHtml(res, landing(req));
  if (path === '/health') {
    const report = await coexistenceReportLive(req);
    return sendJson(res, report.safe ? 200 : 500, { ok: report.safe, ...report }, 'no-store');
  }
  if (path === '/coexistence-check.json') return sendJson(res, 200, await coexistenceReportLive(req), 'no-store');
  if (path === '/nuvio-collections-fr-global-tr-usa.json' || path === '/nuvio-collections-shield.json' || path === '/nuvio-collections-fr-global-usa.json' || path === '/nuvio-collections-usa-fr.json' || path === '/collections.json') {
    return sendJson(res, 200, await combinedCollectionsLive(req), CINEMA_COLLECTION_CACHE);
  }
  if (path === '/nuvio-collections-desktop.json') {
    return sendJson(res, 200, await combinedDesktopCollectionsLive(req), CINEMA_COLLECTION_CACHE);
  }
  if (path === '/nuvio-collections-mobile.json') {
    return sendJson(res, 200, combinedMobileCollections(req), CINEMA_COLLECTION_CACHE);
  }
  if (path === '/nuvio-collections-movies-mobile.json' ||
      path === '/nuvio-collections-series-mobile.json' ||
      path === '/nuvio-collections-series-v2-mobile.json') {
    const origin = originFromRequest(req);
    const movies = path.includes('movies');
    const seriesRoute = path.includes('series-v2') ? 'series-v2' : 'series';
    const collections = movies
      ? moviesHandler._internals.buildCollections(`${origin}/movies`, new Date(), 'shield')
      : seriesHandler._internals.buildCollections(`${origin}/${seriesRoute}`, new Date(), 'shield');
    return sendJson(res, 200, collections.map(mobileizeCollectionArt), CINEMA_COLLECTION_CACHE);
  }
  if (path === '/nuvio-collections-global.json') {
    const origin = originFromRequest(req);
    return sendJson(
      res,
      200,
      globalHandler._internals.buildNuvioCollectionsImport(
        globalHandler._internals.runtimeNow(),
        globalHandler._internals.requestTimeZone(req),
        `${origin}/global`
      ).map(shieldizeCollectionArt),
      LARGE_JSON_CACHE
    );
  }
  if (path === '/nuvio-collections-tr.json' || path === '/nuvio-collections-turkiye.json') {
    const origin = originFromRequest(req);
    return sendJson(
      res,
      200,
      trHandler._internals.buildNuvioCollectionsImport(
        trHandler._internals.runtimeNow(),
        trHandler._internals.requestTimeZone(req),
        `${origin}/tr`
      ).map(shieldizeCollectionArt),
      LARGE_JSON_CACHE
    );
  }
  if (path === '/install.json') {
    const origin = originFromRequest(req);
    return sendJson(res, 200, {
      version: VERSION,
      seriesAddonId: seriesHandler._internals.releaseForOrigin(`${origin}/series-v2`).id,
      seriesVersion: seriesHandler._internals.releaseForOrigin(`${origin}/series-v2`).version,
      seriesManifest: `${origin}/series-v2/manifest.json`,
      seriesCollections: `${origin}/series-v2/nuvio-collections.json`,
      seriesDesktopCollections: `${origin}/series-v2/nuvio-collections-desktop.json`,
      seriesStatus: `${origin}/series-v2/status.json`,
      seriesLegacyManifest: `${origin}/series/manifest.json`,
      moviesAddonId: MOVIES_ADDON_ID,
      moviesVersion: MOVIES_VERSION,
      moviesManifest: `${origin}/movies/manifest.json`,
      moviesCollections: `${origin}/movies/nuvio-collections.json`,
      moviesDesktopCollections: `${origin}/movies/nuvio-collections-desktop.json`,
      moviesStatus: `${origin}/movies/status.json`,
      franceManifest: `${origin}/fr/manifest.json`,
      globalManifest: `${origin}/global/manifest.json`,
      turkeyManifest: `${origin}/tr/manifest.json`,
      usaManifest: `${origin}/us/manifest.json`,
      globalCollections: `${origin}/nuvio-collections-global.json`,
      turkeyCollections: `${origin}/nuvio-collections-tr.json`,
      combinedCollections: `${origin}/nuvio-collections-fr-global-tr-usa.json`,
      shieldCollections: `${origin}/nuvio-collections-shield.json`,
      desktopCollections: `${origin}/nuvio-collections-desktop.json`,
      check: `${origin}/coexistence-check.json`
    }, 'no-store');
  }
  if (path === '/nuvio-collections-series.json' || path === '/nuvio-collections-series-desktop.json') {
    const origin = originFromRequest(req);
    return sendJson(res, 200, seriesHandler._internals.buildCollections(`${origin}/series`, new Date(), path.includes('desktop') ? 'desktop' : 'shield'), LARGE_JSON_CACHE);
  }
  if (path === '/nuvio-collections-movies.json' || path === '/nuvio-collections-movies-desktop.json') {
    const origin = originFromRequest(req);
    return sendJson(res, 200, moviesHandler._internals.buildCollections(`${origin}/movies`, new Date(), path.includes('desktop') ? 'desktop' : 'shield'), 'no-store');
  }
  // Mobile and Desktop: preserve catalog registration for collection lookup
  // while suppressing automatic Home fetching in both client repositories.
  const mobileDesktopRoute = path.match(new RegExp('^/(fr|us|tr|global|movies|series(?:-v2)?)/mobile-desktop-collections(?:/|$)'));
  if (mobileDesktopRoute) {
    const region = mobileDesktopRoute[1];
    return mobileDesktopCollectionsAddon(req, res, region, COLLECTIONS_ONLY_HANDLERS[region], path);
  }
  // Opt-in Android TV install endpoints (no changes to existing addon URLs).
  const collectionsOnlyRoute = path.match(new RegExp('^/(fr|us|tr|global|movies|series(?:-v2)?)/collections-only(?:/|$)'));
  if (collectionsOnlyRoute) {
    const region = collectionsOnlyRoute[1];
    return collectionsOnlyAddon(req, res, region, COLLECTIONS_ONLY_HANDLERS[region], path);
  }
  if (path === '/movies' || path.startsWith('/movies/')) return delegate(req, res, '/movies', moviesHandler);
  if (path === '/series-v2' || path.startsWith('/series-v2/')) return delegate(req, res, '/series-v2', seriesHandler);
  if (path === '/series' || path.startsWith('/series/')) return delegate(req, res, '/series', seriesHandler);
  if (path === '/global' || path.startsWith('/global/')) return delegate(req, res, '/global', globalHandler);
  if (path === '/tr' || path.startsWith('/tr/')) return delegate(req, res, '/tr', trHandler);
  if (path === '/us' || path.startsWith('/us/')) return delegate(req, res, '/us', usHandler);
  if (path === '/fr' || path.startsWith('/fr/')) return delegate(req, res, '/fr', frHandler);
  return sendJson(res, 404, { error: 'Route inconnue.', france: '/fr/manifest.json', global: '/global/manifest.json', turkiye: '/tr/manifest.json', usa: '/us/manifest.json' }, 'no-store');
};

module.exports._internals = {
  VERSION,
  originFromRequest,
  publicOriginFromRequest,
  combinedCollections,
  combinedRawCollections,
  combinedMobileCollections,
  mobileizeCollectionArt,
  combinedDesktopCollections,
  combinedRawCollectionsLive,
  combinedCollectionsLive,
  combinedDesktopCollectionsLive,
  cinemaAvailableKeys,
  cinemaTorrentioCollection,
  shieldizeCollectionArt,
  shieldCollectionVisualUrl,
  generatedCoverStaticUrl,
  desktopizeCollectionArt,
  coexistenceReport,
  coexistenceReportLive,
  delegate,
  mobileDesktopCollectionManifest,
  shieldCollectionOnlyCatalog,
  usHandler,
  frHandler,
  globalHandler,
  trHandler
};
