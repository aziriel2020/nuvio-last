'use strict';

const {
  DEFAULT_TIMEZONE,
  DEFAULT_COUNTRY,
  DEFAULT_LANGUAGE,
  EVENT_MODES,
  isValidTimeZone,
  addIsoDays,
  localIsoDate,
  localTime,
  dateWindow,
  normalizeIsoDate,
  humanDate,
  humanCalendarDate,
  viewerDateTimeFromInstant,
  viewerWindowEpochBounds,
  buildInstantEvent,
  parseTmdbFallbackId,
  hasProviderInFlatrate,
  movieDetailsToMeta,
  seriesDetailsToMeta,
  baseMeta,
  cleanCatalogMeta,
  sortAndDedupeMetas,
  catalogCacheKey,
  episodeCode,
  stripHtml,
  normalizeTitle
} = require('../src/calendar');

const VERSION = '4.0.1';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TVMAZE_BASE = 'https://api.tvmaze.com';
const ANILIST_URL = 'https://graphql.anilist.co';
const DEFAULT_MAX_CANDIDATES = 80;
const DEFAULT_MAX_ITEMS = 60;
const ENRICH_CONCURRENCY = 8;
const CATALOG_TTL_MS = 15 * 60 * 1000;
const DETAILS_TTL_MS = 15 * 60 * 1000;
const PROVIDERS_TTL_MS = 6 * 60 * 60 * 1000;
const TVMAZE_SCHEDULE_TTL_MS = 10 * 60 * 1000;
const ANILIST_SCHEDULE_TTL_MS = 10 * 60 * 1000;
const MAPPING_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const SOURCE_VERSION = 'temporal-v4';

const PROVIDERS = [
  { slug: 'netflix', label: 'Netflix', aliases: ['Netflix', 'Netflix Standard with Ads'] },
  { slug: 'prime-video', label: 'Prime Video', aliases: ['Amazon Prime Video', 'Prime Video', 'Amazon Prime Video with Ads'] },
  { slug: 'disney-plus', label: 'Disney+', aliases: ['Disney Plus', 'Disney+'] },
  { slug: 'max', label: 'Max', aliases: ['Max', 'HBO Max'] },
  { slug: 'apple-tv-plus', label: 'Apple TV+', aliases: ['Apple TV Plus', 'Apple TV+'] },
  { slug: 'hulu', label: 'Hulu', aliases: ['Hulu'] },
  { slug: 'paramount-plus', label: 'Paramount+', aliases: ['Paramount Plus', 'Paramount+'] },
  { slug: 'peacock', label: 'Peacock', aliases: ['Peacock Premium', 'Peacock Premium Plus', 'Peacock'] },
  { slug: 'crunchyroll', label: 'Crunchyroll', aliases: ['Crunchyroll'] }
];

const PROVIDER_BY_SLUG = new Map(PROVIDERS.map((provider) => [provider.slug, provider]));

const CATALOGS = {};
for (const provider of PROVIDERS) {
  CATALOGS[`${provider.slug}-movie-upcoming`] = {
    type: 'movie',
    name: `${provider.label} • Films`,
    providerSlug: provider.slug,
    period: 'week',
    source: 'tmdb-streaming'
  };
  CATALOGS[`${provider.slug}-series-upcoming`] = {
    type: 'series',
    name: `${provider.label} • Séries`,
    providerSlug: provider.slug,
    period: 'week',
    source: 'tmdb-streaming'
  };
}
Object.assign(CATALOGS, {
  'us-tv-today': {
    type: 'series',
    name: 'TV USA • Aujourd’hui',
    providerSlug: 'tv-usa',
    period: 'today',
    source: 'tvmaze-broadcast'
  },
  'us-tv-upcoming': {
    type: 'series',
    name: 'TV USA • À venir',
    providerSlug: 'tv-usa',
    period: 'upcoming',
    source: 'tvmaze-broadcast'
  },
  'anime-today': {
    type: 'series',
    name: 'Anime • Aujourd’hui',
    providerSlug: 'anime',
    period: 'today',
    source: 'anilist-airing'
  },
  'anime-upcoming': {
    type: 'series',
    name: 'Anime • À venir',
    providerSlug: 'anime',
    period: 'upcoming',
    source: 'anilist-airing'
  }
});

class MemoryCache {
  constructor() {
    this.map = new Map();
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value, ttlMs) {
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  }

  clear() {
    this.map.clear();
  }
}

const catalogCache = new MemoryCache();
const detailsCache = new MemoryCache();
const providerCache = new MemoryCache();
const tvmazeCache = new MemoryCache();
const anilistCache = new MemoryCache();
const mappingCache = new MemoryCache();

function json(res, status, body, cache = 'private, max-age=60') {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', cache);
  res.end(JSON.stringify(body));
}

function html(res, body) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(body);
}

function svg(res, body) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
  res.end(body);
}

function requestOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

function requestTimeZone(req) {
  const fromVercel = req?.headers?.['x-vercel-ip-timezone'];
  return isValidTimeZone(fromVercel) ? fromVercel : DEFAULT_TIMEZONE;
}

function getConfig() {
  return {
    language: process.env.TMDB_LANGUAGE || DEFAULT_LANGUAGE,
    maxCandidates: Math.max(10, Math.min(200, Number(process.env.MAX_CANDIDATES || DEFAULT_MAX_CANDIDATES))),
    maxItems: Math.max(1, Math.min(100, Number(process.env.MAX_ITEMS || DEFAULT_MAX_ITEMS))),
    token: process.env.TMDB_READ_TOKEN || null,
    apiKey: process.env.TMDB_API_KEY || null,
    debug: /^(1|true|yes|on)$/i.test(process.env.DEBUG || ''),
    tmdbTimeoutMs: Math.max(1000, Math.min(20000, Number(process.env.TMDB_TIMEOUT_MS || 8000))),
    sourceTimeoutMs: Math.max(1000, Math.min(20000, Number(process.env.SOURCE_TIMEOUT_MS || 8000))),
    retryBaseMs: Math.max(1, Math.min(5000, Number(process.env.RETRY_BASE_MS || process.env.TMDB_RETRY_BASE_MS || 250)))
  };
}

function requireTmdbConfig() {
  const config = getConfig();
  if (!config.token && !config.apiKey) {
    const err = new Error('TMDB_READ_TOKEN or TMDB_API_KEY is required');
    err.code = 'TMDB_CONFIG_MISSING';
    throw err;
  }
  return config;
}

function buildManifest(origin) {
  const catalogs = [];
  for (const provider of PROVIDERS) {
    for (const type of ['movie', 'series']) {
      const id = `${provider.slug}-${type}-upcoming`;
      catalogs.push({
        type,
        id,
        name: CATALOGS[id].name,
        pageSize: getConfig().maxItems,
        showInHome: true
      });
    }
  }
  for (const id of ['us-tv-today', 'us-tv-upcoming', 'anime-today', 'anime-upcoming']) {
    const catalog = CATALOGS[id];
    catalogs.push({
      type: catalog.type,
      id,
      name: catalog.name,
      pageSize: getConfig().maxItems,
      showInHome: true
    });
  }

  return {
    id: 'com.nuvio.usareleases',
    version: VERSION,
    name: 'Nuvio USA Releases',
    description: 'Calendrier temporel des nouvelles sorties streaming US, diffusions TV USA et anime, adapté au fuseau du spectateur.',
    logo: `${origin}/logo.svg`,
    background: `${origin}/background.svg`,
    resources: [
      { name: 'catalog', types: ['movie', 'series'] },
      { name: 'meta', types: ['movie', 'series'], idPrefixes: ['tt', 'tmdb:movie:', 'tmdb:tv:'] }
    ],
    types: ['movie', 'series'],
    idPrefixes: ['tt', 'tmdb:movie:', 'tmdb:tv:'],
    catalogs,
    behaviorHints: { configurable: false, configurationRequired: false, newEpisodeNotifications: false },
    language: 'fr'
  };
}

class SourceHttpError extends Error {
  constructor(source, status, path, statusMessage = null) {
    super(`${source} ${status} on ${path}${statusMessage ? `: ${statusMessage}` : ''}`);
    this.name = 'SourceHttpError';
    this.code = `${source.toUpperCase()}_HTTP_ERROR`;
    this.source = source;
    this.status = status;
    this.path = path;
    this.statusMessage = statusMessage;
  }
}

class TmdbHttpError extends SourceHttpError {
  constructor(status, path, statusMessage = null) {
    super('tmdb', status, path, statusMessage);
    this.name = 'TmdbHttpError';
    this.code = 'TMDB_HTTP_ERROR';
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryableStatus(status) {
  return status === 429 || [500, 502, 503, 504].includes(status);
}

async function tmdbFetch(path, params = {}) {
  const config = requireTmdbConfig();
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const url = new URL(`${TMDB_BASE}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    if (!config.token && config.apiKey) url.searchParams.set('api_key', config.apiKey);

    const headers = { Accept: 'application/json', 'User-Agent': `NuvioUSAReleases/${VERSION}` };
    if (config.token) headers.Authorization = `Bearer ${config.token}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.tmdbTimeoutMs);
    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      if (response.ok) return await response.json();

      let statusMessage = null;
      try {
        const payload = await response.json();
        statusMessage = payload?.status_message || payload?.message || null;
      } catch {}

      if (attempt < maxAttempts && retryableStatus(response.status)) {
        const retryAfter = Number(response.headers?.get?.('retry-after'));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(3000, retryAfter * 1000)
          : config.retryBaseMs * (2 ** (attempt - 1));
        await sleep(waitMs);
        continue;
      }
      throw new TmdbHttpError(response.status, path, statusMessage);
    } catch (error) {
      if (error?.name === 'AbortError' && attempt < maxAttempts) {
        await sleep(config.retryBaseMs * (2 ** (attempt - 1)));
        continue;
      }
      if (error?.name === 'AbortError') {
        const timeoutError = new Error(`TMDb timeout on ${path}`);
        timeoutError.code = 'TMDB_TIMEOUT';
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`TMDb request failed on ${path}`);
}

async function sourceFetchJson(source, url, options = {}, maxAttempts = 2) {
  const config = getConfig();
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.sourceTimeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (response.ok) return await response.json();
      let message = null;
      try {
        const payload = await response.json();
        message = payload?.message || payload?.error || payload?.errors?.[0]?.message || null;
      } catch {}
      if (attempt < maxAttempts && retryableStatus(response.status)) {
        await sleep(config.retryBaseMs * (2 ** (attempt - 1)));
        continue;
      }
      throw new SourceHttpError(source, response.status, new URL(url).pathname, message);
    } catch (error) {
      if (error?.name === 'AbortError' && attempt < maxAttempts) {
        await sleep(config.retryBaseMs * (2 ** (attempt - 1)));
        continue;
      }
      if (error?.name === 'AbortError') {
        const timeoutError = new Error(`${source} timeout`);
        timeoutError.code = `${source.toUpperCase()}_TIMEOUT`;
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`${source} request failed`);
}

function normalizeProviderName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function providerDirectory(type) {
  const namespace = type === 'movie' ? 'movie' : 'tv';
  const cacheKey = `providers:${namespace}:US:${getConfig().language}`;
  const cached = providerCache.get(cacheKey);
  if (cached) return cached;
  const payload = await tmdbFetch(`/watch/providers/${namespace}`, {
    language: getConfig().language,
    watch_region: DEFAULT_COUNTRY
  });
  const list = (payload?.results || []).map((entry) => ({
    id: Number(entry?.provider_id),
    name: entry?.provider_name || '',
    normalized: normalizeProviderName(entry?.provider_name)
  })).filter((entry) => Number.isFinite(entry.id) && entry.name);
  return providerCache.set(cacheKey, list, PROVIDERS_TTL_MS);
}

function resolveProviderFromDirectory(definition, directory) {
  const aliasSet = new Set(definition.aliases.map(normalizeProviderName));
  const matches = directory.filter((entry) => aliasSet.has(entry.normalized));
  return {
    ...definition,
    ids: [...new Set(matches.map((entry) => entry.id))],
    matchedNames: [...new Set(matches.map((entry) => entry.name))]
  };
}

async function resolveProvider(providerSlug, type) {
  const definition = PROVIDER_BY_SLUG.get(providerSlug);
  if (!definition) return null;
  const directory = await providerDirectory(type);
  return resolveProviderFromDirectory(definition, directory);
}

function discoverParams(catalog, window, providerIds, page, timeZone = DEFAULT_TIMEZONE) {
  const common = {
    language: getConfig().language,
    page,
    include_adult: false,
    sort_by: 'popularity.desc',
    watch_region: DEFAULT_COUNTRY,
    with_watch_providers: providerIds.join('|'),
    with_watch_monetization_types: 'flatrate'
  };

  if (catalog.type === 'movie') {
    return {
      ...common,
      region: DEFAULT_COUNTRY,
      'release_date.gte': window.start,
      'release_date.lte': window.end,
      with_release_type: '4'
    };
  }

  // For streaming series, TMDb air_date is used only as a candidate date.
  // It remains a calendar date and is never converted as a timezone instant.
  return {
    ...common,
    'air_date.gte': window.start,
    'air_date.lte': window.end,
    include_null_first_air_dates: false
  };
}

function fallbackDiscoverParams(catalog, window, providerIds, page, timeZone) {
  const params = discoverParams(catalog, window, providerIds, page, timeZone);
  delete params.watch_region;
  delete params.with_watch_providers;
  delete params.with_watch_monetization_types;
  return params;
}

async function discoverCandidates(catalog, window, providerIds, timeZone) {
  const endpoint = catalog.type === 'movie' ? '/discover/movie' : '/discover/tv';
  const maxCandidates = getConfig().maxCandidates;
  const items = [];
  for (let page = 1; page <= 5 && items.length < maxCandidates; page += 1) {
    let payload;
    try {
      payload = await tmdbFetch(endpoint, discoverParams(catalog, window, providerIds, page, timeZone));
    } catch (error) {
      if (error?.code === 'TMDB_HTTP_ERROR' && [400, 422].includes(error.status)) {
        payload = await tmdbFetch(endpoint, fallbackDiscoverParams(catalog, window, providerIds, page, timeZone));
      } else {
        throw error;
      }
    }
    items.push(...(payload?.results || []));
    if (page >= Number(payload?.total_pages || 1)) break;
  }
  return items.slice(0, maxCandidates);
}

async function mapLimitSettled(items, limit, mapper) {
  const results = [];
  for (let start = 0; start < items.length; start += limit) {
    const chunk = items.slice(start, start + limit);
    const settled = await Promise.allSettled(chunk.map((item, index) => mapper(item, start + index)));
    for (const result of settled) {
      if (result.status === 'fulfilled') results.push(result.value);
      else results.push({ error: result.reason });
    }
  }
  return results;
}

async function fetchDetails(type, tmdbId) {
  const cacheKey = `details:${type}:${tmdbId}:${getConfig().language}`;
  const cached = detailsCache.get(cacheKey);
  if (cached) return cached;
  const namespace = type === 'movie' ? 'movie' : 'tv';
  const append = type === 'movie'
    ? 'external_ids,watch/providers,release_dates'
    : 'external_ids,watch/providers';
  const details = await tmdbFetch(`/${namespace}/${tmdbId}`, {
    language: getConfig().language,
    append_to_response: append
  });
  return detailsCache.set(cacheKey, details, DETAILS_TTL_MS);
}

function emptyStats(provider, catalog, window, timeZone) {
  return {
    provider: provider?.label || catalog.providerSlug,
    providerSlug: catalog.providerSlug,
    source: catalog.source,
    providerIds: provider?.ids || [],
    type: catalog.type,
    period: catalog.period,
    timezone: timeZone,
    today: window.today,
    start: window.start,
    end: window.end,
    candidates: 0,
    excludedPast: 0,
    excludedDateUnknown: 0,
    excludedOutsideWindow: 0,
    excludedWrongProvider: 0,
    excludedNoImdb: 0,
    excludedMapping: 0,
    enrichmentErrors: 0,
    duplicatesRemoved: 0,
    final: 0
  };
}

function countReason(stats, reason) {
  if (reason === 'past') stats.excludedPast += 1;
  else if (reason === 'date-unknown') stats.excludedDateUnknown += 1;
  else if (reason === 'outside-window') stats.excludedOutsideWindow += 1;
}

async function buildStreamingCatalog({ catalog, timeZone, now = new Date(), period = catalog.period, useCache = true }) {
  const window = dateWindow(period, now, timeZone);
  const key = catalogCacheKey({
    providerSlug: catalog.providerSlug,
    type: catalog.type,
    period,
    timeZone,
    today: window.today,
    sourceVersion: SOURCE_VERSION
  });
  if (useCache) {
    const cached = catalogCache.get(key);
    if (cached) return cached;
  }

  const provider = await resolveProvider(catalog.providerSlug, catalog.type);
  const stats = emptyStats(provider, { ...catalog, period }, window, timeZone);
  if (!provider?.ids?.length) {
    const result = { metas: [], stats };
    return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
  }

  const raw = await discoverCandidates({ ...catalog, period }, window, provider.ids, timeZone);
  stats.candidates = raw.length;

  const settled = await mapLimitSettled(raw, ENRICH_CONCURRENCY, async (candidate) => {
    const details = await fetchDetails(catalog.type, candidate.id);
    if (!hasProviderInFlatrate(details, provider.ids)) return { meta: null, reason: 'wrong-provider' };
    if (catalog.type === 'movie') return movieDetailsToMeta(details, provider.label, window);
    return seriesDetailsToMeta(details, provider.label, window);
  });

  const metas = [];
  for (const result of settled) {
    if (result?.error) {
      stats.enrichmentErrors += 1;
      continue;
    }
    if (result?.reason === 'wrong-provider') {
      stats.excludedWrongProvider += 1;
      continue;
    }
    if (!result?.meta) {
      countReason(stats, result?.reason);
      continue;
    }
    metas.push(result.meta);
  }

  const sorted = sortAndDedupeMetas(metas);
  stats.duplicatesRemoved = Math.max(0, metas.length - sorted.length);
  const finalMetas = sorted.slice(0, getConfig().maxItems).map(cleanCatalogMeta);
  stats.final = finalMetas.length;
  const result = { metas: finalMetas, stats };
  return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
}

function isoDateRange(start, end) {
  const values = [];
  for (let current = normalizeIsoDate(start); current && current <= end; current = addIsoDays(current, 1)) {
    values.push(current);
  }
  return values;
}

async function tvmazeFetch(path, params = {}) {
  const url = new URL(`${TVMAZE_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return sourceFetchJson('tvmaze', url, { headers: { Accept: 'application/json', 'User-Agent': `NuvioUSAReleases/${VERSION}` } });
}

async function tvmazeScheduleDate(sourceDate) {
  const key = `tvmaze:schedule:US:${sourceDate}`;
  const cached = tvmazeCache.get(key);
  if (cached) return cached;
  const payload = await tvmazeFetch('/schedule', { country: 'US', date: sourceDate });
  const list = Array.isArray(payload) ? payload : [];
  return tvmazeCache.set(key, list, TVMAZE_SCHEDULE_TTL_MS);
}

function tvmazeShowFromEpisode(episode) {
  return episode?._embedded?.show || episode?.show || null;
}

function tvmazeSourceTimezone(show) {
  const zone = show?.network?.country?.timezone || null;
  return isValidTimeZone(zone) ? zone : null;
}

function tvmazeBroadcastToMeta(episode, timeZone, window, now = new Date()) {
  const show = tvmazeShowFromEpisode(episode);
  if (!show?.network || show?.network?.country?.code !== 'US') return { meta: null, reason: 'not-us-broadcast' };
  if (!episode?.airstamp) return { meta: null, reason: 'date-unknown' };
  const imdbId = show?.externals?.imdb || null;
  if (!/^tt\d+$/.test(String(imdbId || ''))) return { meta: null, reason: 'no-imdb' };

  const sourceTimezone = tvmazeSourceTimezone(show);
  const sourceLocal = sourceTimezone ? viewerDateTimeFromInstant(episode.airstamp, sourceTimezone) : null;
  const eventResult = buildInstantEvent({
    eventMode: EVENT_MODES.BROADCAST_INSTANT,
    eventInstant: episode.airstamp,
    viewerTimezone: timeZone,
    window,
    sourceTimezone,
    sourceDate: sourceLocal?.date || episode.airdate || null,
    sourceTime: sourceLocal?.time || episode.airtime || null
  });
  if (!eventResult.event) return { meta: null, reason: eventResult.reason };
  const event = eventResult.event;
  const code = episodeCode({ season: episode.season, number: episode.number });
  const viewerLabel = `${humanDate(event.viewerDate, timeZone, window.today)} • ${event.viewerTime}`;
  const sourceLabel = sourceLocal
    ? `${humanCalendarDate(sourceLocal.date)} • ${sourceLocal.time}${sourceLocal.timeZoneLabel ? ` ${sourceLocal.timeZoneLabel}` : ''}`
    : [episode.airdate, episode.airtime].filter(Boolean).join(' • ');
  const episodeTitle = episode?.name ? `${code} — ${episode.name}` : code;
  const summary = stripHtml(episode?.summary) || stripHtml(show?.summary);
  const description = [
    episodeTitle,
    sourceLabel ? `Diffusion US : ${sourceLabel}` : null,
    'Horaires : TVmaze',
    summary
  ].filter(Boolean).join('\n\n');

  const runtime = Number(episode?.runtime || show?.runtime || 0) || null;
  const meta = {
    id: imdbId,
    type: 'series',
    name: show.name || 'Sans titre',
    poster: show?.image?.original || show?.image?.medium || null,
    posterShape: 'poster',
    background: show?.image?.original || null,
    landscapePoster: show?.image?.original || null,
    description,
    releaseInfo: `${code} • ${viewerLabel}`,
    released: event.viewerDate,
    status: show?.status || null,
    imdbRating: Number.isFinite(show?.rating?.average) ? Number(show.rating.average).toFixed(1) : null,
    imdb_id: imdbId,
    genres: Array.isArray(show?.genres) ? show.genres : [],
    runtime: runtime ? `${runtime} min` : null,
    country: 'United States',
    language: show?.language || null,
    behaviorHints: { hasScheduledVideos: true },
    _popularity: Number(show?.weight || 0),
    _voteCount: 0,
    _dedupeKey: `tvmaze:${show.id}:${episode.id || `${episode.season}:${episode.number}`}`,
    _eventInstantMs: event.eventInstantMs,
    _eventHasTime: true,
    _eventMode: event.eventMode,
    _eventStatus: event.eventInstant ? temporalStatus(event, now, runtime) : null
  };
  return { meta, reason: null, event };
}

function temporalStatus(event, now, runtime) {
  const start = new Date(event.eventInstant).getTime();
  if (!Number.isFinite(start)) return null;
  const diff = start - now.getTime();
  const end = start + (Number(runtime) > 0 ? Number(runtime) * 60_000 : 0);
  if (diff > 60 * 60_000) return 'UPCOMING';
  if (diff > 0) return 'AIRING_SOON';
  if (end > start && now.getTime() < end) return 'AIRING_NOW';
  return 'RELEASED_TODAY';
}

async function buildTvBroadcastCatalog({ catalog, timeZone, now = new Date(), period = catalog.period, useCache = true }) {
  const window = dateWindow(period, now, timeZone);
  const key = catalogCacheKey({
    providerSlug: 'tv-usa',
    type: 'series',
    period,
    timeZone,
    today: window.today,
    sourceVersion: SOURCE_VERSION
  });
  if (useCache) {
    const cached = catalogCache.get(key);
    if (cached) return cached;
  }
  const stats = emptyStats(null, { ...catalog, period }, window, timeZone);
  const sourceDates = isoDateRange(addIsoDays(window.start, -2), addIsoDays(window.end, 2));
  const scheduleResults = await mapLimitSettled(sourceDates, 4, async (sourceDate) => tvmazeScheduleDate(sourceDate));
  const raw = scheduleResults.flatMap((result) => Array.isArray(result) ? result : []);
  stats.candidates = raw.length;
  stats.enrichmentErrors += scheduleResults.filter((result) => result?.error).length;

  const metas = [];
  for (const episode of raw) {
    const converted = tvmazeBroadcastToMeta(episode, timeZone, window, now);
    if (!converted.meta) {
      if (converted.reason === 'no-imdb') stats.excludedNoImdb += 1;
      else if (converted.reason !== 'not-us-broadcast') countReason(stats, converted.reason);
      continue;
    }
    metas.push(converted.meta);
  }

  const sorted = sortAndDedupeMetas(metas);
  stats.duplicatesRemoved = Math.max(0, metas.length - sorted.length);
  const finalMetas = sorted.slice(0, getConfig().maxItems).map(cleanCatalogMeta);
  stats.final = finalMetas.length;
  const result = { metas: finalMetas, stats };
  return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
}


async function tvmazeWebScheduleDate(calendarDate) {
  const key = `tvmaze:web-schedule:${calendarDate}`;
  const cached = tvmazeCache.get(key);
  if (cached) return cached;
  // No country parameter: TVmaze returns both local and global web channels.
  // Global services keep their announced civil airdate and normally have no airtime.
  const payload = await tvmazeFetch('/schedule/web', { date: calendarDate });
  const list = Array.isArray(payload) ? payload : [];
  return tvmazeCache.set(key, list, TVMAZE_SCHEDULE_TTL_MS);
}

function webChannelMatchesProvider(show, provider) {
  const name = show?.webChannel?.name || '';
  if (!name || !provider) return false;
  const normalized = normalizeProviderName(name);
  const aliases = new Set([provider.label, ...(provider.aliases || [])].map(normalizeProviderName));
  return aliases.has(normalized);
}

async function resolveTvmazeShowToTmdb(show) {
  const cacheKey = `tvmaze-map:${show?.id}`;
  const cached = mappingCache.get(cacheKey);
  if (cached !== null && cached !== undefined) return cached || null;
  let tmdbId = null;
  const imdb = show?.externals?.imdb;
  const tvdb = Number(show?.externals?.thetvdb);
  if (/^tt\d+$/.test(String(imdb || ''))) {
    tmdbId = await lookupTmdbFromExternal(imdb, 'series', 'imdb_id');
  } else if (Number.isFinite(tvdb) && tvdb > 0) {
    tmdbId = await lookupTmdbFromExternal(tvdb, 'series', 'tvdb_id');
  }
  mappingCache.set(cacheKey, tmdbId || 0, MAPPING_TTL_MS);
  return tmdbId || null;
}

function tvmazeStreamingEpisodeToMeta(episode, details, provider, timeZone, window) {
  const show = tvmazeShowFromEpisode(episode);
  const calendarDate = normalizeIsoDate(episode?.airdate);
  if (!calendarDate) return { meta: null, reason: 'date-unknown' };
  if (calendarDate < window.today) return { meta: null, reason: 'past' };
  if (calendarDate < window.start || calendarDate > window.end) return { meta: null, reason: 'outside-window' };

  const code = episodeCode({ season: episode.season, number: episode.number });
  const isLocalUsWebChannel = show?.webChannel?.country?.code === 'US';
  let event = {
    eventMode: EVENT_MODES.STREAMING_DATE,
    calendarDate,
    viewerDate: calendarDate,
    viewerTime: null,
    eventInstant: null,
    eventInstantMs: null
  };

  // TVmaze documents airtime for local web channels as the time the episode
  // was first made available. Global web channels intentionally have no release time.
  if (isLocalUsWebChannel && episode?.airstamp) {
    const viewer = viewerDateTimeFromInstant(episode.airstamp, timeZone);
    if (viewer) {
      event = {
        ...event,
        eventMode: EVENT_MODES.STREAMING_INSTANT,
        eventInstant: viewer.instant,
        eventInstantMs: new Date(viewer.instant).getTime(),
        viewerTime: viewer.time,
        convertedViewerDate: viewer.date
      };
    }
  }

  const dateLabel = humanDate(calendarDate, timeZone, window.today);
  const releaseInfo = event.viewerTime
    ? `${code} • ${dateLabel} • ${event.viewerTime}`
    : `${code} • ${dateLabel}`;
  const meta = baseMeta(details, 'series', calendarDate, releaseInfo);
  const episodeSummary = stripHtml(episode?.summary);
  const timingNote = event.viewerTime
    ? `${provider.label} US • heure de mise en ligne TVmaze convertie en ${timeZone}`
    : `${provider.label} US • date streaming officielle, heure non annoncée`;
  meta.description = [
    `${code}${episode?.name ? ` — ${episode.name}` : ''}`,
    timingNote,
    episodeSummary,
    meta.description
  ].filter(Boolean).join('\n\n');
  meta._eventInstantMs = event.eventInstantMs;
  meta._eventHasTime = Boolean(event.viewerTime);
  meta._eventMode = event.eventMode;
  meta._dedupeKey = `stream:${details.id}:${episode.season || 0}:${episode.number || episode.id}`;
  return { meta, reason: null, event };
}

async function buildStreamingSeriesCatalog({ catalog, timeZone, now = new Date(), period = catalog.period, useCache = true }) {
  const window = dateWindow(period, now, timeZone);
  const key = catalogCacheKey({
    providerSlug: catalog.providerSlug,
    type: 'series',
    period,
    timeZone,
    today: window.today,
    sourceVersion: `${SOURCE_VERSION}-webschedule`
  });
  if (useCache) {
    const cached = catalogCache.get(key);
    if (cached) return cached;
  }

  const provider = await resolveProvider(catalog.providerSlug, 'series');
  const stats = emptyStats(provider, { ...catalog, period, source: 'tvmaze-web+tmdb' }, window, timeZone);
  if (!provider?.ids?.length) {
    const result = { metas: [], stats };
    return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
  }

  const dates = isoDateRange(window.start, window.end);
  const scheduleResults = await mapLimitSettled(dates, 4, (date) => tvmazeWebScheduleDate(date));
  const allEpisodes = scheduleResults.flatMap((result) => Array.isArray(result) ? result : []);
  stats.enrichmentErrors += scheduleResults.filter((result) => result?.error).length;
  const providerEpisodes = allEpisodes.filter((episode) => webChannelMatchesProvider(tvmazeShowFromEpisode(episode), provider));
  stats.candidates = providerEpisodes.length;

  const settled = await mapLimitSettled(providerEpisodes.slice(0, getConfig().maxCandidates), 5, async (episode) => {
    const show = tvmazeShowFromEpisode(episode);
    const tmdbId = await resolveTvmazeShowToTmdb(show);
    if (!tmdbId) return { meta: null, reason: 'mapping' };
    const details = await fetchDetails('series', tmdbId);
    if (!hasProviderInFlatrate(details, provider.ids)) return { meta: null, reason: 'wrong-provider' };
    return tvmazeStreamingEpisodeToMeta(episode, details, provider, timeZone, window);
  });

  const metas = [];
  for (const result of settled) {
    if (result?.error) {
      stats.enrichmentErrors += 1;
      continue;
    }
    if (result?.reason === 'mapping') {
      stats.excludedMapping += 1;
      continue;
    }
    if (result?.reason === 'wrong-provider') {
      stats.excludedWrongProvider += 1;
      continue;
    }
    if (!result?.meta) {
      countReason(stats, result?.reason);
      continue;
    }
    metas.push(result.meta);
  }

  const sorted = sortAndDedupeMetas(metas);
  stats.duplicatesRemoved = Math.max(0, metas.length - sorted.length);
  const finalMetas = sorted.slice(0, getConfig().maxItems).map(cleanCatalogMeta);
  stats.final = finalMetas.length;
  const result = { metas: finalMetas, stats };
  return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
}

const ANILIST_AIRING_QUERY = `
query ($page: Int, $start: Int, $end: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { currentPage hasNextPage }
    airingSchedules(airingAt_greater: $start, airingAt_lesser: $end) {
      id
      airingAt
      episode
      mediaId
      media {
        id
        idMal
        title { romaji english native }
        seasonYear
        countryOfOrigin
        format
        status
        isAdult
        duration
        popularity
        averageScore
        genres
        description(asHtml: false)
        coverImage { extraLarge large }
        bannerImage
      }
    }
  }
}`;

const ANILIST_AIRING_BY_ID_QUERY = `
query ($id: Int) {
  AiringSchedule(id: $id) {
    id
    airingAt
    episode
    mediaId
    media {
      id idMal seasonYear countryOfOrigin format status isAdult duration popularity averageScore genres
      title { romaji english native }
      description(asHtml: false)
      coverImage { extraLarge large }
      bannerImage
    }
  }
}`;

async function anilistFetch(query, variables = {}) {
  return sourceFetchJson('anilist', ANILIST_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': `NuvioUSAReleases/${VERSION}`
    },
    body: JSON.stringify({ query, variables })
  });
}

async function anilistSchedules(window, timeZone) {
  const bounds = viewerWindowEpochBounds(window, timeZone);
  if (!bounds) return [];
  const key = `anilist:schedule:${timeZone}:${window.start}:${window.end}`;
  const cached = anilistCache.get(key);
  if (cached) return cached;

  const all = [];
  for (let page = 1; page <= 8; page += 1) {
    const payload = await anilistFetch(ANILIST_AIRING_QUERY, {
      page,
      start: bounds.startEpoch - 1,
      end: bounds.endExclusiveEpoch
    });
    if (payload?.errors?.length) throw new SourceHttpError('anilist', 502, '/graphql', payload.errors[0]?.message || 'GraphQL error');
    const section = payload?.data?.Page;
    all.push(...(section?.airingSchedules || []));
    if (!section?.pageInfo?.hasNextPage) break;
  }
  return anilistCache.set(key, all, ANILIST_SCHEDULE_TTL_MS);
}

function animeTitles(media) {
  return [...new Set([
    media?.title?.english,
    media?.title?.romaji,
    media?.title?.native
  ].filter(Boolean))];
}

function candidateMatchesAnime(candidate, media) {
  const expected = new Set(animeTitles(media).map(normalizeTitle).filter(Boolean));
  if (!expected.size) return false;
  const names = [candidate?.name, candidate?.original_name].map(normalizeTitle).filter(Boolean);
  if (!names.some((name) => expected.has(name))) return false;
  const year = Number(media?.seasonYear);
  if (Number.isFinite(year)) {
    const candidateYear = Number(String(candidate?.first_air_date || '').slice(0, 4));
    if (!Number.isFinite(candidateYear) || candidateYear !== year) return false;
  }
  return true;
}

async function resolveAnimeToTmdb(media) {
  const key = `anime-map:${media?.id}`;
  const cached = mappingCache.get(key);
  if (cached !== null && cached !== undefined) return cached;
  const titles = animeTitles(media).slice(0, 2);
  let candidates = [];
  for (const title of titles) {
    const params = { query: title, include_adult: false, language: getConfig().language };
    if (Number.isFinite(Number(media?.seasonYear))) params.first_air_date_year = Number(media.seasonYear);
    const payload = await tmdbFetch('/search/tv', params);
    candidates.push(...(payload?.results || []));
  }
  const unique = [...new Map(candidates.map((candidate) => [Number(candidate.id), candidate])).values()];
  const matches = unique.filter((candidate) => candidateMatchesAnime(candidate, media));
  matches.sort((a, b) => {
    const langA = a.original_language === 'ja' ? 1 : 0;
    const langB = b.original_language === 'ja' ? 1 : 0;
    if (langA !== langB) return langB - langA;
    return Number(b.popularity || 0) - Number(a.popularity || 0);
  });
  const tmdbId = Number(matches[0]?.id) || null;
  mappingCache.set(key, tmdbId || 0, MAPPING_TTL_MS);
  return tmdbId || null;
}

function animeScheduleToMeta(schedule, details, timeZone, window) {
  if (!schedule?.airingAt || !schedule?.episode || schedule?.media?.isAdult) return { meta: null, reason: 'date-unknown' };
  const eventResult = buildInstantEvent({
    eventMode: EVENT_MODES.ANIME_ORIGINAL_AIRING,
    eventInstant: new Date(Number(schedule.airingAt) * 1000),
    viewerTimezone: timeZone,
    window,
    sourceTimezone: null
  });
  if (!eventResult.event) return { meta: null, reason: eventResult.reason };
  const event = eventResult.event;
  const episodeLabel = `Épisode ${schedule.episode}`;
  const info = `${episodeLabel} • ${humanDate(event.viewerDate, timeZone, window.today)} • ${event.viewerTime}`;
  const meta = baseMeta(details, 'series', event.viewerDate, info);
  const anilistTitle = schedule?.media?.title?.english || schedule?.media?.title?.romaji || null;
  if (anilistTitle) meta.name = anilistTitle;
  if (schedule?.media?.coverImage?.extraLarge) meta.poster = schedule.media.coverImage.extraLarge;
  if (schedule?.media?.bannerImage) {
    meta.background = schedule.media.bannerImage;
    meta.landscapePoster = schedule.media.bannerImage;
  }
  meta.description = [
    `${episodeLabel} • Diffusion originale`,
    `Heure locale : ${humanCalendarDate(event.viewerDate)} • ${event.viewerTime}`,
    'Cette heure est l’airing original AniList ; elle n’est pas présentée comme une heure de mise en ligne Crunchyroll/Netflix.',
    schedule?.media?.description || meta.description
  ].filter(Boolean).join('\n\n');
  meta._eventInstantMs = event.eventInstantMs;
  meta._eventHasTime = true;
  meta._eventMode = event.eventMode;
  meta._dedupeKey = `anime:${schedule.mediaId}:${schedule.episode}`;
  meta._popularity = Number(schedule?.media?.popularity || meta._popularity || 0);
  meta._voteCount = Number(schedule?.media?.averageScore || 0);
  return { meta, reason: null, event };
}

async function buildAnimeCatalog({ catalog, timeZone, now = new Date(), period = catalog.period, useCache = true }) {
  const window = dateWindow(period, now, timeZone);
  const key = catalogCacheKey({
    providerSlug: 'anime',
    type: 'series',
    period,
    timeZone,
    today: window.today,
    sourceVersion: SOURCE_VERSION
  });
  if (useCache) {
    const cached = catalogCache.get(key);
    if (cached) return cached;
  }
  const stats = emptyStats(null, { ...catalog, period }, window, timeZone);
  const schedules = await anilistSchedules(window, timeZone);
  const filtered = schedules.filter((schedule) => !schedule?.media?.isAdult);
  stats.candidates = filtered.length;

  const settled = await mapLimitSettled(filtered.slice(0, getConfig().maxCandidates), 5, async (schedule) => {
    const tmdbId = await resolveAnimeToTmdb(schedule.media);
    if (!tmdbId) return { meta: null, reason: 'mapping' };
    const details = await fetchDetails('series', tmdbId);
    return animeScheduleToMeta(schedule, details, timeZone, window);
  });

  const metas = [];
  for (const result of settled) {
    if (result?.error) {
      stats.enrichmentErrors += 1;
      continue;
    }
    if (result?.reason === 'mapping') {
      stats.excludedMapping += 1;
      continue;
    }
    if (!result?.meta) {
      countReason(stats, result?.reason);
      continue;
    }
    metas.push(result.meta);
  }

  const sorted = sortAndDedupeMetas(metas);
  stats.duplicatesRemoved = Math.max(0, metas.length - sorted.length);
  const finalMetas = sorted.slice(0, getConfig().maxItems).map(cleanCatalogMeta);
  stats.final = finalMetas.length;
  const result = { metas: finalMetas, stats };
  return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
}

async function buildCatalog(options) {
  const source = options.catalog.source;
  if (source === 'tvmaze-broadcast') return buildTvBroadcastCatalog(options);
  if (source === 'anilist-airing') return buildAnimeCatalog(options);
  if (source === 'tmdb-streaming' && options.catalog.type === 'series') return buildStreamingSeriesCatalog(options);
  return buildStreamingCatalog(options);
}

async function handleCatalog(req, res, type, catalogId) {
  const catalog = CATALOGS[catalogId];
  if (!catalog || catalog.type !== type) return json(res, 404, { metas: [] });
  const timeZone = requestTimeZone(req);
  const result = await buildCatalog({ catalog, timeZone, now: new Date(), period: catalog.period, useCache: true });
  res.setHeader('Vary', 'x-vercel-ip-timezone');
  res.setHeader('X-Nuvio-Calendar-Date', result.stats.today);
  return json(res, 200, { metas: result.metas }, 'private, max-age=60');
}

async function lookupTmdbFromExternal(id, type, externalSource = 'imdb_id') {
  const payload = await tmdbFetch(`/find/${id}`, { external_source: externalSource, language: getConfig().language });
  const list = type === 'movie' ? payload.movie_results : payload.tv_results;
  return list?.[0]?.id || null;
}

async function resolveTmdbId(id, type) {
  const fallback = parseTmdbFallbackId(id, type);
  if (fallback) return fallback;
  if (/^tt\d+$/.test(id)) return lookupTmdbFromExternal(id, type, 'imdb_id');
  return null;
}

async function handleMeta(res, type, id) {
  const tmdbId = await resolveTmdbId(id, type);
  if (!tmdbId) return json(res, 404, { meta: null });
  const details = await fetchDetails(type, tmdbId);
  let releaseDate;
  let releaseInfo;
  if (type === 'series' && details?.next_episode_to_air?.air_date) {
    releaseDate = details.next_episode_to_air.air_date;
    releaseInfo = `${episodeCode(details.next_episode_to_air)} • ${humanCalendarDate(releaseDate)}`;
  } else {
    releaseDate = type === 'movie' ? details?.release_date : details?.first_air_date;
    releaseInfo = releaseDate || null;
  }
  const meta = cleanCatalogMeta(baseMeta(details, type, releaseDate, releaseInfo));
  meta.id = id;
  return json(res, 200, { meta }, 'public, max-age=300, s-maxage=1800, stale-while-revalidate=3600');
}

async function providerHealth() {
  const [movieDirectory, tvDirectory] = await Promise.all([
    providerDirectory('movie'),
    providerDirectory('series')
  ]);
  return Object.fromEntries(PROVIDERS.map((provider) => {
    const movie = resolveProviderFromDirectory(provider, movieDirectory);
    const series = resolveProviderFromDirectory(provider, tvDirectory);
    return [provider.label, Boolean(movie.ids.length || series.ids.length)];
  }));
}

async function sourceHealth() {
  const [tvmaze, anilist] = await Promise.allSettled([
    tvmazeFetch('/shows/1'),
    anilistFetch('query { Media(id: 1) { id } }')
  ]);
  return {
    tvmaze: tvmaze.status === 'fulfilled' ? 'ok' : 'error',
    anilist: anilist.status === 'fulfilled' && anilist.value?.data?.Media?.id ? 'ok' : 'error'
  };
}

async function handleHealth(req, res) {
  const configured = Boolean(getConfig().token || getConfig().apiKey);
  const timeZone = requestTimeZone(req);
  const now = new Date();
  const today = localIsoDate(now, timeZone);
  const currentTime = localTime(now, timeZone);
  if (!configured) {
    const sources = await sourceHealth().catch(() => ({ tvmaze: 'error', anilist: 'error' }));
    return json(res, 503, {
      ok: false,
      version: VERSION,
      market: DEFAULT_COUNTRY,
      timezone: timeZone,
      today,
      currentTime,
      tmdb: 'missing',
      ...sources
    }, 'no-store');
  }

  try {
    await tmdbFetch('/configuration');
    const [providers, sources] = await Promise.all([
      providerHealth(),
      sourceHealth()
    ]);
    return json(res, 200, {
      ok: true,
      version: VERSION,
      market: DEFAULT_COUNTRY,
      timezone: timeZone,
      today,
      currentTime,
      tmdb: 'ok',
      tvmaze: sources.tvmaze,
      anilist: sources.anilist,
      providers
    }, 'no-store');
  } catch (error) {
    const sources = await sourceHealth().catch(() => ({ tvmaze: 'error', anilist: 'error' }));
    return json(res, 503, {
      ok: false,
      version: VERSION,
      market: DEFAULT_COUNTRY,
      timezone: timeZone,
      today,
      currentTime,
      tmdb: 'error',
      tvmaze: sources.tvmaze,
      anilist: sources.anilist,
      tmdbStatus: error?.status || null,
      tmdbMessage: error?.statusMessage || error?.code || 'TMDb inaccessible'
    }, 'no-store');
  }
}

async function handleDebugProvider(req, res, providerSlug, url) {
  if (!getConfig().debug) return json(res, 404, { error: 'Not found' }, 'no-store');
  const definition = PROVIDER_BY_SLUG.get(providerSlug);
  if (!definition) return json(res, 404, { error: 'Unknown provider' }, 'no-store');
  const period = ['today', 'tomorrow', 'week', 'upcoming'].includes(url.searchParams.get('period'))
    ? url.searchParams.get('period')
    : 'week';
  const timeZone = requestTimeZone(req);
  const output = {};
  for (const type of ['movie', 'series']) {
    const catalog = {
      type,
      name: `${definition.label} • ${type === 'movie' ? 'Films' : 'Séries'}`,
      providerSlug,
      period,
      source: 'tmdb-streaming'
    };
    const result = await buildCatalog({ catalog, timeZone, now: new Date(), period, useCache: false });
    output[type] = result.stats;
  }
  return json(res, 200, {
    ok: true,
    version: VERSION,
    market: DEFAULT_COUNTRY,
    provider: definition.label,
    timezone: timeZone,
    today: localIsoDate(new Date(), timeZone),
    period,
    stats: output
  }, 'no-store');
}

async function handleDebugTime(req, res) {
  if (!getConfig().debug) return json(res, 404, { error: 'Not found' }, 'no-store');
  const viewerTimezone = requestTimeZone(req);
  const now = new Date();
  return json(res, 200, {
    viewerTimezone,
    viewerNow: {
      date: localIsoDate(now, viewerTimezone),
      time: localTime(now, viewerTimezone)
    },
    utcNow: now.toISOString()
  }, 'no-store');
}

async function anilistScheduleById(id) {
  const payload = await anilistFetch(ANILIST_AIRING_BY_ID_QUERY, { id: Number(id) });
  if (payload?.errors?.length) throw new SourceHttpError('anilist', 502, '/graphql', payload.errors[0]?.message || 'GraphQL error');
  return payload?.data?.AiringSchedule || null;
}

async function handleDebugAiring(req, res, debugId) {
  if (!getConfig().debug) return json(res, 404, { error: 'Not found' }, 'no-store');
  const timeZone = requestTimeZone(req);
  const now = new Date();
  const window = dateWindow('week', now, timeZone);
  if (/^tvmaze-\d+$/.test(debugId)) {
    const id = Number(debugId.slice('tvmaze-'.length));
    const episode = await tvmazeFetch(`/episodes/${id}`, { embed: 'show' });
    const converted = tvmazeBroadcastToMeta(episode, timeZone, window, now);
    return json(res, 200, {
      source: 'tvmaze',
      id,
      event: converted.event || null,
      reason: converted.reason || null
    }, 'no-store');
  }
  if (/^anilist-\d+$/.test(debugId)) {
    const id = Number(debugId.slice('anilist-'.length));
    const schedule = await anilistScheduleById(id);
    const eventResult = schedule ? buildInstantEvent({
      eventMode: EVENT_MODES.ANIME_ORIGINAL_AIRING,
      eventInstant: new Date(Number(schedule.airingAt) * 1000),
      viewerTimezone: timeZone,
      window
    }) : { event: null, reason: 'not-found' };
    return json(res, 200, {
      source: 'anilist',
      id,
      event: eventResult.event || null,
      reason: eventResult.reason || null
    }, 'no-store');
  }
  return json(res, 404, { error: 'Unknown airing id' }, 'no-store');
}

function landing(origin, timeZone = DEFAULT_TIMEZONE) {
  const manifest = `${origin}/manifest.json`;
  const configured = Boolean(getConfig().token || getConfig().apiKey);
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nuvio USA Releases</title><style>body{margin:0;background:#0b0f17;color:#f7f7fb;font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}.card{max-width:860px;margin:24px;padding:32px;border:1px solid #2a3140;border-radius:24px;background:#121824}h1{margin-top:0}.pill{display:inline-block;background:#7c4dff;padding:8px 14px;border-radius:999px;font-weight:700}code{display:block;overflow-wrap:anywhere;background:#0a0e15;padding:14px;border-radius:12px;margin:14px 0}a{color:#a98aff}.muted{color:#aab2c0}.ok{color:#7ee787}.bad{color:#ff7b72}</style></head><body><main class="card"><span class="pill">USA • TEMPORAL</span><h1>Nuvio USA Releases ${VERSION}</h1><p>Streaming US en date civile officielle, TV USA en vrai timestamp converti, et calendrier anime par airing original.</p><p>Fuseau spectateur : <b>${timeZone}</b> — Marché streaming : <b>US</b></p><p>TMDb : <b class="${configured ? 'ok' : 'bad'}">${configured ? 'configuré' : 'clé manquante'}</b></p><p>URL NuvioTV :</p><code>${manifest}</code><p><a href="${manifest}">Ouvrir manifest.json</a> · <a href="${origin}/health">Health</a></p><p class="muted">TMDb/JustWatch : métadonnées et providers US. TVmaze : horaires broadcast et web schedules. AniList : airing anime original. Les horaires anime ne sont jamais présentés comme des heures de mise en ligne Crunchyroll/Netflix sans preuve. This product uses the TMDB API but is not endorsed or certified by TMDB.</p></main></body></html>`;
}

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#0b0f17"/><rect x="80" y="84" width="352" height="344" rx="76" fill="#171d2a" stroke="#8b5cf6" stroke-width="18"/><path d="M128 188h256M128 260h256M128 332h172" stroke="#fff" stroke-width="26" stroke-linecap="round"/><text x="317" y="359" fill="#8b5cf6" font-family="Arial,sans-serif" font-size="92" font-weight="700">US</text></svg>`;
const BG = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#0b0f17"/><stop offset="1" stop-color="#24154a"/></linearGradient></defs><rect width="1920" height="1080" fill="url(#g)"/><circle cx="1500" cy="220" r="420" fill="#8b5cf6" opacity=".18"/></svg>`;

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.end();
  }
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  const origin = requestOrigin(req);
  const url = new URL(req.url, origin);
  const path = decodeURIComponent(url.pathname);

  try {
    if (path === '/' || path === '/index.html') return html(res, landing(origin, requestTimeZone(req)));
    if (path === '/manifest.json') return json(res, 200, buildManifest(origin), 'public, max-age=300, s-maxage=900');
    if (path === '/logo.svg') return svg(res, LOGO);
    if (path === '/background.svg') return svg(res, BG);
    if (path === '/health') return await handleHealth(req, res);

    if (path === '/debug/time') return await handleDebugTime(req, res);
    const debugProviderMatch = path.match(/^\/debug\/provider\/([^/]+)$/);
    if (debugProviderMatch) return await handleDebugProvider(req, res, debugProviderMatch[1], url);
    const debugAiringMatch = path.match(/^\/debug\/airing\/([^/]+)$/);
    if (debugAiringMatch) return await handleDebugAiring(req, res, debugAiringMatch[1]);

    const catalogMatch = path.match(/^\/catalog\/(movie|series)\/([^/]+)\.json$/);
    if (catalogMatch) return await handleCatalog(req, res, catalogMatch[1], catalogMatch[2]);

    const metaMatch = path.match(/^\/meta\/(movie|series)\/([^/]+)\.json$/);
    if (metaMatch) return await handleMeta(res, metaMatch[1], metaMatch[2]);

    return json(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    if (error?.code === 'TMDB_CONFIG_MISSING') {
      return json(res, 503, { error: 'Configure TMDB_READ_TOKEN ou TMDB_API_KEY sur le serveur.' }, 'no-store');
    }
    if (error?.code === 'TMDB_HTTP_ERROR') {
      return json(res, 502, {
        error: 'Impossible de charger les nouvelles sorties USA pour le moment.',
        tmdbStatus: error.status || null,
        tmdbMessage: error.statusMessage || null
      }, 'no-store');
    }
    if (error?.code === 'TMDB_TIMEOUT') return json(res, 504, { error: 'TMDb a mis trop de temps à répondre.' }, 'no-store');
    if (error?.source === 'tvmaze' || String(error?.code || '').startsWith('TVMAZE_')) {
      return json(res, 502, { error: 'TVmaze est momentanément indisponible.' }, 'no-store');
    }
    if (error?.source === 'anilist' || String(error?.code || '').startsWith('ANILIST_')) {
      return json(res, 502, { error: 'AniList est momentanément indisponible.' }, 'no-store');
    }
    return json(res, 502, { error: 'Impossible de charger le calendrier USA pour le moment.' }, 'no-store');
  }
};

module.exports._internals = {
  VERSION,
  PROVIDERS,
  CATALOGS,
  EVENT_MODES,
  MemoryCache,
  buildManifest,
  getConfig,
  requestTimeZone,
  normalizeProviderName,
  resolveProviderFromDirectory,
  discoverParams,
  fallbackDiscoverParams,
  providerDirectory,
  resolveProvider,
  fetchDetails,
  buildStreamingCatalog,
  buildStreamingSeriesCatalog,
  buildTvBroadcastCatalog,
  buildAnimeCatalog,
  buildCatalog,
  mapLimitSettled,
  tmdbFetch,
  tvmazeFetch,
  tvmazeScheduleDate,
  tvmazeWebScheduleDate,
  tvmazeBroadcastToMeta,
  tvmazeStreamingEpisodeToMeta,
  webChannelMatchesProvider,
  resolveTvmazeShowToTmdb,
  anilistFetch,
  anilistSchedules,
  anilistScheduleById,
  animeScheduleToMeta,
  candidateMatchesAnime,
  resolveAnimeToTmdb,
  SourceHttpError,
  TmdbHttpError,
  catalogCache,
  detailsCache,
  providerCache,
  tvmazeCache,
  anilistCache,
  mappingCache,
  providerHealth,
  sourceHealth,
  isoDateRange
};
