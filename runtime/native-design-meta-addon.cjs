'use strict';

// Metadata-only addon. No catalogs, no JPEG/SVG processing, no APK changes.
// All artwork URLs point directly to TMDB's native image CDN.
const { selectMovieLogo } = require('../regions/movies/src/logos.cjs');
const { createSvgService } = require('./native-design-svg.cjs');

const ADDON_ID = 'com.nuvio.native.metadata.design';
const VERSION = '0.2.0';
const TTL_MS = 2 * 60 * 60 * 1000;
const ID = /^(?:tt\d{5,12}|tmdb:(?:(?:movie|tv):)?[1-9]\d{0,11})$/;
const imagePath = /^\/[a-zA-Z0-9_/-]{1,210}\.(?:jpg|jpeg|png|webp)$/i;
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value) {
  if (!dayPattern.test(String(value || ''))) return null;
  const date = new Date(value + 'T12:00:00Z');
  return !Number.isNaN(+date) && date.toISOString().slice(0, 10) === value ? value : null;
}

function tmdbImage(path, size) {
  return typeof path === 'string' && imagePath.test(path)
    ? 'https://image.tmdb.org/t/p/' + size + path : null;
}

function earliestMovieRelease(data) {
  const dates = [validDate(data.release_date)];
  const groups = data.release_dates?.results || [];
  // TMDB release type 1 = premiere; 2/3 = theatrical; 4/5/6 = digital/TV/physical.
  for (const group of groups) {
    for (const entry of group.release_dates || []) {
      if (Number(entry.type) < 1 || Number(entry.type) > 6) continue;
      const date = validDate(String(entry.release_date || '').slice(0, 10));
      if (date) dates.push(date);
    }
  }
  return dates.filter(Boolean).sort()[0] || null;
}

function streamingPlatforms(data) {
  const fr = data?.['watch/providers']?.results?.FR;
  const offers = [...(fr?.flatrate || []), ...(fr?.free || []), ...(fr?.ads || [])];
  return [...new Set(offers.map(o => String(o?.provider_name || '').trim()).filter(Boolean))].sort();
}

function safeString(value, length = 250) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, length);
}

function parseId(type, id) {
  if (!['movie', 'series'].includes(type) || !ID.test(id)) return null;
  if (type === 'movie' && id.startsWith('tmdb:tv:')) return null;
  if (type === 'series' && id.startsWith('tmdb:movie:')) return null;
  return { type, id };
}

async function fetchDetails(request, tmdb) {
  const type = request.type === 'movie' ? 'movie' : 'tv';
  const mt = /^tmdb:(?:(?:movie|tv):)?(\d+)$/.exec(request.id);
  let remoteId = mt ? Number(mt[1]) : null;
  if (!remoteId) {
    const found = await tmdb('/find/' + request.id, { external_source: 'imdb_id', language: 'fr-FR' });
    remoteId = Number((type === 'movie' ? found.movie_results : found.tv_results)?.[0]?.id);
  }
  if (!Number.isSafeInteger(remoteId) || remoteId < 1) return null;
  return tmdb('/' + type + '/' + remoteId, {
    language: 'fr-FR',
    append_to_response: type === 'movie'
      ? 'images,external_ids,watch/providers,release_dates'
      : 'images,external_ids,watch/providers',
    include_image_language: 'fr,en,null'
  });
}

async function episodesForSeries(data, tmdb) {
  const seasons = (data.seasons || [])
    .filter(s => Number.isInteger(s.season_number) && s.season_number > 0)
    .sort((a,b) => a.season_number - b.season_number);
  if (!seasons.length) return [];
  const results = [];
  const batch = 4; // bounded concurrency; never send synthetic episodes.
  for (let i = 0; i < seasons.length; i += batch) {
    const group = await Promise.all(seasons.slice(i, i + batch).map(season =>
      tmdb('/tv/' + data.id + '/season/' + season.season_number, { language: 'fr-FR' })));
    for (const detail of group) {
      for (const e of detail.episodes || []) {
        const season = Number(e.season_number);
        const episode = Number(e.episode_number);
        if (!Number.isInteger(season) || season < 1 || !Number.isInteger(episode) || episode < 1) continue;
        const airDate = validDate(e.air_date);
        results.push({
          id: data.external_ids?.imdb_id
            ? data.external_ids.imdb_id + ':' + season + ':' + episode
            : 'tmdb:tv:' + data.id + ':' + season + ':' + episode,
          title: safeString(e.name || 'Épisode ' + episode),
          season, episode,
          ...(airDate ? { released: airDate + 'T00:00:00.000Z' } : {}),
          ...(tmdbImage(e.still_path, 'w500') ? { thumbnail: tmdbImage(e.still_path, 'w500') } : {}),
          ...(e.overview ? { overview: safeString(e.overview, 2000) } : {}),
          // Preserve actual episode numbering and dates, never invent availability.
        });
      }
    }
  }
  return results;
}

async function buildMeta(request, tmdb) {
  const data = await fetchDetails(request, tmdb);
  if (!data?.id) return null;
  const isMovie = request.type === 'movie';
  const name = safeString(isMovie ? data.title || data.original_title : data.name || data.original_name, 200);
  const backdrop = tmdbImage(data.backdrop_path, 'w1280');
  const poster = tmdbImage(data.poster_path, 'w500');
  const widePoster = tmdbImage(data.backdrop_path, 'w780') || poster;
  if (!name || (!widePoster && !poster)) return null;
  const date = isMovie ? earliestMovieRelease(data) : validDate(data.first_air_date);
  const rating = Number(data.vote_average);
  const rated = Number.isFinite(rating) && rating > 0 ? 'Note TMDB : ' + rating.toFixed(1) + '/10.' : null;
  const platforms = streamingPlatforms(data);
  const offers = platforms.length === 1
    ? 'Plateforme France : ' + platforms[0] + '.'
    : platforms.length ? 'Plateformes disponibles en France : ' + platforms.join(', ') + '.' : null;
  const seasons = !isMovie && Number.isInteger(data.number_of_seasons)
    ? 'Nombre de saisons : ' + data.number_of_seasons + '.' : null;
  const description = [
    safeString(data.overview, 3500),
    rated, offers, seasons,
    date ? 'Première sortie : ' + date + '.' : null
  ].filter(Boolean).join('\n\n');
  const meta = {
    id: request.id,
    type: request.type,
    name,
    posterShape: 'landscape',
    poster: widePoster,
    background: backdrop || poster,
    landscapePoster: widePoster,
    ...(selectMovieLogo(data.images, data.original_language)?.url
      ? { logo: selectMovieLogo(data.images, data.original_language).url } : {}),
    ...(description ? { description } : {}),
    ...(date ? { released: date + 'T00:00:00.000Z', releaseInfo: date.slice(0, 4) } : {}),
    ...(Array.isArray(data.genres) ? {
      genres: data.genres.map(g => safeString(g?.name, 60)).filter(Boolean)
    } : {}),
    ...(data.status ? { status: safeString(data.status, 60) } : {}),
    ...(isMovie && Number(data.runtime) > 0 ? { runtime: String(data.runtime) + ' min' } : {}),
    ...(data.external_ids?.imdb_id && /^tt\d+$/.test(data.external_ids.imdb_id)
      ? { imdb_id: data.external_ids.imdb_id } : {}),
    ...(data['watch/providers']?.results?.FR?.link ? {
      links: [{ name: 'Voir les disponibilités en France', category: 'Regarder',
        url: data['watch/providers'].results.FR.link }]
    } : {}),
  };
  if (!isMovie) {
    // Nuvio derives its season count from real videos. Fetch full episode lists
    // so installing this meta addon cannot silently remove episode navigation.
    meta.videos = await episodesForSeries(data, tmdb);
    if (data.number_of_seasons > 0 && !meta.videos.length) {
      throw new Error('Incomplete TV episode list; let the other metadata addon handle this title');
    }
  }
  return meta;
}

function manifest(origin) {
  return {
    id: ADDON_ID,
    version: VERSION,
    name: 'Nuvio Native Design Metadata',
    description: 'Addon autonome de métadonnées avec illustrations TMDB natives, sans JPEG générés.',
    types: ['movie', 'series'],
    resources: [{
      name: 'meta',
      types: ['movie', 'series'],
      idPrefixes: ['tt', 'tmdb:movie:', 'tmdb:tv:', 'tmdb:']
    }],
    catalogs: [],
    behaviorHints: { configurable: false },
    logo: origin + '/collection-title.svg?title=NUVIO'
  };
}

function respond(res, status, payload, ttl = 0) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', ttl
    ? 'public, max-age=' + Math.floor(ttl / 1000)
    : 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(payload));
}

function vectorPosterPattern(origin) {
  // Nuvio resolves these native placeholders for every catalog item,
  // regardless of which addon supplied that catalog.
  return origin + '/design-meta/art/{type}/{id}/{shape}.svg';
}

function createAddon({ tmdb, now = Date.now, imageFetcher = globalThis.fetch } = {}) {
  const load = tmdb || ((path, params) => require('../regions/fr/api/index.js')._internals.tmdbFetch(path, params));
  const cache = new Map();
  // Experimental SVG preview is isolated from the normal metadata/poster paths.
  // It cannot override cards belonging to a different addon.
  const svgService = createSvgService({ fetcher: imageFetcher, now });
  async function handle(req, res, origin) {
    const url = new URL(req.url, origin);
    const route = url.pathname;
    if (route === '/design-meta/manifest.json') return respond(res, 200, manifest(origin), 15 * 60 * 1000);
    // Deliberately separate opt-in install URL. Never rewrite existing addons.
    if (route === '/design-meta/vector/manifest.json') return respond(res, 200, {
      ...manifest(origin),
      id: ADDON_ID + '.vector.preview',
      name: 'Nuvio Native Design Vector Preview',
      description: 'Addon de métadonnées expérimentales avec affiches SVG 16:9 ; compatibilité Nuvio/Shield à valider.'
    }, 15 * 60 * 1000);
    if (route === '/design-meta/status.json') return respond(res, 200, {
      addon: ADDON_ID, version: VERSION, catalogs: 0, imageRendering: false, mode: 'native-tmdb-urls',
      svgPreview: '/design-meta/preview/{movie|series}/{id}.svg',
      svgEnabledForMetadata: false,
      vectorPreviewManifest: '/design-meta/vector/manifest.json',
      vectorPosterPattern: vectorPosterPattern(origin),
      vectorPosterScope: 'Nuvio Custom Posters URL resolver, only when global landscape posters are enabled',
      limitation: 'Metadata addon does not inject a Compose/UI overlay into Nuvio.'
    });
    const preview = /^\/design-meta\/preview\/(movie|series)\/([^/]+)\.svg$/.exec(route);
    const globalArt = /^\/design-meta\/art\/(movie|series)\/([^/]+)\/(landscape|poster|square)\.svg$/.exec(route);
    if (globalArt && globalArt[3] !== 'landscape') {
      // Portrait/square UI must fall back to its native artwork: our approved
      // composition is 16:9 and must not be cropped to a portrait card.
      return respond(res, 404, { error: 'Landscape artwork only' });
    }
    const artworkRequest = preview || globalArt;
    if (artworkRequest) {
      let id;
      try { id = decodeURIComponent(artworkRequest[2]); }
      catch { return respond(res, 400, { error: 'Invalid ID' }); }
      const request = parseId(artworkRequest[1], id);
      if (!request) return respond(res, 400, { error: 'Invalid ID or media type' });
      try {
        const data = await fetchDetails(request, load);
        if (!data?.id) return respond(res, 404, { error: 'Metadata unavailable' });
        const isMovie = request.type === 'movie';
        const background = tmdbImage(data.backdrop_path, 'w1280');
        if (!background) return respond(res, 404, { error: 'No landscape artwork' });
        const logo = selectMovieLogo(data.images, data.original_language)?.url || null;
        const artwork = {
          backdrop: background,
          logo,
          genres: (data.genres || []).map(g => safeString(g?.name, 60)).filter(Boolean),
          platforms: streamingPlatforms(data),
          firstRelease: isMovie ? earliestMovieRelease(data) : validDate(data.first_air_date),
          tmdbScore: data.vote_average,
          seasonCount: isMovie ? 0 : data.number_of_seasons,
        };
        const meta = {
          id: request.id,
          type: request.type,
          name: safeString(isMovie ? data.title || data.original_title : data.name || data.original_name, 200)
        };
        if (!meta.name) return respond(res, 404, { error: 'No title' });
        const svg = await svgService.make(meta, artwork);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=21600');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; img-src data:");
        return res.end(svg);
      } catch {
        return respond(res, 503, { error: 'SVG preview temporarily unavailable' });
      }
    }
    const vectorHit = /^\/design-meta\/vector\/meta\/(movie|series)\/([^/]+)\.json$/.exec(route);
    const hit = /^\/design-meta\/meta\/(movie|series)\/([^/]+)\.json$/.exec(route) || vectorHit;
    if (!hit) return respond(res, 404, { error: 'Not found' });
    let id;
    try { id = decodeURIComponent(hit[2]); }
    catch { return respond(res, 400, { error: 'Invalid ID' }); }
    const request = parseId(hit[1], id);
    if (!request) return respond(res, 400, { error: 'Invalid ID or media type' });
    const cacheKey = request.type + ':' + request.id;
    const saved = cache.get(cacheKey);
    let promise;
    if (saved && saved.until > now()) promise = saved.promise;
    else {
      promise = Promise.resolve().then(() => buildMeta(request, load));
      cache.set(cacheKey, { promise, until: now() + TTL_MS });
      promise.catch(() => { if (cache.get(cacheKey)?.promise === promise) cache.delete(cacheKey); });
      if (cache.size > 700) cache.delete(cache.keys().next().value);
    }
    try {
      const meta = await promise;
      if (!meta) return respond(res, 404, { error: 'Metadata unavailable' });
      if (vectorHit && typeof meta.background === 'string' &&
          meta.background.includes('/t/p/w1280/')) {
        // Optional visual addon: the user installs this manifest instead of the
        // native one. Nuvio still owns card layout and any competing source.
        const svg = origin + '/design-meta/preview/' +
          request.type + '/' + encodeURIComponent(request.id) + '.svg';
        return respond(res, 200, {
          meta: { ...meta, poster: svg, landscapePoster: svg, background: svg, posterShape: 'landscape' }
        }, TTL_MS);
      }
      return respond(res, 200, { meta }, TTL_MS);
    } catch {
      // Never publish incomplete metadata or fictitious episodes.
      return respond(res, 503, { error: 'Metadata temporarily unavailable' });
    }
  }
  return { handle, cache };
}

module.exports = {
  createAddon, manifest, buildMeta, fetchDetails, episodesForSeries, parseId,
  validDate, earliestMovieRelease, streamingPlatforms, tmdbImage, vectorPosterPattern, VERSION, ADDON_ID
};
