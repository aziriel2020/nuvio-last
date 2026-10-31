'use strict';

// Opt-in Nuvio catalog artwork pass-through. NEVER fetches image bytes.
// The existing catalog/date/identity engines remain the sole source of truth.
const UPSTREAM_HOSTS = new Set([
  'image.tmdb.org',
  'artworks.thetvdb.com',
  'static.tvmaze.com',
  's1.anilist.co', 's2.anilist.co', 's3.anilist.co', 's4.anilist.co',
  'img.anili.st'
]);

const RENDERER_PATH = /\/(?:images\/original\.(?:jpg|png)|calendar-card\.(?:jpg|svg)|desktop-content-card\.jpg|content-card\.jpg|shield-content-card\.jpg)$/;
const IMAGE_FIELDS = ['poster', 'background', 'landscapePoster', 'banner', 'thumbnail', 'logo'];

function upstream(value) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !UPSTREAM_HOSTS.has(url.hostname.toLowerCase()) ||
        url.username || url.password || (url.port && url.port !== '443')) return null;
    return url;
  } catch (_) {
    return null;
  }
}

function sizedImage(url, role) {
  const result = new URL(url.href);
  if (result.hostname !== 'image.tmdb.org' || role === 'logo') return result.href;
  const size = role === 'poster' || role === 'thumbnail' ? 'w500'
    : role === 'background' ? 'w1280' : 'w780';
  result.pathname = result.pathname.replace(
    /^\/t\/p\/(?:original|w\d+|h\d+)\//,
    `/t/p/${size}/`
  );
  return result.href;
}

function resolveNativeImage(value, role, origin) {
  const direct = upstream(value);
  if (direct) return sizedImage(direct, role);
  if (typeof value !== 'string' || value.length > 8192) return null;
  try {
    const url = new URL(value, origin);
    // Only unwrap known local image renderers. No arbitrary remote URLs,
    // redirects, credentials, network access or URL-shaped meta leakage.
    if (url.origin !== origin || !RENDERER_PATH.test(url.pathname)) return null;
    const keys = role === 'poster'
      ? ['fallback', 'poster', 'src', 'background']
      : ['src', 'background', 'poster', 'fallback'];
    for (const key of keys) {
      const candidate = upstream(url.searchParams.get(key));
      if (candidate) return sizedImage(candidate, role);
    }
  } catch (_) {}
  return null;
}

function rewriteArtwork(meta, origin, options = {}) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return meta;
  const result = { ...meta };
  const poster = resolveNativeImage(meta.poster, 'poster', origin)
    || resolveNativeImage(meta.background, 'poster', origin)
    || resolveNativeImage(meta.landscapePoster, 'poster', origin);
  const background = resolveNativeImage(meta.background, 'background', origin)
    || resolveNativeImage(meta.landscapePoster, 'background', origin)
    || resolveNativeImage(meta.banner, 'background', origin)
    || (poster && sizedImage(new URL(poster), 'background'));
  if (poster) result.poster = poster;
  if (background) result.background = background;
  // Films Monde's catalog entries declare a 16:9 card shape. A portrait
  // movie poster placed in that landscape slot causes a destructive crop.
  // Prefer the direct TMDB landscape image for cards, keeping the original
  // portrait as a Coil fallback and untouched on /meta detail requests.
  if (options.landscapeCatalog && meta.type === 'movie' && meta.posterShape === 'landscape' && background) {
    const wide = resolveNativeImage(meta.landscapePoster, 'landscapePoster', origin)
      || resolveNativeImage(meta.background, 'landscapePoster', origin)
      || background;
    result.poster = wide;
    if (poster && poster !== wide) result._rawPosterUrl = poster;
  }
  if (meta.landscapePoster !== undefined) {
    const wide = resolveNativeImage(meta.landscapePoster, 'landscapePoster', origin)
      || background || poster;
    if (wide) result.landscapePoster = wide;
  }
  if (meta.banner !== undefined) {
    const banner = resolveNativeImage(meta.banner, 'banner', origin) || background || poster;
    if (banner) result.banner = banner;
  }
  for (const field of ['thumbnail', 'logo']) {
    if (typeof meta[field] === 'string') {
      const image = resolveNativeImage(meta[field], field, origin);
      if (image) result[field] = image;
    }
  }
  if (Array.isArray(meta.videos)) result.videos = meta.videos.map(v => rewriteArtwork(v, origin));
  return result;
}

function nativeBridgePayload(payload, origin, options = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  if (Array.isArray(payload.metas)) {
    return { ...payload, metas: payload.metas.map(meta => rewriteArtwork(meta, origin, options)) };
  }
  if (payload.meta && typeof payload.meta === 'object') {
    return { ...payload, meta: rewriteArtwork(payload.meta, origin) };
  }
  return payload;
}

module.exports = { nativeBridgePayload, resolveNativeImage, rewriteArtwork, UPSTREAM_HOSTS };
