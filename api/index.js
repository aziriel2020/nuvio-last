'use strict';

const usHandler = require('../regions/us/api/index');
const frHandler = require('../regions/fr/api/index');
const globalHandler = require('../regions/global/api/index');
const trHandler = require('../regions/tr/api/index');

const VERSION = '1.4.0';

function originFromRequest(req) {
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
  const stripped = originalUrl.slice(prefix.length) || '/';
  req.url = stripped.startsWith('/') ? stripped : `/${stripped}`;
  req.headers = { ...originalHeaders, 'x-nuvio-base-path': prefix };
  try {
    return await handler(req, res);
  } finally {
    req.url = originalUrl;
    req.headers = originalHeaders;
  }
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

function desktopCollectionVisualUrl(url, folder = null, variant = 'card', collectionTitle = '') {
  const value = String(url || '');
  const type = String(folder?.title || '').toLowerCase().includes('film') ? 'movie' : 'series';

  if (value.includes('/platform-category-card.svg') || value.includes('/platform-card.jpg')) {
    const next = value
      .replace('/platform-category-card.svg', '/desktop-folder-card.jpg')
      .replace('/platform-card.jpg', '/desktop-folder-card.jpg');
    const cleaned = cleanVisualQuery(next, ['category', 'v']);
    const extra = new URLSearchParams({ type, v: 'desktop3', title: folder?.title || '', label: collectionTitle || '' });
    return cleaned + (cleaned.includes('?') ? '&' : '?') + extra.toString();
  }

  if (value.includes('/genre-folder-art.svg') || value.includes('/genre-card.jpg')) {
    const next = value
      .replace('/genre-folder-art.svg', '/desktop-genre-card.jpg')
      .replace('/genre-card.jpg', '/desktop-genre-card.jpg');
    const colorMatch = value.match(/[?&]color=([^&]+)/);
    const cleaned = cleanVisualQuery(next, ['variant', 'label', 'type', 'icon', 'v', 'color']);
    const extra = new URLSearchParams({ type, v: 'desktop3', title: folder?.title || '', label: collectionTitle || '' });
    if (colorMatch) extra.set('color', colorMatch[1]);
    return cleaned + (cleaned.includes('?') ? '&' : '?') + extra.toString();
  }

  if (variant === 'backdrop' && value.includes('/platform-backdrop.svg')) {
    return cleanVisualQuery(value.replace('/platform-backdrop.svg', '/platform-backdrop.jpg'), ['type', 'v']);
  }

  return value;
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
  return combinedCollections(req).map(desktopizeCollectionArt);
}

function combinedCollections(req) {
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
  return [...frCollections, ...globalCollections, ...trCollections, ...usCollections];
}

function coexistenceReport(req) {
  const origin = originFromRequest(req);
  const usManifest = usHandler._internals.buildManifest(`${origin}/us`, usHandler._internals.runtimeNow(), usHandler._internals.requestTimeZone(req));
  const frManifest = frHandler._internals.buildManifest(`${origin}/fr`, frHandler._internals.runtimeNow(), frHandler._internals.requestTimeZone(req));
  const globalManifest = globalHandler._internals.buildManifest(`${origin}/global`, globalHandler._internals.runtimeNow(), globalHandler._internals.requestTimeZone(req));
  const trManifest = trHandler._internals.buildManifest(`${origin}/tr`, trHandler._internals.runtimeNow(), trHandler._internals.requestTimeZone(req));
  const collections = combinedCollections(req);
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
    frCollectionCount: collections.filter((c) => c.title.startsWith('🇫🇷')).length,
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

function landing(req) {
  const origin = originFromRequest(req);
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nuvio France + Türkiye + Cinéma Total + Anime/VOD + USA</title><style>body{margin:0;background:#05080f;color:#eef4ff;font-family:system-ui,sans-serif;min-height:100vh;display:grid;place-items:center}.card{max-width:960px;margin:24px;padding:32px;border:1px solid #243247;border-radius:24px;background:#0b111b}h1{margin-top:0}code{display:block;padding:12px;margin:8px 0;background:#02050a;border-radius:10px;overflow-wrap:anywhere}.ok{color:#77e1a6}a{color:#72c7ff}</style></head><body><main class="card"><h1>🇫🇷 France · 🌍 Anime + VOD · 🇹🇷 Türkiye · 🇺🇸 USA</h1><p>Un seul déploiement Vercel avec <b>quatre addons isolés</b>. Les VOD régionales sont conservées et la VOD Mondiale est ajoutée en plus.</p><p>1. France :</p><code>${origin}/fr/manifest.json</code><p>2. VOD Mondiale :</p><code>${origin}/global/manifest.json</code><p>3. Türkiye :</p><code>${origin}/tr/manifest.json</code><p>4. USA :</p><code>${origin}/us/manifest.json</code><p>5. Collections combinées :</p><code>${origin}/nuvio-collections-fr-global-tr-usa.json</code><p><a href="${origin}/coexistence-check.json">Vérification automatique des collisions</a></p><p class="ok">Ordre Modern Shield : 🇫🇷 France, puis 🌍 Global, puis 🇹🇷 Türkiye, puis 🇺🇸 USA.</p></main></body></html>`;
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, originFromRequest(req));
  const path = url.pathname;

  if (path === '/' || path === '/index.html') return sendHtml(res, landing(req));
  if (path === '/health') {
    const report = coexistenceReport(req);
    return sendJson(res, report.safe ? 200 : 500, { ok: report.safe, ...report }, 'no-store');
  }
  if (path === '/coexistence-check.json') return sendJson(res, 200, coexistenceReport(req), 'no-store');
  if (path === '/nuvio-collections-fr-global-tr-usa.json' || path === '/nuvio-collections-fr-global-usa.json' || path === '/nuvio-collections-usa-fr.json' || path === '/collections.json') {
    return sendJson(res, 200, combinedCollections(req), 'no-store');
  }
  if (path === '/nuvio-collections-desktop.json') {
    return sendJson(res, 200, combinedDesktopCollections(req), 'no-store');
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
      ),
      'no-store'
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
      ),
      'no-store'
    );
  }
  if (path === '/install.json') {
    const origin = originFromRequest(req);
    return sendJson(res, 200, {
      version: VERSION,
      franceManifest: `${origin}/fr/manifest.json`,
      globalManifest: `${origin}/global/manifest.json`,
      turkeyManifest: `${origin}/tr/manifest.json`,
      usaManifest: `${origin}/us/manifest.json`,
      globalCollections: `${origin}/nuvio-collections-global.json`,
      turkeyCollections: `${origin}/nuvio-collections-tr.json`,
      combinedCollections: `${origin}/nuvio-collections-fr-global-tr-usa.json`,
      desktopCollections: `${origin}/nuvio-collections-desktop.json`,
      check: `${origin}/coexistence-check.json`
    }, 'no-store');
  }
  if (path === '/global' || path.startsWith('/global/')) return delegate(req, res, '/global', globalHandler);
  if (path === '/tr' || path.startsWith('/tr/')) return delegate(req, res, '/tr', trHandler);
  if (path === '/us' || path.startsWith('/us/')) return delegate(req, res, '/us', usHandler);
  if (path === '/fr' || path.startsWith('/fr/')) return delegate(req, res, '/fr', frHandler);
  return sendJson(res, 404, { error: 'Route inconnue.', france: '/fr/manifest.json', global: '/global/manifest.json', turkiye: '/tr/manifest.json', usa: '/us/manifest.json' }, 'no-store');
};

module.exports._internals = {
  VERSION,
  originFromRequest,
  combinedCollections,
  combinedDesktopCollections,
  desktopizeCollectionArt,
  coexistenceReport,
  delegate,
  usHandler,
  frHandler,
  globalHandler,
  trHandler
};
