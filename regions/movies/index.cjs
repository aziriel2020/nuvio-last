'use strict';

const { withHeroTitles } = require('../../runtime/collection-titles.cjs');

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { ADDON_ID, VERSION, GENRES, VIEWS, catalogId, parseCatalog, periods, catalogWindowFor, WESTERN_GENRE } = require('./src/model.cjs');
const { MovieStore, defaultPath } = require('./src/store.cjs');
const catalogPolicy = require('../series/src/catalog-policy.cjs');
const art = require('./src/artwork.cjs');
const { decorateMovieMetas } = require('./src/presentation.cjs');
const { RECORDS: VERIFIED_PREMIERES } = require('../../runtime/verified-streaming-premieres.cjs');
const VERIFIED_WORLD = VERIFIED_PREMIERES.filter(p => p.market === 'FR' && p.type === 'movie'
  && p.worldPremiereDate && p.worldPremiereSource);

function officialWorldMeta(p, row = null) {
  const date = p.worldPremiereDate;
  return {
    id: p.imdbId || `tmdb:movie:${p.tmdbId}`,
    type: 'movie', name: p.title, poster: row?.poster || undefined,
    background: row?.background || row?.poster || undefined, posterShape: 'poster',
    movieContentKind: 'fiction', movieReleaseKind: 'original', originalReleaseDate: date,
    released: `${date}T00:00:00.000Z`, releaseInfo: date.slice(0,4), imdb_id: p.imdbId,
    streamingProviders: [p.providerLabel], providersByKind: { streaming: [p.providerLabel], vod: [] },
    genres: [], description: [
      `Première projection mondiale vérifiée : ${date}.`,
      `Sortie ${p.providerLabel} France : ${p.platformDate}. Cette date de streaming est distincte de la première mondiale.`,
      p.overview
    ].filter(Boolean).join('\n\n'),
    links: [
      { name: `Regarder sur ${p.providerLabel}`, category: 'Regarder', url: p.watchUrl },
      { name: 'Première mondiale', category: 'Sources', url: p.worldPremiereSource },
      { name: 'Sortie streaming officielle', category: 'Sources', url: p.officialSource }
    ]
  };
}
function verifiedWorldCatalogMetas(store, descriptor, now, skip, search, metas) {
  if (skip !== 0 || !['all', 'streaming'].includes(descriptor.view)) return metas;
  const window = catalogWindowFor(descriptor.period, descriptor.genre, now);
  if (!window || window.undated) return metas;
  const nowMs = +new Date(now);
  const normalizedSearch = String(search || '').trim().toLocaleLowerCase('fr');
  const additions = [];
  for (const p of VERIFIED_WORLD) {
    if (nowMs < Date.parse(`${p.platformDate}T00:00:00Z`)) continue;
    if (window.start && p.worldPremiereDate < window.start) continue;
    if (window.end && p.worldPremiereDate > window.end) continue;
    if (normalizedSearch && ![p.title, p.originalTitle].some(v =>
      String(v || '').toLocaleLowerCase('fr').includes(normalizedSearch))) continue;
    const row = store?.row(`tmdb:${p.tmdbId}`) || null;
    if (descriptor.genre !== 'all') {
      if (!row) continue; // Never invent genres when metadata is missing.
      let genres = [];
      try { genres = JSON.parse(row.genres); } catch {}
      if (!genres.some(g => String(g) === descriptor.genre)) continue;
    }
    if (row?.classification === 'animation') continue;
    const existing = metas.findIndex(m => m.id === p.imdbId || m.id === `tmdb:movie:${p.tmdbId}`);
    if (existing >= 0) {
      // The index may still carry the later digital date from an older crawl.
      // Correct the actual card rather than merely avoiding duplicates.
      if (metas[existing].originalReleaseDate !== p.worldPremiereDate)
        metas[existing] = officialWorldMeta(p, row);
      continue;
    }
    additions.push(officialWorldMeta(p, row));
  }
  // A verified original first release belongs on the first page even when
  // TMDB's provider directory has not indexed it or the database is not ready.
  return [...additions, ...metas].slice(0, 100);
}

let cachedStore, cachedPath;
const imageCache = new Map();
const GENRE_BACKDROP_DIR = path.resolve(__dirname, '../../assets/movie-backdrops');
const VISIBLE_GENRES = GENRES.filter(g => g.id !== 'unclassified');
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
    description: 'Films de fiction de tous pays : grandes plateformes streaming, grandes boutiques VOD et cinéma France. Classés par première sortie mondiale ; les rééditions et ressorties ne changent pas leur date. Depuis 2018 (Western : historique complet). Documentaires uniquement dans leur rubrique. Stand-up uniquement dans sa rubrique ; spectacles et émissions exclus des films. Animation et anime exclus. Disponibilités JustWatch via TMDB.',
    resources: [{ name: 'catalog', types: ['movie'] }, { name: 'meta', types: ['movie'], idPrefixes: ['tt', 'tmdb:movie:'] }],
    catalogs: VIEWS.flatMap((view) => VISIBLE_GENRES.flatMap((genre) => (genre.id === WESTERN_GENRE ? westernDates : dates).map((period) => ({
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
  return withHeroTitles(VIEWS.map((view) => ({
    id: `movies-world-${view.id}`, title: `🌍 ${view.name}`, pinToTop: true, focusGlowEnabled: true,
    backdropImageUrl: `${origin}/backdrop.jpg?v=${art.REVISION}`, viewMode: 'FOLLOW_LAYOUT', showAllTab: false,
    folders: VISIBLE_GENRES.map((genre) => {
      const image = `${origin}/artwork/genre/${genre.id}.webp?v=${art.REVISION}`;
      const backdrop = `${origin}/artwork/backdrop/${genre.id}.jpg?v=${art.REVISION}`;
      const sources = (genre.id === WESTERN_GENRE ? westernDates : dates).map((date) => ({ provider: 'addon', addonId: ADDON_ID, type: 'movie', catalogId: catalogId(view.id, genre.id, date.key) }));
      return { id: `movies-world-${view.id}-${genre.id}`, title: genre.name,
        coverImageUrl: image, heroBackdropUrl: backdrop, tileShape: 'LANDSCAPE', hideTitle: mode !== 'desktop', focusGifEnabled: false,
        sources, catalogSources: sources.map(({ addonId, type, catalogId }) => ({ addonId, type, catalogId })) };
    })
  })), origin);
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
    ...(store ? { ok: true, ...store.stats({ curated: true }) } : { ok: false, market: 'FR', eligible: 0, state: 'index-not-created' }) });
  if (url.pathname === '/providers.json') return send(res, 200, { market: 'FR', source: 'JustWatch via TMDB',
    providers: (store?.franceProviders() || []).filter(p => catalogPolicy.isMajorProvider(p.id) || catalogPolicy.isVodProvider(p.id)),
    catalogPolicy: catalogPolicy.policy(), datePolicy: 'first-release-worldwide' });
  const catalog = url.pathname.match(/^\/catalog\/movie\/([^/]+)(?:\/([^/]+))?\.json$/);
  if (catalog) {
    const descriptor = parseCatalog(decodeURIComponent(catalog[1]));
    if (!descriptor) return send(res, 404, { error: 'Catalogue inconnu' });
    const extra = new URLSearchParams(catalog[2] || '');
    const skip = Number(extra.get('skip') || url.searchParams.get('skip') || 0);
    const search = String(extra.get('search') || url.searchParams.get('search') || '').slice(0, 200);
    try {
      const indexed = store ? store.query({ ...descriptor, skip, search, now, curated: true }) : [];
      const metas = verifiedWorldCatalogMetas(store, descriptor, now, skip, search, indexed);
      if (!store && !metas.length) return send(res, 503, { metas: [], error: 'Index en préparation' });
      return send(res, 200, { metas: decorateMovieMetas(origin, metas, descriptor) });
    }
    catch (e) { if (/Invalid/.test(e.message)) return send(res, 400, { metas: [], error: e.message }); throw e; }
  }
  const match = url.pathname.match(/^\/meta\/movie\/([^/]+)\.json$/);
  if (match) {
    const requested = decodeURIComponent(match[1]);
    const verified = VERIFIED_WORLD.find(p =>
      requested === p.imdbId || requested === `tmdb:movie:${p.tmdbId}`);
    const row = store?.row(requested.replace(/^tmdb:movie:/, 'tmdb:')) || (verified ? store?.row(`tmdb:${verified.tmdbId}`) : null);
    // Verified premiere evidence is canonical for the date even when an old
    // SQLite row still contains the streaming date as its first release.
    if (verified && +now >= Date.parse(`${verified.platformDate}T00:00:00Z`)) {
      return send(res, 200, { meta: { ...officialWorldMeta(verified, row), id: requested } });
    }
    if (!row || !store.visible(row.id, { curated: true })) return send(res, store ? 404 : 503, { meta: null });
    return send(res, 200, { meta: { ...store.meta(row, { curated: true, genre: store.contentKind(row) === 'standup' ? 'standup' : JSON.parse(row.genres).includes('99') ? '99' : 'all' }), id: requested } });
  }
  return send(res, 404, { error: 'Route inconnue' });
}
module.exports = handler;
module.exports._internals = { buildManifest, buildCollections, reader, officialWorldMeta, verifiedWorldCatalogMetas };
