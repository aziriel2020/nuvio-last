'use strict';

// Plugin-only adapter for Nuvio's built-in Custom Posters feature.
// No APK changes, no client CSS injection, no alteration of existing imports.
// The original approved France renderer supplies the artwork; Android handles
// the fallback to the original native TMDB/TVDB poster when an ID is not indexed.
const VERSION = '1.1.0';
const RENDER_REV = 'oracle-vector-v4-film-details';
const ID_RULE = /^(?:tt\d{5,12}|tmdb:(?:movie:|tv:)?\d{1,12})$/;

function posterPattern(origin) {
  return origin + '/design-meta/art/{type}/{id}/{shape}.svg?v=oracle-vector-v4-film-details';
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
      name: 'Nuvio France Design Plugin', version: VERSION, method: 'Nuvio Custom Posters',
      requiresModifiedApk: false, posterPattern: posterPattern(origin),
      notes: 'Use V4 SVG via Nuvio Custom Posters. No server JPEG conversion; unsupported images fall back to native art. An addon cannot install a global UI overlay.',
      existingCollections: origin + '/movies/nuvio-collections-unified.json',
      originalBackup: origin + '/movies/nuvio-collections.json',
      artworkRevision: RENDER_REV
    });
  }
  if (url.pathname !== '/design-plugin/poster.jpg') return sendMissing(res);
  const request = parsePosterQuery(url);
  if (!request) return sendMissing(res, 400);
  // Old JPEG Custom Poster URLs remain as a safe redirect to the V4 SVG.
  // Portrait/square requests intentionally fall back to Nuvio's native poster.
  if (request.shape !== 'landscape') return sendMissing(res);
  res.statusCode = 307;
  res.setHeader('Location', origin + '/design-meta/art/' +
    request.kind + '/' + encodeURIComponent(request.id) +
    '/landscape.svg?v=' + RENDER_REV);
  res.setHeader('Cache-Control', 'no-store');
  return res.end('');

}

module.exports = { handle, posterPattern, parsePosterQuery, VERSION, RENDER_REV };
