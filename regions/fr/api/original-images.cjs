'use strict';
const sharp = require('sharp');
const { artworkCache } = require('./artwork-cache.cjs');
const { isImageSource } = require('./image-source-rules.cjs');
const REVISION = 'original-images-v1';
const WIDTHS = { poster: 500, background: 1280, landscapePoster: 780, banner: 780, thumbnail: 500, logo: 500 };

function imageUrl(origin, source, role, fallback) {
  if (!isImageSource(source)) return source;
  const url = new URL('/images/original.' + (role === 'logo' ? 'png' : 'jpg'), origin);
  url.searchParams.set('v', REVISION); url.searchParams.set('src', source); url.searchParams.set('role', role);
  if (fallback !== source && isImageSource(fallback)) url.searchParams.set('fallback', fallback);
  return url.href;
}
function relayMediaImages(payload, origin) {
  function walk(value) {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== 'object') return value;
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (Object.hasOwn(WIDTHS, key) && typeof item === 'string') {
        const fallback = key === 'poster' ? value.background : ['background', 'landscapePoster', 'banner'].includes(key) ? value.poster : null;
        out[key] = imageUrl(origin, item, key, fallback);
      } else out[key] = walk(item);
    }
    return out;
  }
  if (payload.meta) return { ...payload, meta: walk(payload.meta) };
  if (Array.isArray(payload.metas)) return { ...payload, metas: walk(payload.metas) };
  return payload;
}
function normalizeSource(source, role) {
  const url = new URL(source);
  if (url.hostname === 'image.tmdb.org') {
    const size = role === 'background' ? 'w1280' : ['landscapePoster', 'banner'].includes(role) ? 'w780' : 'w500';
    url.pathname = url.pathname.replace(/\/t\/p\/(original|w\d+|h\d+)\//, (match, current) =>
      current.startsWith('w') && Number(current.slice(1)) <= Number(size.slice(1)) ? match : `/t/p/${size}/`);
    if (role === 'logo') url.pathname = url.pathname.replace(/\.svg$/, '.png');
  }
  return url.href;
}
async function loadOriginal(primary, fallback, role) {
  const sources = [...new Set([primary, fallback].filter(isImageSource).map((src) => normalizeSource(src, role)))];
  for (const source of sources) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try { return { ...(await artworkCache.photo(source, { timeoutMs: attempt ? 1000 : 2500 })), source }; }
      catch (error) {
        if (error.status && error.status !== 429 && error.status < 500) break;
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    if (new URL(source).hostname === 'static.tvmaze.com' && source.includes('/original_untouched/')) {
      try {
        const small = source.replace('/original_untouched/', '/medium_portrait/');
        return { ...(await artworkCache.photo(small, { timeoutMs: 1000 })), source: small };
      } catch {}
    }
  }
  throw new Error('Original image unavailable');
}
async function handleOriginalImage(req, res, url) {
  const source = url.searchParams.get('src') || '', fallback = url.searchParams.get('fallback') || '';
  const role = url.searchParams.get('role') || 'poster';
  if (!Object.hasOwn(WIDTHS, role) || !isImageSource(source) || (fallback && !isImageSource(fallback))) {
    res.statusCode = 400; res.setHeader('Cache-Control', 'no-store'); return res.end('Invalid image source');
  }
  const png = url.pathname.endsWith('.png');
  if (png !== (role === 'logo')) { res.statusCode = 400; res.setHeader('Cache-Control', 'no-store'); return res.end('Invalid image format'); }
  try {
    const result = await artworkCache.render(JSON.stringify([REVISION, source, fallback, role]), async () => {
      const photo = await loadOriginal(source, fallback, role), width = WIDTHS[role];
      // Keep an already-sized original JPEG byte-for-byte. Larger photos and
      // alternate bitmap formats are fitted without cropping or title overlays.
      const passthrough = !png && /^image\/jpe?g$/.test(photo.type) && photo.width <= width
        && photo.height <= 2000 && (!photo.orientation || photo.orientation === 1);
      const data = passthrough ? photo.bytes : await artworkCache.raster(() => {
        const image = sharp(photo.bytes).rotate().resize({ width, height: 2000, fit: 'inside', withoutEnlargement: true });
        return png ? image.png().toBuffer() : image.jpeg({ quality: 88, progressive: true }).toBuffer();
      });
      return { data, source: photo.source };
    });
    res.statusCode = 200; res.setHeader('Content-Type', png ? 'image/png' : 'image/jpeg');
    res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000');
    res.setHeader('X-Nuvio-Original-Image', REVISION); res.setHeader('X-Nuvio-Image-Source', new URL(result.source).hostname);
    return res.end(result.data);
  } catch {
    res.statusCode = 503; res.setHeader('Cache-Control', 'no-store'); res.setHeader('Retry-After', '1');
    return res.end('Image temporarily unavailable');
  }
}
module.exports = { REVISION, WIDTHS, imageUrl, relayMediaImages, normalizeSource, handleOriginalImage };
