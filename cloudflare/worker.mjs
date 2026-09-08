import nodeHandler from '../api/index.js';

const DYNAMIC_CATALOG_TTL = 300;
const HISTORICAL_CATALOG_TTL = 21600;
const META_TTL = 21600;
const GENERATED_ART_TTL = 604800;
const DEFAULT_TTL = 60;

const POSTER_HOSTS = new Set([
  'image.tmdb.org',
  'static.tvmaze.com',
  's1.anilist.co',
  's2.anilist.co',
  's3.anilist.co',
  's4.anilist.co',
  'img.anili.st'
]);

const GENRE_POSTER_FILES = Object.freeze({
  action: 'action.png',
  'action-adventure': 'action.png',
  animation: 'animation.png',
  comedy: 'comedy.png',
  crime: 'crime.png',
  documentary: 'documentary.png',
  drama: 'drama.png',
  fantasy: 'fantasy.png',
  'scifi-fantasy': 'fantasy.png',
  horror: 'horror.png',
  romance: 'romance.png',
  'science-fiction': 'science-fiction.png'
});

function normalizedUrl(input) {
  return input instanceof URL ? input : new URL(String(input), 'https://edge.invalid');
}

export function edgeTtl(input) {
  const url = normalizedUrl(input);
  const path = url.pathname;

  if (path === '/health' || path.includes('/debug/') || path.startsWith('/internal/')) return 0;

  if (path.includes('/catalog/')) {
    if (/(?:today|tomorrow|yesterday|lastweek|nextweek)/i.test(path)) return DYNAMIC_CATALOG_TTL;
    const match = path.match(/-(\d{4})-(\d{2})(?:[/.]|$)/);
    if (!match) return DYNAMIC_CATALOG_TTL;
    const now = new Date();
    const current = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    return `${match[1]}-${match[2]}` === current ? DYNAMIC_CATALOG_TTL : HISTORICAL_CATALOG_TTL;
  }

  if (path.includes('/meta/')) return META_TTL;

  if (
    /\/(?:calendar-card\.svg|desktop-content-card\.jpg|desktop-folder-card\.jpg|desktop-genre-card\.jpg|platform-category-card\.svg|platform-backdrop\.svg|platform-logo|archive-year-card\.svg|genre-folder-art\.svg|genre-poster\.png)$/.test(path)
  ) {
    return GENERATED_ART_TTL;
  }

  return DEFAULT_TTL;
}

function validSlug(value) {
  return /^[a-z0-9-]+$/.test(String(value || ''));
}

export function localAssetPath(input) {
  const url = normalizedUrl(input);
  const path = url.pathname;

  let match = path.match(/^\/(fr|global|tr|us)\/(platform-card|platform-backdrop)\.jpg$/);
  if (match) {
    const provider = String(url.searchParams.get('provider') || '').trim().toLowerCase();
    if (!validSlug(provider)) return null;
    const variant = match[2] === 'platform-backdrop' ? 'backdrop' : 'card';
    return `/static/assets/platform-art/${match[1]}/${provider}-${variant}.jpg`;
  }

  match = path.match(/^\/(fr|tr|us)\/(genre-card|genre-backdrop)\.jpg$/);
  if (match) {
    const genre = String(url.searchParams.get('genre') || '').trim().toLowerCase();
    if (!validSlug(genre)) return null;
    const variant = match[2] === 'genre-backdrop' ? 'backdrop' : 'card';
    return `/static/assets/genre-art/shared/${genre}-${variant}.jpg`;
  }

  match = path.match(/^\/(fr|tr|us)\/genre-collection-art\.jpg$/);
  if (match) {
    const file = match[1] === 'us' ? 'us-genres-backdrop.jpg' : 'fr-genres-backdrop.jpg';
    return `/static/assets/collection-art/${file}`;
  }

  match = path.match(/^\/(fr|global|tr|us)\/desktop-folder-card\.jpg$/);
  if (match) {
    const provider = String(url.searchParams.get('provider') || '').trim().toLowerCase();
    if (!validSlug(provider)) return null;
    return `/static/assets/platform-art/${match[1]}/${provider}-card.jpg`;
  }

  match = path.match(/^\/(fr|tr|us)\/desktop-genre-card\.jpg$/);
  if (match) {
    const genre = String(url.searchParams.get('genre') || '').trim().toLowerCase();
    if (!validSlug(genre)) return null;
    return `/static/assets/genre-art/shared/${genre}-card.jpg`;
  }

  match = path.match(/^\/(fr|tr|us)\/genre-poster\.png$/);
  if (match) {
    const genre = String(url.searchParams.get('genre') || '').trim().toLowerCase();
    const file = GENRE_POSTER_FILES[genre];
    return file ? `/static/assets/genre-posters/${file}` : null;
  }

  return null;
}

export function requestTimeZone(request) {
  const explicit = request.headers.get('x-nuvio-timezone');
  if (explicit) return explicit;
  const cf = request.cf && typeof request.cf === 'object' ? request.cf : null;
  return typeof cf?.timezone === 'string' && cf.timezone ? cf.timezone : '';
}

function withHeaders(response, extra = {}) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('X-Nuvio-Edge', 'cloudflare-native');
  headers.set('X-Nuvio-Origin', 'cloudflare-only');
  for (const [name, value] of Object.entries(extra)) {
    if (value !== undefined && value !== null) headers.set(name, String(value));
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function serveLocalAsset(request, env, assetPath) {
  const assetUrl = new URL(assetPath, request.url);
  const assetRequest = new Request(assetUrl.toString(), {
    method: request.method === 'HEAD' ? 'HEAD' : 'GET',
    headers: request.headers
  });
  const response = await env.ASSETS.fetch(assetRequest);
  if (!response.ok) return withHeaders(response, { 'Cache-Control': 'public, max-age=60' });
  return withHeaders(response, { 'Cache-Control': 'public, max-age=31536000, immutable' });
}

function isAllowedPosterSource(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && POSTER_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

async function contentImageFallback(request, env, url) {
  const regionMatch = url.pathname.match(/^\/(fr|global|tr|us)\//);
  const region = regionMatch?.[1] || 'us';
  const provider = String(url.searchParams.get('provider') || '').trim().toLowerCase();
  if (validSlug(provider)) {
    const candidate = `/static/assets/platform-art/${region}/${provider}-card.jpg`;
    const response = await serveLocalAsset(request, env, candidate);
    if (response.ok) return response;
  }
  return new Response('Not found', {
    status: 404,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=60',
      'X-Nuvio-Edge': 'cloudflare-native',
      'X-Nuvio-Origin': 'cloudflare-only'
    }
  });
}

async function serveDesktopContentCard(request, env, url) {
  const src = String(url.searchParams.get('src') || '').trim();
  if (!isAllowedPosterSource(src)) return contentImageFallback(request, env, url);

  try {
    const upstream = await fetch(src, {
      headers: {
        Accept: 'image/jpeg,image/png,image/webp,*/*;q=0.8',
        'User-Agent': 'NuvioCalendar/1.4.0 Cloudflare'
      },
      cf: {
        cacheEverything: true,
        cacheTtl: GENERATED_ART_TTL
      }
    });

    if (!upstream.ok || !String(upstream.headers.get('content-type') || '').toLowerCase().startsWith('image/')) {
      return contentImageFallback(request, env, url);
    }

    return withHeaders(upstream, {
      'Cache-Control': `public, max-age=86400, s-maxage=${GENERATED_ART_TTL}, stale-while-revalidate=2592000`
    });
  } catch {
    return contentImageFallback(request, env, url);
  }
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function serveGenreFolderArt(request, env, url) {
  const regionMatch = url.pathname.match(/^\/(fr|tr|us)\//);
  if (!regionMatch) return new Response('Not found', { status: 404 });

  const genre = String(url.searchParams.get('genre') || '').trim().toLowerCase();
  if (!validSlug(genre)) return new Response('Not found', { status: 404 });

  const variant = String(url.searchParams.get('variant') || 'card').toLowerCase();
  const sourceVariant = variant === 'backdrop' ? 'backdrop' : 'card';
  const assetPath = `/static/assets/genre-art/shared/${genre}-${sourceVariant}.jpg`;
  const assetUrl = new URL(assetPath, request.url);
  const image = await env.ASSETS.fetch(new Request(assetUrl.toString()));
  if (!image.ok) return withHeaders(image);

  const bytes = Buffer.from(await image.arrayBuffer());
  const dataUri = `data:image/jpeg;base64,${bytes.toString('base64')}`;
  const label = escapeXml(url.searchParams.get('label') || genre.replace(/-/g, ' '));
  const type = String(url.searchParams.get('type') || 'movie') === 'series' ? 'SÉRIES' : 'FILMS';
  const color = /^#[0-9a-f]{6}$/i.test(String(url.searchParams.get('color') || ''))
    ? String(url.searchParams.get('color'))
    : '#38bdf8';

  const logo = variant === 'logo';
  const width = logo ? 1400 : 1600;
  const height = logo ? 300 : 900;
  const titleY = logo ? 138 : 700;
  const subY = logo ? 205 : 782;
  const imageX = logo ? 860 : 0;
  const imageWidth = logo ? 540 : width;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#02040a" stop-opacity=".98"/>
        <stop offset="55%" stop-color="#061222" stop-opacity=".72"/>
        <stop offset="100%" stop-color="#02040a" stop-opacity=".22"/>
      </linearGradient>
    </defs>
    <image href="${dataUri}" x="${imageX}" y="0" width="${imageWidth}" height="${height}" preserveAspectRatio="xMidYMid slice"/>
    <rect width="${width}" height="${height}" fill="url(#shade)"/>
    <rect x="68" y="${logo ? 65 : 575}" width="12" height="${logo ? 160 : 230}" rx="6" fill="${color}"/>
    <text x="112" y="${titleY}" fill="#fff" font-family="Arial,sans-serif" font-size="${logo ? 68 : 92}" font-weight="900">${label}</text>
    <text x="114" y="${subY}" fill="${color}" font-family="Arial,sans-serif" font-size="${logo ? 30 : 42}" font-weight="800">${type}</text>
  </svg>`;

  return new Response(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': `public, max-age=86400, s-maxage=${GENERATED_ART_TTL}, stale-while-revalidate=2592000`,
      'X-Nuvio-Edge': 'cloudflare-native',
      'X-Nuvio-Origin': 'cloudflare-only'
    }
  });
}

function copyStringBindingsToProcessEnv(env) {
  if (typeof process === 'undefined' || !process.env) return;
  const names = [
    'TMDB_READ_TOKEN',
    'TMDB_API_KEY',
    'TMDB_LANGUAGE',
    'MAX_CANDIDATES',
    'MAX_ITEMS',
    'PAGE_SIZE',
    'TMDB_TIMEOUT_MS',
    'SOURCE_TIMEOUT_MS',
    'RETRY_BASE_MS',
    'TMDB_RETRY_BASE_MS',
    'CALENDAR_CARDS',
    'DEBUG',
    'NUVIO_NOW_OVERRIDE'
  ];
  for (const name of names) {
    if (typeof env?.[name] === 'string') process.env[name] = env[name];
  }
}

function cacheKeyFor(request, timeZone) {
  const url = new URL(request.url);
  if (
    timeZone &&
    (url.pathname.startsWith('/us/catalog/') || url.pathname.startsWith('/global/catalog/'))
  ) {
    url.searchParams.set('__nuvio_tz_cache', timeZone);
  }
  return new Request(url.toString(), { method: 'GET' });
}

async function invokeNodeHandler(request, timeZone) {
  const incoming = new URL(request.url);
  const headers = {};
  for (const [name, value] of request.headers) headers[name.toLowerCase()] = value;

  headers.host = incoming.host;
  headers['x-forwarded-host'] = incoming.host;
  headers['x-forwarded-proto'] = incoming.protocol.replace(':', '');
  headers['x-nuvio-public-origin'] = incoming.origin;
  if (timeZone) {
    headers['x-nuvio-timezone'] = timeZone;
    headers['x-vercel-ip-timezone'] = timeZone;
  }

  const req = {
    method: request.method,
    url: incoming.pathname + incoming.search,
    headers
  };

  return new Promise((resolve) => {
    const responseHeaders = new Headers();
    let statusCode = 200;
    let ended = false;

    const res = {
      get statusCode() {
        return statusCode;
      },
      set statusCode(value) {
        statusCode = Number(value) || 200;
      },
      setHeader(name, value) {
        if (Array.isArray(value)) {
          responseHeaders.delete(name);
          for (const entry of value) responseHeaders.append(name, String(entry));
        } else {
          responseHeaders.set(name, String(value));
        }
      },
      getHeader(name) {
        return responseHeaders.get(name);
      },
      end(body = '') {
        if (ended) return;
        ended = true;
        resolve(new Response(body || null, { status: statusCode, headers: responseHeaders }));
      }
    };

    Promise.resolve(nodeHandler(req, res)).catch((error) => {
      console.error('Cloudflare native handler error', error);
      if (ended) return;
      ended = true;
      resolve(new Response(JSON.stringify({ error: 'Cloudflare runtime error' }), {
        status: 502,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        }
      }));
    });
  });
}

async function dynamicResponse(request, env, ctx) {
  copyStringBindingsToProcessEnv(env);
  const url = new URL(request.url);
  const timeZone = requestTimeZone(request);
  const ttl = request.method === 'GET' || request.method === 'HEAD' ? edgeTtl(url) : 0;
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = ttl > 0 && cache ? cacheKeyFor(request, timeZone) : null;

  if (key && cache) {
    const hit = await cache.match(key);
    if (hit) return withHeaders(hit, { 'X-Nuvio-Cache': 'HIT' });
  }

  let response;
  if (/^\/(fr|global|tr|us)\/desktop-content-card\.jpg$/.test(url.pathname)) {
    response = await serveDesktopContentCard(request, env, url);
  } else if (/^\/(fr|tr|us)\/genre-folder-art\.svg$/.test(url.pathname)) {
    response = await serveGenreFolderArt(request, env, url);
  } else if (url.pathname.startsWith('/internal/')) {
    response = new Response('Not found', { status: 404 });
  } else {
    response = await invokeNodeHandler(request, timeZone);
  }

  let finalResponse = withHeaders(response, { 'X-Nuvio-Cache': 'MISS' });

  if (key && cache && finalResponse.ok && ttl > 0) {
    const headers = new Headers(finalResponse.headers);
    headers.set('Cache-Control', `public, max-age=${ttl}, stale-while-revalidate=${Math.max(ttl, 900)}`);
    finalResponse = new Response(finalResponse.body, {
      status: finalResponse.status,
      statusText: finalResponse.statusText,
      headers
    });
    const clone = finalResponse.clone();
    if (ctx?.waitUntil) ctx.waitUntil(cache.put(key, clone));
    else await cache.put(key, clone);
  }

  return finalResponse;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400',
          'X-Nuvio-Edge': 'cloudflare-native',
          'X-Nuvio-Origin': 'cloudflare-only'
        }
      });
    }

    const url = new URL(request.url);
    const assetPath = localAssetPath(url);
    if (assetPath) return serveLocalAsset(request, env, assetPath);

    return dynamicResponse(request, env, ctx);
  }
};
