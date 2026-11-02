'use strict';

// Plugin-only adapter for Nuvio's built-in Custom Posters feature.
// V4 is selected by the public config; old server JPEG is rollback-only.
// No APK changes or client CSS injection; an SVG-capable renderer is required.
const frHandler = require('../regions/fr/api/index.js');
const moviesHandler = require('../regions/movies/index.cjs');
const seriesHandler = require('../regions/series/index.cjs');
const { vectorPosterPattern } = require('./native-design-meta-addon.cjs');

const VERSION = '1.1.0';
const LEGACY_RENDER_REV = 'fr-design-plugin-v1';
const RENDER_REV = 'oracle-vector-v4-film-details';
const ID_RULE = /^(?:tt\d{5,12}|tmdb:(?:movie:|tv:)?\d{1,12})$/;

// V4 is the primary Custom Posters profile. The legacy JPEG route remains
// addressable ONLY as a rollback for clients without working SVG support.
// V4 embeds original TMDB image bytes into vector markup; it never encodes
// a new JPEG. Rendering/decoding happens in the SVG-capable client.
function posterPattern(origin) {
  return vectorPosterPattern(origin);
}
function legacyPosterPattern(origin) {
  return origin + '/design-plugin/poster.jpg?type={type}&id={id}&shape={shape}';
}

function parsePosterQuery(url) {
  const type = String(url.searchParams.get('type') || '').toLowerCase();
  const kind = type === 'movie' ? 'movie' : ['series', 'tv'].includes(type) ? 'series' : null;
  const id = String(url.searchParams.get('id') || '');
  const shape = String(url.searchParams.get('shape') || 'poster').toLowerCase();
  if (!kind || !ID_RULE.test(id) || !['poster', 'landscape', 'square'].includes(shape)) return null;
  // A wrong-media TMDB namespace must never produce a misleading picture.
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
  const poster = typeof row.poster === 'string' && row.poster.startsWith('https://image.tmdb.org/')
    ? row.poster : null;
  const background = typeof row.background === 'string' && row.background.startsWith('https://image.tmdb.org/')
    ? row.background : null;
  const landscape = request.shape === 'landscape';
  const src = landscape ? background || poster : poster || background;
  if (!src) return null;
  return {
    type: request.kind, layout: landscape ? 'landscape' : 'portrait',
    src, fallback: landscape ? poster : background,
    title: String(row.title || 'Film').slice(0, 135)
  };
}

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.end(JSON.stringify(data));
}

function sendMissing(res, status = 404) {
  // Nuvio's CustomPosterFallbackInterceptor then uses the original image.
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  return res.end('Original poster fallback');
}

async function handle(req, res, origin) {
  const url = new URL(req.url, origin);
  if (url.pathname === '/design-plugin/config.json') {
    return sendJson(res, 200, {
      name: 'Nuvio France Design Plugin V4', version: VERSION, method: 'Nuvio Custom Posters / SVG V4',
      requiresModifiedApk: false, posterPattern: posterPattern(origin),
      legacyPosterPattern: legacyPosterPattern(origin),
      format: 'image/svg+xml', jpegConversion: false, requiresClientSvgSupport: true,
      notes: 'Use posterPattern in Nuvio Custom Posters with landscape cards enabled. V4 returns a vector composition containing original TMDB image bytes: no JPEG resize/transcode. Portrait and missing IDs return 404 so Nuvio can use its native original. legacyPosterPattern is rollback only. An addon cannot inject an arbitrary UI overlay into Nuvio without client support.',
      existingCollections: origin + '/movies/nuvio-collections-unified.json',
      originalBackup: origin + '/movies/nuvio-collections.json',
      artworkRevision: RENDER_REV
    });
  }
  if (url.pathname !== '/design-plugin/poster.jpg') return sendMissing(res);
  const request = parsePosterQuery(url);
  if (!request) return sendMissing(res, 400);
  let info;
  try {
    info = sourceInfo(request,
      request.kind === 'movie' ? moviesHandler._internals.reader() : null,
      request.kind === 'series' ? seriesHandler._internals.reader() : null);
  } catch { return sendMissing(res, 503); }
  if (!info) return sendMissing(res);
  const params = new URLSearchParams({
    layout: info.layout, type: info.type, src: info.src,
    title: info.title, provider: 'FRANCE',
    append: info.type === 'movie' ? 'FILMS MONDE' : 'SÉRIES MONDE',
    v: LEGACY_RENDER_REV
  });
  if (info.type === 'movie' && info.layout === 'landscape') params.set('world', '1');
  if (info.fallback) params.set('fallback', info.fallback);
  const oldUrl = req.url;
  const oldHeaders = req.headers;
  req.url = '/calendar-card.jpg?' + params.toString();
  req.headers = { ...oldHeaders, 'x-nuvio-base-path': '/fr' };
  try {
    return await frHandler(req, res);
  } finally {
    req.url = oldUrl;
    req.headers = oldHeaders;
  }
}

module.exports = { handle, posterPattern, legacyPosterPattern, parsePosterQuery, sourceInfo, VERSION, RENDER_REV };
