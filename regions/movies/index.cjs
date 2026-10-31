'use strict';

const { withHeroTitles } = require('../../runtime/collection-titles.cjs');

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { ADDON_ID, VERSION, GENRES, VIEWS, catalogId, parseCatalog, periods, catalogWindowFor, displayDateForPremiere, WESTERN_GENRE } = require('./src/model.cjs');
const { MovieStore, defaultPath } = require('./src/store.cjs');
const catalogPolicy = require('../series/src/catalog-policy.cjs');
const art = require('./src/artwork.cjs');
const { decorateMovieMetas } = require('./src/presentation.cjs');
const { RECORDS: VERIFIED_PREMIERES } = require('../../runtime/verified-streaming-premieres.cjs');
const VERIFIED_WORLD = VERIFIED_PREMIERES.filter(p => p.market === 'FR' && p.type === 'movie'
  && p.worldPremiereDate && p.worldPremiereSource);
const WORLD_PAGE_SIZE = 24; // One immediate row + pagination, rather than 100 posters per period.


function officialWorldMeta(p, row = null) {
  const date = displayDateForPremiere(p);
  return {
    id: p.imdbId || `tmdb:movie:${p.tmdbId}`,
    type: 'movie', name: p.title, poster: row?.poster || undefined,
    background: row?.background || row?.poster || undefined, posterShape: 'poster',
    movieContentKind: 'fiction', movieReleaseKind: 'original', originalReleaseDate: p.worldPremiereDate || date,
    released: `${date}T00:00:00.000Z`, releaseInfo: date.slice(0,4), imdb_id: p.imdbId,
    streamingProviders: [p.providerLabel], providersByKind: { streaming: [p.providerLabel], vod: [] },
    genres: [], description: [
      `Sortie ${p.providerLabel} France : ${p.platformDate}.`,
      `Première projection mondiale : ${p.worldPremiereDate} (provenance conservée séparément).`,
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
    const releaseDay = displayDateForPremiere(p);
    if (window.start && releaseDay < window.start) continue;
    if (window.end && releaseDay > window.end) continue;
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
      // A previous crawl could still show the festival date as the event.
      // Preserve the original separately; display the verified platform debut.
      if (String(metas[existing].released || '').slice(0, 10) !== releaseDay ||
          metas[existing].originalReleaseDate !== p.worldPremiereDate)
        metas[existing] = officialWorldMeta(p, row);
      continue;
    }
    additions.push(officialWorldMeta(p, row));
  }
  // A verified original first release belongs on the first page even when
  // TMDB's provider directory has not indexed it or the database is not ready.
  return [...additions, ...metas].slice(0, 100);
}

// Keep pinned, provenance-confirmed debuts on page one, without losing the
// final regular title when that pin is inserted ahead of a 24-item page.
// The client's "skip" counts visible items, including injected pins.
function pagedMovieCatalog(store, descriptor, now, skip, search, pageSize = WORLD_PAGE_SIZE) {
  if (!store) return verifiedWorldCatalogMetas(null, descriptor, now, skip, search, [])
    .slice(0, pageSize);
  const query = (offset) => store.query({
    ...descriptor, skip: offset, search, now, curated: true, limit: pageSize
  });
  if (skip === 0) {
    return verifiedWorldCatalogMetas(store, descriptor, now, 0, search, query(0))
      .slice(0, pageSize);
  }
  // This correction matters only for views with pinned verified releases.
  // Cache-free on purpose: every new request reflects updated movie indexes.
  const needsPins = ['all', 'streaming'].includes(descriptor.view);
  let inserted = 0;
  if (needsPins) {
    const originalFirst = query(0);
    const withPins = verifiedWorldCatalogMetas(store, descriptor, now, 0, search, originalFirst);
    inserted = Math.max(0, withPins.length - originalFirst.length);
  }
  return query(Math.max(0, skip - inserted));
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
      pageSize: WORLD_PAGE_SIZE, extraSupported: ['skip', 'search'], extra: [{ name: 'skip', isRequired: false }, { name: 'search', isRequired: false }]
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

// Opt-in fast Collections import: never remove a catalog/period. Retain the
// original twenty genre folder identities for recent movies; archive periods
// are presented in 24-source-or-smaller folders so Nuvio doesn't fire 120+
// network requests at once when opening a single genre. This is necessary
// because stock NuvioTV's FolderDetailViewModel loads EVERY source eagerly.
const FAST_LIVE_MONTHS = 18;
const FAST_MAX_SOURCES_PER_FOLDER = 24;
function sourcePeriod(source) {
  return parseCatalog(source?.catalogId)?.period || '';
}
function fastMonthCutoff(now) {
  // Use the same Brussels calendar month as the movie source calendar.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit'
  }).formatToParts(now);
  const year = Number(parts.find(p => p.type === 'year')?.value);
  const month = Number(parts.find(p => p.type === 'month')?.value);
  return new Date(Date.UTC(year, month - FAST_LIVE_MONTHS, 1)).toISOString().slice(0, 7);
}
function sourcesInFolder(folder, sources, id, title, archive = false) {
  return {
    ...folder, id, title, hideTitle: archive ? false : folder.hideTitle,
    sources,
    catalogSources: sources.map(({ addonId, type, catalogId }) => ({ addonId, type, catalogId }))
  };
}
function buildFastCollections(origin, now = new Date(), mode = 'shield') {
  const cutoff = fastMonthCutoff(now);
  return buildCollections(origin, now, mode).map(collection => ({
    ...collection,
    folders: collection.folders.flatMap(folder => {
      const recent = [], buckets = new Map();
      for (const source of folder.sources) {
        const period = sourcePeriod(source);
        if (!period || ['today', 'tomorrow', 'yesterday', 'lastweek', 'nextweek'].includes(period) ||
            (/^\\d{4}-\\d{2}$/.test(period) && period >= cutoff)) {
          recent.push(source);
          continue;
        }
        // Pair years to get at most 24 monthly sources in each archive.
        if (/^\\d{4}-\\d{2}$/.test(period)) {
          const year = Number(period.slice(0, 4));
          const from = Math.floor(year / 2) * 2;
          const key = `months-${from}`;
          if (!buckets.has(key)) buckets.set(key, {
            label: `Archives ${from}–${from + 1}`, sources: []
          });
          buckets.get(key).sources.push(source);
        } else {
          const key = 'historical';
          if (!buckets.has(key)) buckets.set(key, { label: 'Archives historiques', sources: [] });
          buckets.get(key).sources.push(source);
        }
      }
      const output = [sourcesInFolder(folder, recent, folder.id, folder.title)];
      for (const [key, group] of buckets) {
        for (let i = 0; i < group.sources.length; i += FAST_MAX_SOURCES_PER_FOLDER) {
          const slice = group.sources.slice(i, i + FAST_MAX_SOURCES_PER_FOLDER);
          const part = Math.floor(i / FAST_MAX_SOURCES_PER_FOLDER);
          const subkey = `${key}-${part}`;
          const label = `${group.label}${part ? ` · ${part + 1}` : ''}`;
          output.push(sourcesInFolder(
            folder, slice, `${folder.id}-${subkey}`, `${folder.title} · ${label}`, true
          ));
        }
      }
      return output;
    })
  }));
}
function send(res, code, data, cacheControl = 'no-store') {
  res.statusCode = code; res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Cache-Control', cacheControl);
  res.end(JSON.stringify(data));
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
  if (url.pathname === '/nuvio-collections-fast.json' || url.pathname === '/nuvio-collections-fast-desktop.json')
    return send(res, 200, buildFastCollections(origin, now, url.pathname.includes('desktop') ? 'desktop' : 'shield'));
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
      const metas = pagedMovieCatalog(store, descriptor, now, skip, search);
      if (!store && !metas.length) return send(res, 503, { metas: [], error: 'Index en préparation' });
      // Cache only nonempty, successful catalog pages. Never cache a missing
      // DB index or an empty page: fresh imports must appear immediately.
      const cachePolicy = metas.length ? 'public, max-age=15, s-maxage=60' : 'no-store';
      return send(res, 200, { metas: decorateMovieMetas(origin, metas, descriptor) }, cachePolicy);
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
module.exports._internals = { buildManifest, buildCollections, buildFastCollections, reader, officialWorldMeta, verifiedWorldCatalogMetas, pagedMovieCatalog, WORLD_PAGE_SIZE };
