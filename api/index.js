'use strict';

const usHandler = require('../regions/us/api/index');
const frHandler = require('../regions/fr/api/index');

const VERSION = '1.0.1';

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

function combinedCollections(req) {
  const origin = originFromRequest(req);
  const nowUs = usHandler._internals.runtimeNow();
  const nowFr = frHandler._internals.runtimeNow();
  const usTz = usHandler._internals.requestTimeZone(req);
  const frTz = frHandler._internals.requestTimeZone(req);
  const usCollections = usHandler._internals.buildNuvioCollectionsImport(nowUs, usTz, `${origin}/us`)
    .map((collection) => ({ ...collection, pinToTop: false }));
  const frCollections = frHandler._internals.buildNuvioCollectionsImport(nowFr, frTz, `${origin}/fr`)
    .map((collection) => ({ ...collection, pinToTop: true }));
  return [...frCollections, ...usCollections];
}

function coexistenceReport(req) {
  const origin = originFromRequest(req);
  const usManifest = usHandler._internals.buildManifest(`${origin}/us`, usHandler._internals.runtimeNow(), usHandler._internals.requestTimeZone(req));
  const frManifest = frHandler._internals.buildManifest(`${origin}/fr`, frHandler._internals.runtimeNow(), frHandler._internals.requestTimeZone(req));
  const collections = combinedCollections(req);
  const collectionIds = collections.map((c) => c.id);
  const folderKeys = collections.flatMap((c) => c.folders.map((f) => `${c.id}/${f.id}`));
  const usCatalogIds = usManifest.catalogs.map((c) => `${usManifest.id}:${c.type}:${c.id}`);
  const frCatalogIds = frManifest.catalogs.map((c) => `${frManifest.id}:${c.type}:${c.id}`);
  const duplicates = (values) => [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
  return {
    version: VERSION,
    mode: 'single-deployment-dual-addon',
    addonIds: [frManifest.id, usManifest.id],
    manifestUrls: [`${origin}/fr/manifest.json`, `${origin}/us/manifest.json`],
    combinedCollectionsUrl: `${origin}/nuvio-collections-usa-fr.json`,
    collectionCount: collections.length,
    frCollectionCount: collections.filter((c) => c.title.startsWith('🇫🇷')).length,
    usCollectionCount: collections.filter((c) => c.title.startsWith('🇺🇸')).length,
    duplicateCollectionIds: duplicates(collectionIds),
    duplicateFolderKeys: duplicates(folderKeys),
    duplicateCatalogKeys: duplicates([...usCatalogIds, ...frCatalogIds]),
    safe: duplicates(collectionIds).length === 0 && duplicates(folderKeys).length === 0 && duplicates([...usCatalogIds, ...frCatalogIds]).length === 0 && usManifest.id !== frManifest.id
  };
}

function landing(req) {
  const origin = originFromRequest(req);
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nuvio USA + France Coexist</title><style>body{margin:0;background:#05080f;color:#eef4ff;font-family:system-ui,sans-serif;min-height:100vh;display:grid;place-items:center}.card{max-width:960px;margin:24px;padding:32px;border:1px solid #243247;border-radius:24px;background:#0b111b}h1{margin-top:0}code{display:block;padding:12px;margin:8px 0;background:#02050a;border-radius:10px;overflow-wrap:anywhere}.ok{color:#77e1a6}a{color:#72c7ff}</style></head><body><main class="card"><h1>🇫🇷 France + 🇺🇸 USA — coexistence</h1><p>Un seul déploiement Vercel, mais <b>deux addons Nuvio réellement séparés</b> sous deux chemins. Les IDs addons, catalogues, Collections et dossiers sont isolés.</p><p>1. Installer l'addon France :</p><code>${origin}/fr/manifest.json</code><p>2. Installer l'addon USA :</p><code>${origin}/us/manifest.json</code><p>3. Importer une seule fois les deux jeux de Collections :</p><code>${origin}/nuvio-collections-usa-fr.json</code><p><a href="${origin}/coexistence-check.json">Vérification automatique des collisions</a></p><p class="ok">Le marché 🇫🇷 France est prioritaire sur Modern Shield. Les Collections FR restent pinToTop=true et les USA pinToTop=false, donc la France passe devant même si un ancien ordre Nuvio est déjà mémorisé.</p></main></body></html>`;
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
  if (path === '/nuvio-collections-usa-fr.json' || path === '/collections.json') {
    return sendJson(res, 200, combinedCollections(req), 'no-store');
  }
  if (path === '/install.json') {
    const origin = originFromRequest(req);
    return sendJson(res, 200, {
      version: VERSION,
      franceManifest: `${origin}/fr/manifest.json`,
      usaManifest: `${origin}/us/manifest.json`,
      combinedCollections: `${origin}/nuvio-collections-usa-fr.json`,
      check: `${origin}/coexistence-check.json`
    }, 'no-store');
  }
  if (path === '/us' || path.startsWith('/us/')) return delegate(req, res, '/us', usHandler);
  if (path === '/fr' || path.startsWith('/fr/')) return delegate(req, res, '/fr', frHandler);
  return sendJson(res, 404, { error: 'Route inconnue.', usa: '/us/manifest.json', france: '/fr/manifest.json' }, 'no-store');
};

module.exports._internals = {
  VERSION,
  originFromRequest,
  combinedCollections,
  coexistenceReport,
  delegate,
  usHandler,
  frHandler
};
