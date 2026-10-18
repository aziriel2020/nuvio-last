'use strict';

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { ADDON_ID, VERSION, GENRES, periods, catalogId, parseCatalog } = require('./src/model.cjs');
const { SeriesStore, defaultPath } = require('./src/store.cjs');
const { tmdb, tvmaze, mapLimit } = require('./src/upstream.cjs');

let cachedStore;
let cachedPath;
const APPROVED_COVER = path.resolve(__dirname, '../../assets/collection-art/series-world-approved-v1.jpg');
const artwork = new Map();

async function serveArtwork(res, variant) {
  if (!artwork.has(variant)) {
    const dimensions = variant === 'cover' ? [1600, 900] : [1920, 1080];
    artwork.set(variant, sharp(APPROVED_COVER).resize(...dimensions, { fit: 'cover' }).jpeg({ quality: 92, mozjpeg: true }).toBuffer());
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

function buildManifest(origin, now = new Date()) {
  const dates = periods(now);
  return {
    id: ADDON_ID, version: VERSION, name: 'Nuvio Séries Monde',
    description: 'Séries du monde entier par genres et dates ; premières diffusions et nouvelles saisons. Animation et anime exclus. Indexation progressive TMDB + TVmaze.',
    types: ['series'], resources: ['catalog', { name: 'meta', types: ['series'], idPrefixes: ['tt', 'tmdb:tv:', 'tvmaze:'] }],
    catalogs: ['premieres', 'seasons'].flatMap((mode) => GENRES.flatMap((genre) => dates.map((date) => ({
      id: catalogId(mode, genre.id, date.key), type: 'series',
      name: `${mode === 'seasons' ? 'Nouvelles saisons' : 'Séries Monde'} · ${genre.name} · ${date.name}`,
      pageSize: 100, showInHome: false,
      extra: [{ name: 'skip', isRequired: false }, { name: 'search', isRequired: false }]
    })))),
    logo: new URL('../fr/logo.svg', `${origin}/`).href,
    background: `${origin}/backdrop.jpg?v=approved-v1`, behaviorHints: { configurable: false }
  };
}

function buildCollections(origin, now = new Date(), mode = 'shield') {
  const root = new URL('..', `${origin}/`).href.replace(/\/$/, '');
  const dates = periods(now);
  const parentCover = process.env.NUVIO_SERIES_COVER_URL || `${origin}/cover.jpg?v=approved-v1`;
  const parentArt = process.env.NUVIO_SERIES_BACKDROP_URL || `${origin}/backdrop.jpg?v=approved-v1`;
  return ['premieres', 'seasons'].map((view) => ({
    id: `series-world-${view}`, title: view === 'premieres' ? '🌍 Toutes les séries · Par genres' : '🌍 Retours & nouvelles saisons',
    backdropImageUrl: parentArt, pinToTop: true, focusGlowEnabled: true,
    viewMode: 'FOLLOW_LAYOUT', showAllTab: false,
    folders: GENRES.map((genre) => {
      const genreSlugs = { '10759': 'action-adventure', '35': 'comedy', '80': 'crime', '18': 'drama', '9648': 'mystery', '10765': 'scifi-fantasy', '10768': 'war-politics', '37': 'western', '10766': 'soap', '10751': 'family', '10762': 'kids', '99': 'documentary', '10764': 'reality', '10767': 'talk', '10763': 'news', thriller: 'crime', horror: 'mystery', romance: 'drama', history: 'drama', medical: 'drama', legal: 'crime', espionage: 'action-adventure', miniseries: 'drama', unclassified: 'drama', all: 'drama' };
      const slug = genreSlugs[genre.id];
      const renderer = mode === 'desktop' ? 'desktop' : 'shield';
      const imageParams = new URLSearchParams({ genre: slug, type: 'series', title: genre.name, label: 'SÉRIES MONDE', v: 'series-world-v1' });
      const sources = dates.map((date) => ({ provider: 'addon', addonId: ADDON_ID, type: 'series', catalogId: catalogId(view, genre.id, date.key) }));
      return {
        id: `series-world-${view}-${genre.id}`, title: genre.name,
        coverImageUrl: genre.id === 'all' ? parentCover : `${root}/fr/${renderer}-genre-card.jpg?${imageParams}`,
        heroBackdropUrl: genre.id === 'all' ? parentArt : `${root}/fr/genre-backdrop.jpg?genre=${slug}`,
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
  const origin = `${url.origin}/series`;
  const now = process.env.NUVIO_NOW_OVERRIDE ? new Date(process.env.NUVIO_NOW_OVERRIDE) : new Date();
  if (url.pathname === '/cover.jpg' || url.pathname === '/backdrop.jpg') return serveArtwork(res, url.pathname === '/cover.jpg' ? 'cover' : 'backdrop');
  if (url.pathname === '/manifest.json') return send(res, 200, buildManifest(origin, now), 'public, max-age=300');
  if (['/nuvio-collections.json', '/collections.json', '/nuvio-collections-desktop.json'].includes(url.pathname)) {
    return send(res, 200, buildCollections(origin, now, url.pathname.includes('desktop') ? 'desktop' : 'shield'), 'public, max-age=300');
  }
  const store = reader();
  if (url.pathname === '/status.json') return send(res, 200, store ? { ok: true, ...store.stats() } : { ok: false, state: 'index-not-created', eligible: 0 });
  if (url.pathname.startsWith('/catalog/series/')) {
    const match = url.pathname.match(/^\/catalog\/series\/([^/]+)(?:\/([^/]+))?\.json$/);
    if (!match) return send(res, 404, { error: 'Catalogue inconnu' });
    const descriptor = parseCatalog(decodeURIComponent(match[1]));
    if (!descriptor) return send(res, 404, { error: 'Catalogue inconnu' });
    const extra = new URLSearchParams(match[2] || '');
    const skip = Number(extra.get('skip') || url.searchParams.get('skip') || 0);
    const search = String(extra.get('search') || url.searchParams.get('search') || '').slice(0, 200);
    if (!store) return send(res, 503, { metas: [], error: 'Index en préparation. Consulter /series/status.json.' });
    try { return send(res, 200, { metas: store.query({ ...descriptor, skip, search, now }) }, 'public, max-age=300'); }
    catch (error) { if (/Invalid/.test(error.message)) return send(res, 400, { metas: [], error: error.message }); throw error; }
  }
  const metaMatch = url.pathname.match(/^\/meta\/series\/([^/]+)\.json$/);
  if (metaMatch) {
    if (!store) return send(res, 503, { meta: null });
    const id = decodeURIComponent(metaMatch[1]);
    const internal = id.replace(/^tmdb:tv:/, 'tmdb:');
    const row = store.row(internal);
    if (!row || row.classification !== 'eligible') return send(res, 404, { meta: null });
    try { return send(res, 200, { meta: await metaFor(store, row, id) }, 'public, max-age=300'); }
    catch { return send(res, 503, { meta: store.meta(row), error: 'Épisodes temporairement indisponibles' }); }
  }
  return send(res, 404, { error: 'Route inconnue' });
}

module.exports = handler;
module.exports._internals = { buildManifest, buildCollections, reader, metaFor };
