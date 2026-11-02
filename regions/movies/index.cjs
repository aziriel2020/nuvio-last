'use strict';

const { withHeroTitles } = require('../../runtime/collection-titles.cjs');

const fs = require('node:fs');
const path = require('node:path');
const { ADDON_ID, VERSION, GENRES, VIEWS, catalogId, parseCatalog, periods, catalogWindowForMovie, displayDateForPremiere, WESTERN_GENRE } = require('./src/model.cjs');
const { MovieStore, defaultPath } = require('./src/store.cjs');
const catalogPolicy = require('../series/src/catalog-policy.cjs');
const art = require('./src/artwork.cjs');
const { decorateMovieMetas, withoutFilmTitleLogo } = require('./src/presentation.cjs');
const { RECORDS: VERIFIED_PREMIERES } = require('../../runtime/verified-streaming-premieres.cjs');
const VERIFIED_WORLD = VERIFIED_PREMIERES.filter(p => p.market === 'FR' && p.type === 'movie'
  && p.worldPremiereDate && p.worldPremiereSource);
const WORLD_PAGE_SIZE = 24; // One immediate row + pagination, rather than 100 posters per period.
const annualPreviewCache = new Map();
// Cache previews per SQLite reader and data version to prevent stale poster IDs
// from surviving film-index swaps or contaminating a newly rebuilt catalogue.
const annualReaderIds = new WeakMap();
let nextAnnualReaderId = 0;
function annualYearPage(store, descriptor, now, skip, search, size = WORLD_PAGE_SIZE) {
  if (!annualReaderIds.has(store)) annualReaderIds.set(store, ++nextAnnualReaderId);
  const version = store.db.prepare('PRAGMA data_version').get().data_version;
  const key = JSON.stringify([annualReaderIds.get(store),version,descriptor.view,
    descriptor.genre,descriptor.period,search,
    new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Brussels'}).format(now)]);
  const cached = annualPreviewCache.get(key);
  let highlighted;
  if (cached && Date.now()-cached.storedAt < 60000) highlighted=cached.metas;
  else {
    highlighted=store.query({...descriptor,now,search,curated:true,skip:0,
      limit:size,monthSample:2,cardOnly:true});
    annualPreviewCache.set(key,{storedAt:Date.now(),metas:highlighted});
    while(annualPreviewCache.size>180) annualPreviewCache.delete(annualPreviewCache.keys().next().value);
  }
  const ids=highlighted.map(m=>m._sourceId);
  const featured=highlighted.map(({_sourceId,...m})=>m);
  const request=(offset,count)=>count>0 ? store.query({...descriptor,now,search,curated:true,
    skip:offset,limit:count,excludeIds:ids,cardOnly:true}) : [];
  // Supplement sparse months with additional films. In either case the first
  // 24 poster slots span as many months as the source index actually contains.
  const supplement=request(0,size-featured.length);
  const first=[...featured,...supplement].sort((a,b)=>
    String(b.released||'').localeCompare(String(a.released||'')) ||
    String(a.id).localeCompare(String(b.id)));
  if(skip===0) return first;
  if(skip<first.length){
    const remaining=first.slice(skip);
    return remaining.concat(request(supplement.length,size-remaining.length));
  }
  // The rest is a stable chronological stream, excluding page-one highlights
  // and accounting for the supplementary titles already loaded on page one.
  return request(skip-featured.length,size);
}



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
  const window = catalogWindowForMovie(descriptor.period, descriptor.genre, now);
  if (!window || window.undated) return metas;
  const nowMs = +new Date(now);
  const normalizedSearch = String(search || '').trim().toLocaleLowerCase('fr');
  const additions = [];
  for (const p of VERIFIED_WORLD) {
    if (nowMs < Date.parse(`${p.platformDate}T00:00:00Z`)) continue;
    const releaseDay = displayDateForPremiere(p);
    if (window.start && releaseDay < window.start) continue;
    if (window.end && releaseDay > window.end) continue;
    if (window.excludeStart && releaseDay >= window.excludeStart && releaseDay <= window.excludeEnd) continue;
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
  const query = (offset) => descriptor.period.startsWith('annual-')
    ? annualYearPage(store,descriptor,now,offset,search,pageSize)
    : store.query({ ...descriptor,skip:offset,search,now,curated:true,limit:pageSize,cardOnly:true });
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
// Manifest and native-collection JSON are large and stable during a Brussels
// calendar day. Build and serialize once per day/origin/mode. Original URLs,
// collection IDs, cover links, period names and daily rollover are unchanged.
const jsonPayloadCache = new Map();

/**
 * Films Monde now follows the cached-catalog pipeline used by Séries Monde.
 * Existing source IDs and approved 16:9 cards never change. A bounded memory
 * cache stores the *final* JSON (including artwork URLs), not just the 24
 * annual preview IDs. The original database remains authoritative.
 *
 * Brussels-day keys prevent Yesterday/Today and annual rollover leakage.
 * Only nonempty successful pages are cached, so imports/index failures never
 * become sticky. Historical data refreshes every 15 minutes; actively
 * changing periods use much shorter lifetimes.
 */
const movieCatalogJsonCache = new Map();
const MOVIE_CATALOG_CACHE_MAX = 480;
function movieCatalogCachePolicy(period, now = new Date()) {
  const { current, previous } = recentCalendarMonths(now);
  const dynamic = ['today','yesterday','tomorrow','lastweek','nextweek'].includes(period);
  if (['today','yesterday','tomorrow'].includes(period))
    return { ttl: 15000, http: 'no-store', kind: 'live' };
  if (dynamic) return { ttl: 30000, http: 'public, max-age=15, s-maxage=30', kind: 'rolling' };
  if (period === current || period === 'all' || period === 'undated')
    return { ttl: 30000, http: 'public, max-age=15, s-maxage=30', kind: 'current' };
  if (period === previous)
    return { ttl: 120000, http: 'public, max-age=60, s-maxage=120', kind: 'lastmonth' };
  if (period === 'annual-' + current.slice(0,4))
    return { ttl: 120000, http: 'public, max-age=60, s-maxage=120', kind: 'currentyear' };
  // Like Séries Monde archives: 15-minute server cache, with CDN expiry
  // shorter than the authoritative cache to permit timely corrections.
  return { ttl: 900000, http: 'public, max-age=300, s-maxage=900, stale-while-revalidate=900', kind: 'archive' };
}
function cachedMovieCatalogJson(origin, descriptor, now, skip, search, create) {
  const policy = movieCatalogCachePolicy(descriptor.period, now);
  const key = JSON.stringify([origin,brusselsDayFormatter.format(now),
    descriptor.view,descriptor.genre,descriptor.period,skip,search]);
  const nowMs = Date.now();
  const hit = movieCatalogJsonCache.get(key);
  if (hit && hit.expires > nowMs) return { json: hit.json, hit: true, policy };
  if (hit) movieCatalogJsonCache.delete(key);
  const metas = create();
  const json = JSON.stringify({ metas });
  if (metas.length) {
    movieCatalogJsonCache.set(key,{ json,expires:nowMs+policy.ttl });
    while (movieCatalogJsonCache.size > MOVIE_CATALOG_CACHE_MAX)
      movieCatalogJsonCache.delete(movieCatalogJsonCache.keys().next().value);
  }
  return { json,hit: false,policy };
}

const brusselsDayFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit'
});
function cachedJsonPayload(origin, now, route, build) {
  const key = origin + '|' + brusselsDayFormatter.format(now) + '|' + route;
  if (jsonPayloadCache.has(key)) return jsonPayloadCache.get(key);
  const payload = JSON.stringify(build());
  jsonPayloadCache.set(key, payload);
  while (jsonPayloadCache.size > 12) jsonPayloadCache.delete(jsonPayloadCache.keys().next().value);
  return payload;
}
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
// Calendar-year catalogues are only for the opt-in compact genre import.
// Unlike the older year-by-year layout, they stay *inside* each original genre.
function recentCalendarMonths(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit'
  }).formatToParts(now);
  const year = Number(parts.find(p => p.type === 'year').value);
  const month = Number(parts.find(p => p.type === 'month').value);
  const current = `${year}-${String(month).padStart(2, '0')}`;
  const previous = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
  return { current, previous };
}
function annualPeriods(now, genre) {
  const { previous } = recentCalendarMonths(now);
  return [...new Set(periods(now, genre).filter(p =>
    /^\d{4}-\d{2}$/.test(p.key) && p.key !== previous
  ).map(p => p.key.slice(0,4)))].map(year => ({
    key: 'annual-' + year, name: year
  }));
}
function buildManifest(origin, now = new Date()) {
  const dates = periods(now), westernDates = periods(now, WESTERN_GENRE);
  return {
    id: ADDON_ID, version: VERSION, name: `Nuvio Films Monde · ${VERSION}`, language: 'fr', types: ['movie'],
    description: 'Films de fiction de tous pays : grandes plateformes streaming, grandes boutiques VOD et cinéma France. Classés par première sortie mondiale ; les rééditions et ressorties ne changent pas leur date. Depuis 2018 (Western : historique complet). Documentaires uniquement dans leur rubrique. Stand-up uniquement dans sa rubrique ; spectacles et émissions exclus des films. Animation et anime exclus. Disponibilités JustWatch via TMDB.',
    resources: [{ name: 'catalog', types: ['movie'] }, { name: 'meta', types: ['movie'], idPrefixes: ['tt', 'tmdb:movie:'] }],
    catalogs: VIEWS.flatMap((view) => VISIBLE_GENRES.flatMap((genre) =>
      [...(genre.id === WESTERN_GENRE ? westernDates : dates), ...annualPeriods(now, genre.id)].map((period) => ({
        id: catalogId(view.id, genre.id, period.key), type: 'movie', name: period.name, showInHome: false,
        pageSize: WORLD_PAGE_SIZE, extraSupported: ['skip', 'search'],
        extra: [{ name: 'skip', isRequired: false }, { name: 'search', isRequired: false }]
      })))),
    logo: new URL('../fr/logo.svg', `${origin}/`).href,
    background: `${origin}/artwork/genre/all.webp?v=${art.REVISION}`, behaviorHints: { configurable: false, configurationRequired: false }
  };
}
function buildCollections(origin, now = new Date(), mode = 'shield') {
  const dates = periods(now).filter(({ key }) => key !== 'all');
  const westernDates = periods(now, WESTERN_GENRE).filter(({ key }) => key !== 'all');
  return withHeroTitles(VIEWS.map((view) => ({
    id: `movies-world-${view.id}`, title: `🌍 ${view.name}`, pinToTop: true, focusGlowEnabled: true,
    backdropImageUrl: `${origin}/artwork/genre/all.webp?v=${art.REVISION}`, viewMode: 'FOLLOW_LAYOUT', showAllTab: false,
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
const FAST_LIVE_MONTHS = 12;
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
  return buildCollections(origin, now, mode).map(collection => {
    const currentFolders = [], archiveFolders = [];
    for (const folder of collection.folders) {
      const recent = [], buckets = new Map();
      for (const source of folder.sources) {
        const period = sourcePeriod(source);
        if (!period || ['today', 'tomorrow', 'yesterday', 'lastweek', 'nextweek'].includes(period) ||
            (/^\d{4}-\d{2}$/.test(period) && period >= cutoff)) {
          recent.push(source);
          continue;
        }
        // Pair years to get at most 24 monthly sources in each archive.
        if (/^\d{4}-\d{2}$/.test(period)) {
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
      currentFolders.push(sourcesInFolder(folder, recent, folder.id, folder.title));
      for (const [key, group] of buckets) {
        for (let i = 0; i < group.sources.length; i += FAST_MAX_SOURCES_PER_FOLDER) {
          const slice = group.sources.slice(i, i + FAST_MAX_SOURCES_PER_FOLDER);
          const part = Math.floor(i / FAST_MAX_SOURCES_PER_FOLDER);
          const subkey = `${key}-${part}`;
          const label = `${group.label}${part ? ` · ${part + 1}` : ''}`;
          archiveFolders.push(sourcesInFolder(
            folder, slice, `${folder.id}-${subkey}`, `${folder.title} · ${label}`, true
          ));
        }
      }
    }
    // Keep the original genre grid first; place clearly labeled archives after it.
    return { ...collection, folders: [...currentFolders, ...archiveFolders] };
  });
}
// Optional Shield import for the full Films Monde history without the eager
// 100+ parallel requests of a genre containing every monthly catalog.
// The original approved genre cards / 2018-2030 period IDs are unchanged.
// All years appear as *named genre/year folders* (no archive is concealed).
// Each folder loads at most one calendar year (plus five live-day descriptors).
// The original full and fast imports are kept intact and can be restored.
function buildYearByYearCollections(origin, now = new Date(), mode = 'shield') {
  const dynamic = new Set(['today', 'tomorrow', 'yesterday', 'lastweek', 'nextweek']);
  return buildCollections(origin, now, mode).map(collection => ({
    ...collection,
    folders: collection.folders.flatMap(folder => {
      const current = [];
      const monthByYear = new Map();
      const heritage = [];
      const other = [];
      for (const source of folder.sources) {
        const period = sourcePeriod(source);
        if (dynamic.has(period)) {
          current.push(source);
        } else if (/^\d{4}-\d{2}$/.test(period)) {
          const year = period.slice(0, 4);
          if (!monthByYear.has(year)) monthByYear.set(year, []);
          monthByYear.get(year).push(source);
        } else if (/^\d{4}$/.test(period)) heritage.push(source);
        else other.push(source);
      }
      // Only five dynamic periods are fetched from the main genre folder.
      // Each calendar year, including the current year, is a clearly named
      // shelf with up to 12 months, so no history is hidden or deleted.
      const result = [sourcesInFolder(folder, current, folder.id, folder.title)];
      const yearFolder = (sources, suffix, title) => ({
        ...sourcesInFolder(folder, sources, folder.id + '-' + suffix, title, true),
        // Archived years reuse approved genre artwork; title captions make
        // their exact year instantly visible instead of hiding it in a folder.
        titleLogoUrl: null
      });
      for (const [year, sources] of monthByYear) {
        result.push(yearFolder(sources, 'year-' + year, folder.title + ' · ' + year));
      }
      // Western also has 115+ annual historical periods, grouped into
      // small sequential ranges without deleting one catalog.
      for (let i = 0; i < heritage.length; i += 12) {
        const group = heritage.slice(i, i + 12);
        const first = sourcePeriod(group[0]), last = sourcePeriod(group.at(-1));
        result.push(yearFolder(group, 'heritage-' + first + '-' + last,
          folder.title + ' · ' + first + '–' + last));
      }
      if (other.length) result.push(yearFolder(other, 'heritage-special',
        folder.title + ' · Archives historiques'));
      if (result.some(part => part.sources.length > 17 || part.sources.length === 0)) {
        throw Error('Oversized or empty Films Monde historical folder: ' + folder.id);
      }
      return result;
    })
  }));
}


/**
 * Compact option: keep the ORIGINAL four collections and original genre
 * folders/cards. Inside each genre retain live periods, the current and
 * previous calendar months, then one annual catalog per older year.
 * Original full JSON is NEVER modified, even on future date rollover.
 */
function buildRecentYearsCollections(origin, now = new Date(), mode = 'shield') {
  const { previous } = recentCalendarMonths(now);
  const recentOrder = ['nextweek', 'tomorrow', 'today', 'yesterday', 'lastweek', previous];
  return buildCollections(origin, now, mode).map(collection => ({
    ...collection,
    folders: collection.folders.map(folder => {
      const byPeriod = new Map(folder.sources.map(source => [sourcePeriod(source), source]));
      const exemplar = folder.sources[0];
      const descriptor = parseCatalog(exemplar.catalogId);
      const recent = recentOrder.map(period => byPeriod.get(period)).filter(Boolean);
      const annual = annualPeriods(now, descriptor.genre).map(({ key }) => ({
        provider: 'addon', addonId: ADDON_ID, type: 'movie',
        catalogId: catalogId(descriptor.view, descriptor.genre, key)
      }));
      // Western periods before 2015 are already grouped by individual year,
      // so keep them untouched, as well as the before-1900/undated sources.
      const heritage = folder.sources.filter(source => {
        const period = sourcePeriod(source);
        return /^\d{4}$/.test(period) || ['before1900','undated'].includes(period);
      });
      return sourcesInFolder(folder, [...recent, ...annual, ...heritage], folder.id, folder.title);
    })
  }));
}

function send(res, code, data, cacheControl = 'no-store') {
  res.statusCode = code; res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Cache-Control', cacheControl);
  res.end(typeof data === 'string' ? data : JSON.stringify(data));
}
function image(res, bytes, type = 'image/webp') {
  res.statusCode = 200; res.setHeader('Content-Type', type); res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=86400'); res.end(bytes);
}
async function handler(req, res) {
  const base = req.headers?.['x-nuvio-public-origin'] || `${req.headers?.['x-forwarded-proto'] || 'https'}://${req.headers?.host || 'localhost'}`;
  const url = new URL(req.url, base), origin = `${url.origin}/movies`;
  const now = process.env.NUVIO_NOW_OVERRIDE ? new Date(process.env.NUVIO_NOW_OVERRIDE) : new Date();
  if (url.pathname === '/manifest.json') return send(res, 200,
    cachedJsonPayload(origin, now, 'manifest', () => buildManifest(origin, now)));
  if (['/nuvio-collections-recent-years.json', '/nuvio-collections-recent-years-desktop.json',
    '/nuvio-collections-unified.json', '/nuvio-collections-unified-desktop.json'].includes(url.pathname))
    return send(res, 200, cachedJsonPayload(origin, now, url.pathname,
      () => buildRecentYearsCollections(origin, now, url.pathname.includes('desktop') ? 'desktop' : 'shield')));
  if (url.pathname === '/nuvio-collections-year-by-year.json' || url.pathname === '/nuvio-collections-year-by-year-desktop.json')
    return send(res, 200, cachedJsonPayload(origin, now, url.pathname,
      () => buildYearByYearCollections(origin, now, url.pathname.includes('desktop') ? 'desktop' : 'shield')));
  if (url.pathname === '/nuvio-collections-fast.json' || url.pathname === '/nuvio-collections-fast-desktop.json')
    return send(res, 200, cachedJsonPayload(origin, now, url.pathname,
      () => buildFastCollections(origin, now, url.pathname.includes('desktop') ? 'desktop' : 'shield')));
  if (['/nuvio-collections.json', '/collections.json', '/nuvio-collections-desktop.json'].includes(url.pathname))
    return send(res, 200, cachedJsonPayload(origin, now, url.pathname,
      () => buildCollections(origin, now, url.pathname.includes('desktop') ? 'desktop' : 'shield')));
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
  // Old Films Monde JPEG routes must never run Sharp or re-render a card.
  // Existing legacy cover links get a cheap HTTP redirect to the approved
  // prebuilt WebP, while per-film JPEG renderers are permanently unavailable.
  if (['/cover.jpg', '/backdrop.jpg'].includes(url.pathname)) {
    res.statusCode = 302;
    res.setHeader('Location', origin + '/artwork/genre/all.webp?v=' + art.REVISION);
    res.setHeader('Cache-Control', 'no-store');
    return res.end();
  }
  if (url.pathname === '/content-card.jpg') {
    res.statusCode = 410;
    res.setHeader('Cache-Control', 'no-store');
    return res.end('Legacy Films Monde JPEG rendering removed; use direct TMDB artwork.');
  }
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
      if (!store) {
        const metas = pagedMovieCatalog(null, descriptor, now, skip, search);
        if (!metas.length) return send(res, 503, { metas: [], error: 'Index en préparation' });
        return send(res, 200, { metas: decorateMovieMetas(origin, metas, descriptor) }, 'no-store');
      }
      const started = Date.now();
      const result = cachedMovieCatalogJson(origin,descriptor,now,skip,search,
        () => decorateMovieMetas(origin,
          pagedMovieCatalog(store, descriptor, now, skip, search),descriptor));
      res.setHeader('X-Nuvio-Catalog-Cache',result.hit?'HIT':'MISS');
      res.setHeader('Server-Timing',`moviecatalog;dur=${Date.now()-started}`);
      return send(res,200,result.json,
        result.json === '{"metas":[]}' ? 'no-store' : result.policy.http);
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
      return send(res, 200, { meta: withoutFilmTitleLogo({ ...officialWorldMeta(verified, row), id: requested }) });
    }
    if (!row || !store.visible(row.id, { curated: true })) return send(res, store ? 404 : 503, { meta: null });
    return send(res, 200, { meta: withoutFilmTitleLogo({ ...store.meta(row, { curated: true, genre: store.contentKind(row) === 'standup' ? 'standup' : JSON.parse(row.genres).includes('99') ? '99' : 'all' }), id: requested }) });
  }
  return send(res, 404, { error: 'Route inconnue' });
}
module.exports = handler;
module.exports._internals = { buildManifest, buildCollections, buildFastCollections, buildYearByYearCollections, buildRecentYearsCollections, reader, officialWorldMeta, verifiedWorldCatalogMetas, pagedMovieCatalog, WORLD_PAGE_SIZE, movieCatalogCachePolicy, cachedMovieCatalogJson };
