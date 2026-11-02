'use strict';

// Nuvio Custom Posters adapter: 16:9 image replacement, not a UI or APK plugin.
// Same visual contract in every collection that invokes the native image hook.
// Unknown content / wrong aspect ratio -> HTTP 404 to preserve native fallback.
const sharp = require('sharp');
const { artworkCache } = require('../regions/fr/api/artwork-cache.cjs');
const frHandler = require('../regions/fr/api/index.js');
const moviesHandler = require('../regions/movies/index.cjs');
const seriesHandler = require('../regions/series/index.cjs');
const { selectMovieLogo } = require('../regions/movies/src/logos.cjs');

const VERSION = '2.0.0';
const RENDER_REV = 'fr-landscape-metadata-v2-20261102';
const ID_RULE = /^(?:tt\d{5,12}|tmdb:(?:movie:|tv:)?\d{1,12})$/;
const tmdbCache = new Map();
const METADATA_TTL = 6 * 60 * 60 * 1000;

function posterPattern(origin) {
  return origin + '/design-plugin/poster.jpg?type={type}&id={id}&shape={shape}&v=' + RENDER_REV;
}

function parsePosterQuery(url) {
  const type = String(url.searchParams.get('type') || '').toLowerCase();
  const kind = type === 'movie' ? 'movie' : ['series', 'tv'].includes(type) ? 'series' : null;
  const id = String(url.searchParams.get('id') || '');
  const shape = String(url.searchParams.get('shape') || 'poster').toLowerCase();
  if (!kind || !ID_RULE.test(id) || !['poster', 'landscape', 'square'].includes(shape)) return null;
  if (kind === 'movie' && /^tmdb:tv:/.test(id)) return null;
  if (kind === 'series' && /^tmdb:movie:/.test(id)) return null;
  return { kind, id, shape };
}

function sourceInfo(request, movieStore, seriesStore) {
  if (!request) return null;
  const store = request.kind === 'movie' ? movieStore : seriesStore;
  if (!store) return null;
  const normalizedId = request.id.replace(/^tmdb:(?:movie|tv):/, 'tmdb:');
  const row = store.row(normalizedId);
  if (!row) return null;
  const safe = value => typeof value === 'string' && /^https:\/\/image\.tmdb\.org\/t\/p\//.test(value) ? value : null;
  const poster = safe(row.poster), background = safe(row.background);
  const landscape = request.shape === 'landscape';
  const src = landscape ? background || poster : poster || background;
  if (!src) return null;
  return {
    type: request.kind, layout: landscape ? 'landscape' : 'portrait',
    src, fallback: landscape ? poster : background,
    title: String(row.title || (request.kind === 'movie' ? 'Film' : 'Série')).slice(0, 135)
  };
}

function isoDate(value) {
  const s = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T12:00:00Z');
  return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === s ? s : null;
}

function pickProvider(watch, localOffers = []) {
  const fr = watch && watch.results && watch.results.FR;
  const groups = fr ? [fr.flatrate, fr.free, fr.ads] : [];
  const stream = groups.flat().filter(Boolean).map(p => p.provider_name).filter(Boolean);
  const fromLocal = localOffers.filter(p => ['flatrate', 'free', 'ads'].includes(p.kind)).map(p => p.name);
  const names = [...new Set((stream.length ? stream : fromLocal).map(x => String(x).trim()).filter(Boolean))];
  // {id,type,shape} contains no collection identifier. Never assign an
  // arbitrary platform to a title present in multiple provider catalogs.
  return names.length === 1 ? names[0] : null;
}

function metadataCache(key, loader) {
  const old = tmdbCache.get(key);
  if (old && old.until > Date.now()) return old.promise;
  const promise = Promise.resolve().then(loader);
  tmdbCache.set(key, { promise, until: Date.now() + METADATA_TTL });
  promise.catch(() => { if (tmdbCache.get(key)?.promise === promise) tmdbCache.delete(key); });
  if (tmdbCache.size > 2048) tmdbCache.delete(tmdbCache.keys().next().value);
  return promise;
}

function safeTmdbImage(path, size) {
  return typeof path === 'string' && /^\/[a-zA-Z0-9_/-]{1,210}\.(?:jpg|jpeg|png|webp)$/.test(path)
    ? 'https://image.tmdb.org/t/p/' + size + path : null;
}

async function fetchTmdbDetails(request, fetcher = frHandler._internals.tmdbFetch) {
  const key = request.kind + ':' + request.id;
  return metadataCache(key, async () => {
    let tmdbId;
    const numeric = /^tmdb:(?:(?:movie|tv):)?(\d{1,12})$/.exec(request.id);
    if (numeric) tmdbId = Number(numeric[1]);
    else {
      const found = await fetcher('/find/' + request.id, { external_source: 'imdb_id', language: 'fr-FR' });
      const candidates = request.kind === 'movie' ? found.movie_results : found.tv_results;
      tmdbId = Number(candidates?.[0]?.id);
    }
    if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0) return null;
    const section = request.kind === 'movie' ? 'movie' : 'tv';
    return fetcher('/' + section + '/' + tmdbId, {
      language: 'fr-FR', append_to_response: 'images,watch/providers',
      include_image_language: 'fr,en,null'
    });
  });
}

function storeFor(request) {
  try {
    return request.kind === 'movie' ? moviesHandler._internals.reader() : seriesHandler._internals.reader();
  } catch { return null; }
}

function rowFor(store, request) {
  try { return store?.row(request.id.replace(/^tmdb:(?:movie|tv):/, 'tmdb:')) || null; }
  catch { return null; }
}

function offersFor(store, row) {
  try { return row && store?.franceOffers?.(row.id) || []; }
  catch { return []; }
}

function seasonCountFromStore(store, row) {
  try {
    if (!row || !store?.db?.prepare) return null;
    const total = Number(store.db.prepare('SELECT COUNT(DISTINCT number) AS n FROM seasons WHERE show_id=? AND number>0').get(row.id)?.n);
    return Number.isInteger(total) && total > 0 ? total : null;
  } catch { return null; }
}

async function resolveInfo(request, movieStore, seriesStore, fetcher = frHandler._internals.tmdbFetch) {
  const store = request.kind === 'movie' ? movieStore : seriesStore;
  const row = rowFor(store, request);
  const local = sourceInfo(request, movieStore, seriesStore);
  let remote = null;
  try { remote = await fetchTmdbDetails(request, fetcher); } catch { /* Local-only fallback. */ }
  if (!remote && !local) return null;
  const landscape = request.shape === 'landscape';
  const background = safeTmdbImage(remote?.backdrop_path, 'w1280');
  const poster = safeTmdbImage(remote?.poster_path, 'w500');
  const src = landscape ? background || local?.src || poster : poster || local?.src || background;
  const fallback = landscape ? local?.fallback || poster : local?.fallback || background;
  if (!src) return null;

  const date = isoDate(row?.first_air_date) ||
    isoDate(request.kind === 'movie' ? remote?.release_date : remote?.first_air_date);
  const rating = Number(remote?.vote_average);
  const seasons = request.kind === 'series'
    ? (Number.isInteger(remote?.number_of_seasons) && remote.number_of_seasons > 0
      ? remote.number_of_seasons : seasonCountFromStore(store, row)) : null;
  const genres = (Array.isArray(remote?.genres) ? remote.genres : [])
    .map(g => String(g?.name || '').trim()).filter(Boolean).slice(0, 3);
  const logo = selectMovieLogo(remote?.images, remote?.original_language)?.url || null;
  return {
    type: request.kind, layout: request.shape, src, fallback,
    title: String(local?.title || remote?.title || remote?.name || '').slice(0, 135),
    date, year: date?.slice(0, 4) || null,
    rating: Number.isFinite(rating) && rating > 0 ? Math.round(rating * 10) / 10 : null,
    seasons, genres, logo,
    provider: pickProvider(remote?.['watch/providers'], offersFor(store, row))
  };
}

function xml(value) {
  return String(value || '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  }[ch]));
}

function short(value, max = 48) {
  const str = String(value || '').replace(/\s+/g, ' ').trim();
  return str.length > max ? str.slice(0, max - 1).trimEnd() + '…' : str;
}

function displayDate(value) {
  if (!value) return null;
  const [y,m,d] = value.split('-');
  return d + '/' + m + '/' + y;
}

function cardSvg(info, hasLogo) {
  const film = info.type === 'movie';
  const platform = short(info.provider, 27).toUpperCase();
  const typeLabel = film ? 'FILM' : 'SÉRIE';
  const meta = [
    info.year,
    info.rating == null ? null : '★ ' + info.rating.toFixed(1) + '/10',
    info.seasons == null ? null : info.seasons + (info.seasons === 1 ? ' SAISON' : ' SAISONS')
  ].filter(Boolean).join('   •   ');
  const genreLine = info.genres.join('  •  ');
  const dateLine = info.date ? 'SORTIE : ' + displayDate(info.date) : '';
  const badgeWidth = Math.min(475, Math.max(190, platform.length * 26 + 72));
  const platformX = 1540 - badgeWidth;
  const typeX = platform ? platformX - 202 : 1338;
  const titleSize = info.title.length > 35 ? 65 : info.title.length > 24 ? 76 : 92;
  const titleY = hasLogo ? 625 : 640;
  return '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">' +
    '<defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#041021" stop-opacity=".30"/>' +
    '<stop offset=".43" stop-color="#041021" stop-opacity=".05"/>' +
    '<stop offset="1" stop-color="#06182f" stop-opacity=".96"/></linearGradient></defs>' +
    '<rect width="1600" height="900" fill="url(#shade)"/>' +
    (platform ? '<rect x="' + platformX + '" y="45" width="' + badgeWidth +
      '" height="94" rx="22" fill="#020b1b" fill-opacity=".87" stroke="#38bdf8" stroke-width="4"/>' +
      '<text x="' + (platformX + badgeWidth/2) + '" y="109" fill="white" font-size="43" font-weight="800" font-family="sans-serif" text-anchor="middle">' + xml(platform) + '</text>' : '') +
    '<rect x="' + typeX + '" y="45" width="180" height="94" rx="22" fill="#1689c5"/>' +
    '<text x="' + (typeX + 90) + '" y="109" fill="white" font-size="43" font-weight="800" font-family="sans-serif" text-anchor="middle">' + typeLabel + '</text>' +
    (!hasLogo ? '<text x="76" y="' + titleY + '" fill="white" font-size="' + titleSize +
      '" font-weight="900" font-family="sans-serif">' + xml(short(info.title, 44)) + '</text>' : '') +
    (meta ? '<text x="78" y="714" fill="#f8fafc" font-size="46" font-family="sans-serif" font-weight="750">' + xml(meta) + '</text>' : '') +
    (genreLine ? '<text x="78" y="788" fill="#dbeafe" font-size="41" font-family="sans-serif">' + xml(short(genreLine, 65)) + '</text>' : '') +
    (dateLine ? '<text x="78" y="854" fill="#67d7ff" font-size="43" font-family="sans-serif" font-weight="800">' + xml(dateLine) + '</text>' : '') +
    '<rect width="1600" height="900" fill="none" stroke="#e5f4ff" stroke-opacity=".15" stroke-width="5"/></svg>';
}

async function renderCard(info) {
  const key = JSON.stringify([RENDER_REV, info]);
  return artworkCache.render(key, async () => {
    const image = await artworkCache.photo(info.src).catch(() => (
      info.fallback ? artworkCache.photo(info.fallback).catch(() => null) : null
    ));
    if (!image) throw new Error('No image; keep native fallback');
    let logo = null;
    if (info.logo) {
      const remoteLogo = await artworkCache.photo(info.logo).catch(() => null);
      if (remoteLogo) logo = await sharp(remoteLogo.bytes)
        .resize({ width: 650, height: 185, fit: 'inside', withoutEnlargement: true })
        .png().toBuffer().catch(() => null);
    }
    const logoInfo = logo ? await sharp(logo).metadata() : null;
    const composites = [{ input: Buffer.from(cardSvg(info, Boolean(logo))), left: 0, top: 0 }];
    if (logo && logoInfo) composites.push({
      input: logo, left: 78, top: 600 - (logoInfo.height || 185)
    });
    const data = await artworkCache.raster(() => sharp(image.bytes)
      .resize(1600, 900, { fit: 'cover', position: 'attention' })
      .composite(composites).resize(960, 540)
      .jpeg({ quality: 85, progressive: true }).toBuffer());
    return { data, cacheable: true, photo: true };
  });
}

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.end(JSON.stringify(data));
}

function sendMissing(res, status = 404) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  return res.end('Original poster fallback');
}

async function handle(req, res, origin) {
  const url = new URL(req.url, origin);
  if (url.pathname === '/design-plugin/config.json') {
    return sendJson(res, 200, {
      name: 'Nuvio France Design Plugin', version: VERSION, method: 'Nuvio Custom Posters',
      requiresModifiedApk: false, posterPattern: posterPattern(origin),
      artworkRevision: RENDER_REV, imageRatio: '16:9',
      collectionCoverage: 'All media with TMDB/IMDb ID and a landscape Custom Posters call',
      platformPolicy: 'Show a provider only when uniquely established; the native hook does not send the originating collection',
      existingCollections: origin + '/movies/nuvio-collections-unified.json',
      originalBackup: origin + '/movies/nuvio-collections.json'
    });
  }
  if (url.pathname !== '/design-plugin/poster.jpg') return sendMissing(res);
  const request = parsePosterQuery(url);
  if (!request) return sendMissing(res, 400);
  // A native portrait/square slot cannot safely display a 16:9 design.
  if (request.shape !== 'landscape') return sendMissing(res);
  const store = storeFor(request);
  const info = await resolveInfo(request,
    request.kind === 'movie' ? store : null,
    request.kind === 'series' ? store : null);
  if (!info) return sendMissing(res);
  try {
    const result = await renderCard(info);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Nuvio-Design-Revision', RENDER_REV);
    return res.end(result.data);
  } catch { return sendMissing(res, 503); }
}

module.exports = {
  handle, posterPattern, parsePosterQuery, sourceInfo, resolveInfo, fetchTmdbDetails,
  pickProvider, cardSvg, isoDate, VERSION, RENDER_REV
};
