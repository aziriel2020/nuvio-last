'use strict';

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { ADDON_ID, VERSION, V2_ADDON_ID, V2_VERSION, GENRES, WESTERN_GENRE, periods, catalogId, parseCatalog } = require('./src/model.cjs');
const { SeriesStore, defaultPath } = require('./src/store.cjs');
const { tmdb, tvmaze, mapLimit } = require('./src/upstream.cjs');
const { decorateSeriesMetas } = require('./src/presentation.cjs');
const catalogPolicy = require('./src/catalog-policy.cjs');

let cachedStore;
let cachedPath;
const APPROVED_COVER = path.resolve(__dirname, '../../assets/collection-art/series-france-v2.jpg');
// Approved October 2026 artwork: exact genre IDs, never a shared approximate slug.
const GENRE_COVER_DIR = path.resolve(__dirname, '../../assets/series-covers');
const GENRE_BACKDROP_DIR = path.resolve(__dirname, '../../assets/series-backdrops');
const GENRE_COVER_VERSION = 'premium-20261025-v2';
const GENRE_COVER_IDS = new Set(GENRES.map(({ id }) => id));
const COVER_PACK_NAME = 'series-covers-25-approved.zip';
const coverZipCache = new Map();
// Read a tightly scoped ZIP_STORED archive (the approved pack). This lets the
// user upload one binary file to GitHub rather than 25 independent WebPs.
// Parsing in memory avoids shelling out, temp files or unzip dependencies.
function approvedCoverPack(dir = GENRE_COVER_DIR) {
  const filename = path.join(dir, COVER_PACK_NAME);
  let stat;
  try { stat = fs.statSync(filename); }
  catch (error) { if (error.code === 'ENOENT') return new Map(); throw error; }
  const cacheKey = filename + ':' + stat.mtimeMs + ':' + stat.size;
  if (coverZipCache.has(cacheKey)) return coverZipCache.get(cacheKey);
  const data = fs.readFileSync(filename);
  const entries = new Map();
  let offset = 0;
  while (offset + 4 <= data.length) {
    const signature = data.readUInt32LE(offset);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    if (signature !== 0x04034b50 || offset + 30 > data.length) throw new Error('Pack de covers ZIP corrompu');
    const flags = data.readUInt16LE(offset + 6), compression = data.readUInt16LE(offset + 8);
    const bytes = data.readUInt32LE(offset + 18);
    const nameLength = data.readUInt16LE(offset + 26), extraLength = data.readUInt16LE(offset + 28);
    const start = offset + 30 + nameLength + extraLength;
    const end = start + bytes;
    if (flags & 8 || compression !== 0 || end > data.length || nameLength > 180) throw new Error('Format ZIP de covers non pris en charge');
    const name = data.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const match = name.match(/^([a-z0-9-]+)\.webp$/);
    if (match && GENRE_COVER_IDS.has(match[1])) {
      const raw = data.subarray(start, end);
      if (raw.length < 16 || raw.toString('ascii', 0, 4) !== 'RIFF'
          || raw.toString('ascii', 8, 12) !== 'WEBP' || entries.has(match[1]))
        throw new Error('Cover WebP invalide ou doublonnée : ' + name);
      entries.set(match[1], raw);
    }
    offset = end;
  }
  coverZipCache.clear();
  coverZipCache.set(cacheKey, entries);
  return entries;
}
function genreCoverBuffer(id, dir = GENRE_COVER_DIR) {
  if (!GENRE_COVER_IDS.has(id)) return null;
  const filename = path.join(dir, id + '.webp');
  if (fs.existsSync(filename)) return fs.readFileSync(filename);
  return approvedCoverPack(dir).get(id) || null;
}
function genreCoverProgress(dir = GENRE_COVER_DIR) {
  const zipped = approvedCoverPack(dir);
  const ids = GENRES.filter(({ id }) => fs.existsSync(path.join(dir, id + '.webp')) || zipped.has(id));
  return { loaded: ids.length, total: GENRES.length, ready: ids.length === GENRES.length };
}
function genreCoverRoute(origin, id) {
  return `${origin}/artwork/genre/${encodeURIComponent(id)}.webp?v=${GENRE_COVER_VERSION}`;
}
function genreBackdropRoute(origin, id) {
  return `${origin}/artwork/backdrop/${encodeURIComponent(id)}.jpg?v=${GENRE_COVER_VERSION}`;
}
async function serveGenreCover(res, id) {
  if (!GENRE_COVER_IDS.has(id)) return send(res, 404, { error: 'Genre inconnu' });
  const bytes = genreCoverBuffer(id);
  if (!bytes) return send(res, 404, { error: 'Cover non installée' });
  res.statusCode = 200;
  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.end(bytes);
}
async function serveGenreBackdrop(res, id) {
  if (!GENRE_COVER_IDS.has(id)) return send(res, 404, { error: 'Genre inconnu' });
  const filename = path.join(GENRE_BACKDROP_DIR, id + '.jpg');
  if (!fs.existsSync(filename)) return serveArtwork(res, 'backdrop');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.end(fs.readFileSync(filename));
}
const artwork = new Map();

async function serveArtwork(res, variant) {
  if (!artwork.has(variant)) {
    const dimensions = variant === 'cover' ? [1600, 900] : [1920, 1080];
    const parentBackdrop = path.join(GENRE_BACKDROP_DIR, '_parent.jpg');
    const source = variant === 'cover' && genreCoverProgress().ready ? genreCoverBuffer('all')
      : variant === 'backdrop' && fs.existsSync(parentBackdrop) ? parentBackdrop : APPROVED_COVER;
    artwork.set(variant, sharp(source).resize(...dimensions, { fit: 'cover' }).jpeg({ quality: 92, mozjpeg: true }).toBuffer());
  }
  let bytes;
  try { bytes = await artwork.get(variant); }
  catch (error) { artwork.delete(variant); throw error; }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
  res.end(bytes);
}
function reader() {
  const filename = defaultPath();
  if (!fs.existsSync(filename)) return null;
  if (!cachedStore || cachedPath !== filename) {
    cachedStore?.close(); cachedStore = new SeriesStore(filename, { readonly: true }); cachedPath = filename;
  }
  return cachedStore;
}

function releaseForOrigin(origin) {
  const fresh = new URL(origin).pathname.replace(/\/$/, '') === '/series-v2';
  return fresh
    ? { id: V2_ADDON_ID, version: V2_VERSION, name: `Nuvio Séries France V2 · ${V2_VERSION}`, prefixes: ['fr'] }
    : { id: ADDON_ID, version: VERSION, name: 'Nuvio Séries Streaming France', prefixes: ['fr', 'world'] };
}
function visibleGenres(origin) {
  return releaseForOrigin(origin).id === V2_ADDON_ID
    ? GENRES.filter(g => !['unclassified','10763'].includes(g.id)) : GENRES;
}

function buildManifest(origin, now = new Date()) {
  const dates = periods(now), westernDates = periods(now, WESTERN_GENRE);
  const release = releaseForOrigin(origin);
  return {
    id: release.id, version: release.version, name: release.name,
    description: release.id === V2_ADDON_ID
      ? 'Grandes plateformes de streaming France, par genres et dates depuis 2018 (Western : historique complet). Émissions et replay uniquement dans Talk-shows, Documentaires et Téléréalité. Animation et anime exclus. Disponibilités JustWatch via TMDB.'
      : 'Toutes les séries disponibles sur les services de streaming du marché français, par genres et dates depuis 2018 (Western : historique complet). Abonnements, gratuit, publicité, achat/location. Animation et anime exclus. Disponibilités JustWatch via TMDB.',
    types: ['series'], language: 'fr', resources: [{ name: 'catalog', types: ['series'] }, { name: 'meta', types: ['series'], idPrefixes: ['tt', 'tmdb:tv:', 'tvmaze:'] }],
    catalogs: ['premieres', 'seasons'].flatMap((mode) => visibleGenres(origin).flatMap((genre) => (genre.id === WESTERN_GENRE ? westernDates : dates).flatMap((date) => release.prefixes.map((prefix) => ({
      // Both deployed imports must resolve to a named manifest descriptor.
      // Changing the French-market filter did not invalidate old collections.
      id: catalogId(mode, genre.id, date.key).replace('series-fr-', `series-${prefix}-`), type: 'series',
      name: date.name,
      pageSize: 100, showInHome: false,
      extraSupported: ['skip', 'search'],
      extra: [{ name: 'skip', isRequired: false }, { name: 'search', isRequired: false }]
    }))))),
    logo: new URL('../fr/logo.svg', `${origin}/`).href,
    background: `${origin}/backdrop.jpg?v=${GENRE_COVER_VERSION}`, behaviorHints: { configurable: false }
  };
}

function buildCollections(origin, now = new Date(), mode = 'shield') {
  const dates = periods(now).filter(({ key }) => key !== 'all');
  const westernDates = periods(now, WESTERN_GENRE).filter(({ key }) => key !== 'all');
  const root = new URL('..', `${origin}/`).href.replace(/\/$/, '');
  // In collections, expose rolling periods first; keep 'all' in the manifest
  // as an internal/backwards-compatible catalog, never as a visible row.
  const release = releaseForOrigin(origin);
  const fresh = release.id === V2_ADDON_ID;
  // Switch the entire set atomically. A partially uploaded batch must never
  // give Shield a mix of old and new category covers.
  const premiumCoversReady = genreCoverProgress().ready;
  const parentCover = process.env.NUVIO_SERIES_COVER_URL || `${origin}/cover.jpg?v=${GENRE_COVER_VERSION}`;
  const parentArt = process.env.NUVIO_SERIES_BACKDROP_URL || `${origin}/backdrop.jpg?v=${GENRE_COVER_VERSION}`;
  return ['premieres', 'seasons'].map((view) => ({
    id: `series-world-${view}`, title: view === 'premieres'
      ? (fresh ? '🇫🇷 Séries France V2 · Grandes plateformes' : '🇫🇷 Séries en streaming · Tous services')
      : (fresh ? '🇫🇷 Séries France V2 · Nouvelles saisons' : '🇫🇷 Streaming · Nouvelles saisons'),
    backdropImageUrl: parentArt, pinToTop: true, focusGlowEnabled: true,
    viewMode: 'FOLLOW_LAYOUT', showAllTab: false,
    folders: visibleGenres(origin).map((genre) => {
      const genreSlugs = { '10759': 'action-adventure', '35': 'comedy', '80': 'crime', '18': 'drama', '9648': 'mystery', '10765': 'scifi-fantasy', '10768': 'war-politics', '37': 'western', '10766': 'soap', '10751': 'family', '10762': 'kids', '99': 'documentary', '10764': 'reality', '10767': 'talk', '10763': 'news', thriller: 'crime', horror: 'mystery', romance: 'drama', history: 'drama', medical: 'drama', legal: 'crime', espionage: 'action-adventure', miniseries: 'drama', unclassified: 'drama', all: 'drama' };
      const slug = genreSlugs[genre.id];
      const renderer = mode === 'desktop' ? 'desktop' : 'shield';
      const imageParams = new URLSearchParams({ genre: slug, type: 'series', title: genre.name, label: 'STREAMING FRANCE', v: 'series-france-v2' });
      const sources = (genre.id === WESTERN_GENRE ? westernDates : dates).map((date) => ({ provider: 'addon', addonId: release.id, type: 'series', catalogId: catalogId(view, genre.id, date.key) }));
      return {
        id: `series-world-${view}-${genre.id}`, title: genre.name,
        coverImageUrl: premiumCoversReady ? genreCoverRoute(origin, genre.id)
          : (genre.id === 'all' ? parentCover : `${root}/fr/${renderer}-genre-card.jpg?${imageParams}`),
        heroBackdropUrl: premiumCoversReady ? genreBackdropRoute(origin, genre.id)
          : (genre.id === 'all' ? parentArt : `${root}/fr/genre-backdrop.jpg?genre=${slug}`),
        tileShape: 'LANDSCAPE', hideTitle: mode !== 'desktop', focusGifEnabled: false,
        sources, catalogSources: sources.map(({ addonId, type, catalogId }) => ({ addonId, type, catalogId }))
      };
    })
  }));
}

function send(res, status, body, cache = 'no-store') {
  res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Cache-Control', cache); res.end(JSON.stringify(body));
}

const metaCache = new Map();
async function metaFor(store, row, requestedId) {
  const key = `${row.id}:${row.updated_at}`;
  const hit = metaCache.get(key);
  if (hit && hit.expires > Date.now()) return { ...hit.meta, id: requestedId,
    videos: hit.meta.videos.map((e) => ({ ...e, id: `${requestedId}:${e.season}:${e.episode}` })) };
  const meta = { ...store.meta(row), id: requestedId };
  const sources = store.sources(row.id);
  const tmdbSource = sources.find((s) => s.source === 'tmdb');
  const tvmazeSource = sources.find((s) => s.source === 'tvmaze');
  let episodes;
  if (tvmazeSource) {
    try {
      episodes = (await tvmaze(`/shows/${tvmazeSource.source_id}/episodes`)).map((e) => ({
        id: `${meta.id}:${e.season}:${e.number}`, title: e.name || `Épisode ${e.number}`,
        season: e.season, episode: e.number, released: e.airstamp || (e.airdate ? `${e.airdate}T00:00:00Z` : undefined),
        thumbnail: e.image?.original || e.image?.medium || undefined, overview: String(e.summary || '').replace(/<[^>]*>/g, '')
      }));
    } catch { /* TMDB is an independent fallback. */ }
  }
  if (!episodes && tmdbSource) {
    const details = await tmdb(`/tv/${tmdbSource.source_id}`);
    const seasons = (details.seasons || []).filter((s) => s.season_number > 0);
    const lists = await mapLimit(seasons, 3, async (s) => (await tmdb(`/tv/${tmdbSource.source_id}/season/${s.season_number}`)).episodes || []);
    episodes = lists.flat().map((e) => ({
      id: `${meta.id}:${e.season_number}:${e.episode_number}`, title: e.name || `Épisode ${e.episode_number}`,
      season: e.season_number, episode: e.episode_number,
      released: e.air_date ? `${e.air_date}T00:00:00Z` : undefined,
      thumbnail: e.still_path ? `https://image.tmdb.org/t/p/w500${e.still_path}` : undefined, overview: e.overview || undefined
    }));
  }
  meta.videos = (episodes || []).filter((e) => Number.isInteger(e.season) && e.season > 0 && Number.isInteger(e.episode) && e.episode > 0)
    .sort((a, b) => a.season - b.season || a.episode - b.episode);
  if (metaCache.size >= 16) metaCache.delete(metaCache.keys().next().value);
  if (JSON.stringify(meta).length < 512000) metaCache.set(key, { expires: Date.now() + 3600000, meta });
  return meta;
}

async function handler(req, res) {
  const base = req.headers?.['x-nuvio-public-origin'] || `${req.headers?.['x-forwarded-proto'] || 'https'}://${req.headers?.host || 'localhost'}`;
  const url = new URL(req.url, base);
  const routeBase = req.headers?.['x-nuvio-base-path'] === '/series-v2' ? '/series-v2' : '/series';
  const origin = `${url.origin}${routeBase}`;
  const now = process.env.NUVIO_NOW_OVERRIDE ? new Date(process.env.NUVIO_NOW_OVERRIDE) : new Date();
  if (url.pathname === '/cover.jpg' || url.pathname === '/backdrop.jpg') return serveArtwork(res, url.pathname === '/cover.jpg' ? 'cover' : 'backdrop');
  const genreArtMatch = url.pathname.match(/^\/artwork\/genre\/([a-z0-9-]+)\.webp$/);
  if (genreArtMatch) return serveGenreCover(res, genreArtMatch[1]);
  const genreBackdropMatch = url.pathname.match(/^\/artwork\/backdrop\/([a-z0-9-]+)\.jpg$/);
  if (genreBackdropMatch) return serveGenreBackdrop(res, genreBackdropMatch[1]);
  if (url.pathname === '/manifest.json') return send(res, 200, buildManifest(origin, now), 'public, max-age=300');
  if (['/nuvio-collections.json', '/collections.json', '/nuvio-collections-desktop.json'].includes(url.pathname)) {
    return send(res, 200, buildCollections(origin, now, url.pathname.includes('desktop') ? 'desktop' : 'shield'), 'public, max-age=300');
  }
  const store = reader();
  if (url.pathname === '/status.json') {
    const release = releaseForOrigin(origin);
    return send(res, 200, { addonId: release.id, version: release.version,
      genreArtwork: { ...genreCoverProgress(), version: GENRE_COVER_VERSION },
      ...(store ? { ok: true, ...store.stats({ curated: release.id === V2_ADDON_ID }) } : { ok: false, market: 'FR', state: 'index-not-created', eligible: 0 }) });
  }
  if (url.pathname === '/providers.json') return send(res, 200, { market: 'FR', source: 'JustWatch via TMDB',
    providers: (store?.franceProviders() || []).filter(p => routeBase !== '/series-v2' || catalogPolicy.isMajorProvider(p.id)),
    ...(routeBase === '/series-v2' ? { catalogPolicy: catalogPolicy.policy() } : {}) });
  if (url.pathname.startsWith('/catalog/series/')) {
    const match = url.pathname.match(/^\/catalog\/series\/([^/]+)(?:\/([^/]+))?\.json$/);
    if (!match) return send(res, 404, { error: 'Catalogue inconnu' });
    const descriptor = parseCatalog(decodeURIComponent(match[1]));
    if (!descriptor) return send(res, 404, { error: 'Catalogue inconnu' });
    const extra = new URLSearchParams(match[2] || '');
    const skip = Number(extra.get('skip') || url.searchParams.get('skip') || 0);
    const search = String(extra.get('search') || url.searchParams.get('search') || '').slice(0, 200);
    if (!store) return send(res, 503, { metas: [], error: 'Index en préparation. Consulter /series/status.json.' });
    try { return send(res, 200, { metas: decorateSeriesMetas(origin, store.query({ ...descriptor, skip, search, now, curated: routeBase === '/series-v2' }), descriptor) }); }
    catch (error) { if (/Invalid/.test(error.message)) return send(res, 400, { metas: [], error: error.message }); throw error; }
  }
  const metaMatch = url.pathname.match(/^\/meta\/series\/([^/]+)\.json$/);
  if (metaMatch) {
    if (!store) return send(res, 503, { meta: null });
    const id = decodeURIComponent(metaMatch[1]);
    const internal = id.replace(/^tmdb:tv:/, 'tmdb:');
    const row = store.row(internal);
    if (!row || row.classification !== 'eligible' || !(routeBase === '/series-v2' ? store.hasCuratedAvailability(row.id) : store.hasFranceAvailability(row.id))) return send(res, 404, { meta: null });
    try { return send(res, 200, { meta: await metaFor(store, row, id) }, 'public, max-age=300'); }
    catch { return send(res, 503, { meta: store.meta(row), error: 'Épisodes temporairement indisponibles' }); }
  }
  return send(res, 404, { error: 'Route inconnue' });
}

module.exports = handler;
module.exports._internals = { buildManifest, buildCollections, releaseForOrigin, visibleGenres, reader, metaFor, genreCoverProgress, genreCoverRoute, genreCoverBuffer, approvedCoverPack };
