'use strict';

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { ADDON_ID, VERSION, GENRES, VIEWS, catalogId, parseCatalog, periods, WESTERN_GENRE } = require('./src/model.cjs');
const { MovieStore, defaultPath } = require('./src/store.cjs');
const art = require('./src/artwork.cjs');
const { decorateMovieMetas } = require('./src/presentation.cjs');
let cachedStore, cachedPath;
const imageCache = new Map();
const GENRE_BACKDROP_DIR = path.resolve(__dirname, '../../assets/movie-backdrops');
function reader() {
  const filename = defaultPath();
  if (!fs.existsSync(filename)) return null;
  if (!cachedStore || filename !== cachedPath) {
    cachedStore?.close(); cachedStore = undefined;
    const candidate = new MovieStore(filename, { readonly: true });
    const schema = candidate.db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('movie_lanes','movie_releases')").get();
    if (schema.count !== 2) { candidate.close(); return null; }
    cachedStore = candidate; cachedPath = filename;
  }
  return cachedStore;
}
function buildManifest(origin, now = new Date()) {
  const dates = periods(now), westernDates = periods(now, WESTERN_GENRE);
  return {
    id: ADDON_ID, version: VERSION, name: `Nuvio Films Monde · ${VERSION}`, language: 'fr', types: ['movie'],
    description: 'Films de tous pays : services streaming, VOD achat/location et sorties cinéma sur le marché français. Par genres et dates depuis 2018, récent → ancien (Western : historique complet). Animation exclue. Disponibilités JustWatch via TMDB.',
    resources: [{ name: 'catalog', types: ['movie'] }, { name: 'meta', types: ['movie'], idPrefixes: ['tt', 'tmdb:movie:'] }],
    catalogs: VIEWS.flatMap((view) => GENRES.flatMap((genre) => (genre.id === WESTERN_GENRE ? westernDates : dates).map((period) => ({
      id: catalogId(view.id, genre.id, period.key), type: 'movie', name: period.name, showInHome: false,
      pageSize: 100, extraSupported: ['skip', 'search'], extra: [{ name: 'skip', isRequired: false }, { name: 'search', isRequired: false }]
    })))),
    logo: new URL('../fr/logo.svg', `${origin}/`).href,
    background: `${origin}/backdrop.jpg?v=${art.REVISION}`, behaviorHints: { configurable: false, configurationRequired: false }
  };
}
function buildCollections(origin, now = new Date(), mode = 'shield') {
  const dates = periods(now).filter(({ key }) => key !== 'all');
  const westernDates = periods(now, WESTERN_GENRE).filter(({ key }) => key !== 'all');
  return VIEWS.map((view) => ({
    id: `movies-world-${view.id}`, title: `🌍 ${view.name}`, pinToTop: true, focusGlowEnabled: true,
    backdropImageUrl: `${origin}/backdrop.jpg?v=${art.REVISION}`, viewMode: 'FOLLOW_LAYOUT', showAllTab: false,
    folders: GENRES.map((genre) => {
      const image = `${origin}/artwork/genre/${genre.id}.webp?v=${art.REVISION}`;
      const backdrop = `${origin}/artwork/backdrop/${genre.id}.jpg?v=${art.REVISION}`;
      const sources = (genre.id === WESTERN_GENRE ? westernDates : dates).map((date) => ({ provider: 'addon', addonId: ADDON_ID, type: 'movie', catalogId: catalogId(view.id, genre.id, date.key) }));
      return { id: `movies-world-${view.id}-${genre.id}`, title: genre.name,
        coverImageUrl: image, heroBackdropUrl: backdrop, tileShape: 'LANDSCAPE', hideTitle: mode !== 'desktop', focusGifEnabled: false,
        sources, catalogSources: sources.map(({ addonId, type, catalogId }) => ({ addonId, type, catalogId })) };
    })
  }));
}
function send(res, code, data) {
  res.statusCode = code; res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(data));
}
function image(res, bytes, type = 'image/webp') {
  res.statusCode = 200; res.setHeader('Content-Type', type); res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=86400'); res.end(bytes);
}
async function handler(req, res) {
  const base = req.headers?.['x-nuvio-public-origin'] || `${req.headers?.['x-forwarded-proto'] || 'https'}://${req.headers?.host || 'localhost'}`;
  const url = new URL(req.url, base), origin = `${url.origin}/movies`;
  const now = process.env.NUVIO_NOW_OVERRIDE ? new Date(process.env.NUVIO_NOW_OVERRIDE) : new Date();
  if (url.pathname === '/manifest.json') return send(res, 200, buildManifest(origin, now));
  if (['/nuvio-collections.json', '/collections.json', '/nuvio-collections-desktop.json'].includes(url.pathname))
    return send(res, 200, buildCollections(origin, now, url.pathname.includes('desktop') ? 'desktop' : 'shield'));
  const genre = url.pathname.match(/^\/artwork\/genre\/([a-z0-9]+)\.webp$/);
  if (genre) { const bytes = art.genreBytes(genre[1]); return bytes ? image(res, bytes) : send(res, 404, { error: 'Cover inconnue' }); }
  const backdrop = url.pathname.match(/^\/artwork\/backdrop\/([a-z0-9]+)\.jpg$/);
  if (backdrop) {
    if (!GENRES.some((item) => item.id === backdrop[1])) return send(res, 404, { error: 'Genre inconnu' });
    const filename = path.join(GENRE_BACKDROP_DIR, backdrop[1] + '.jpg');
    if (fs.existsSync(filename)) return image(res, fs.readFileSync(filename), 'image/jpeg');
    const parent = path.join(GENRE_BACKDROP_DIR, '_parent.jpg');
    return fs.existsSync(parent) ? image(res, fs.readFileSync(parent), 'image/jpeg') : send(res, 404, { error: 'Backdrop en préparation' });
  }
  if (['/cover.jpg', '/backdrop.jpg'].includes(url.pathname)) {
    const size = url.pathname === '/cover.jpg' ? [1600, 900] : [1920, 1080];
    if (!imageCache.has(url.pathname)) {
      const parent = path.join(GENRE_BACKDROP_DIR, '_parent.jpg');
      const isBackdrop = url.pathname === '/backdrop.jpg' && fs.existsSync(parent);
      const bytes = isBackdrop ? fs.readFileSync(parent) : art.genreBytes('all');
      if (!bytes) return send(res, 503, { error: 'Illustration en préparation' });
      imageCache.set(url.pathname, sharp(bytes).resize(...size, { fit: 'cover' }).jpeg({ quality: 92 }).toBuffer());
    }
    return image(res, await imageCache.get(url.pathname), 'image/jpeg');
  }
  if (url.pathname === '/content-card.jpg') return image(res, await art.fallbackCard((url.searchParams.get('title') || 'Film').slice(0, 110), (url.searchParams.get('label') || 'FILMS FRANCE').slice(0, 60)), 'image/jpeg');
  const store = reader();
  if (url.pathname === '/status.json') return send(res, 200, { addonId: ADDON_ID, version: VERSION, genreArtwork: art.progress(),
    ...(store ? { ok: true, ...store.stats() } : { ok: false, market: 'FR', eligible: 0, state: 'index-not-created' }) });
  if (url.pathname === '/providers.json') return send(res, 200, { market: 'FR', source: 'JustWatch via TMDB', providers: store?.franceProviders() || [] });
  const catalog = url.pathname.match(/^\/catalog\/movie\/([^/]+)(?:\/([^/]+))?\.json$/);
  if (catalog) {
    const descriptor = parseCatalog(decodeURIComponent(catalog[1]));
    if (!descriptor) return send(res, 404, { error: 'Catalogue inconnu' });
    if (!store) return send(res, 503, { metas: [], error: 'Index en préparation' });
    const extra = new URLSearchParams(catalog[2] || '');
    try { return send(res, 200, { metas: decorateMovieMetas(origin, store.query({ ...descriptor,
      skip: Number(extra.get('skip') || url.searchParams.get('skip') || 0),
      search: String(extra.get('search') || url.searchParams.get('search') || '').slice(0, 200), now }), descriptor) }); }
    catch (e) { if (/Invalid/.test(e.message)) return send(res, 400, { metas: [], error: e.message }); throw e; }
  }
  const match = url.pathname.match(/^\/meta\/movie\/([^/]+)\.json$/);
  if (match) {
    if (!store) return send(res, 503, { meta: null });
    const requested = decodeURIComponent(match[1]);
    const row = store.row(requested.replace(/^tmdb:movie:/, 'tmdb:'));
    if (!row || !store.visible(row.id)) return send(res, 404, { meta: null });
    return send(res, 200, { meta: { ...store.meta(row), id: requested } });
  }
  return send(res, 404, { error: 'Route inconnue' });
}
module.exports = handler;
module.exports._internals = { buildManifest, buildCollections, reader };
