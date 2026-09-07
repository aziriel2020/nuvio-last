const DEFAULT_VERCEL_ORIGIN = 'https://nuvio-last.vercel.app';
const DYNAMIC_CATALOG_TTL = 300;
const HISTORICAL_CATALOG_TTL = 21600;
const GENERATED_ART_TTL = 604800;

function safeOrigin(value, fallback) {
  try {
    const url = new URL(String(value || fallback));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return fallback;
    return url.origin;
  } catch {
    return fallback;
  }
}

export function edgeTtl(input) {
  const url = input instanceof URL ? input : new URL(String(input), 'https://edge.invalid');
  const path = url.pathname;

  if (path === '/health' || path.includes('/debug/')) return 0;

  if (path.includes('/catalog/')) {
    if (/(?:today|tomorrow|yesterday|lastweek|nextweek)/i.test(path)) return DYNAMIC_CATALOG_TTL;
    const match = path.match(/-(\d{4})-(\d{2})(?:[/.]|$)/);
    if (!match) return DYNAMIC_CATALOG_TTL;
    const now = new Date();
    const current = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    return `${match[1]}-${match[2]}` === current ? DYNAMIC_CATALOG_TTL : HISTORICAL_CATALOG_TTL;
  }

  if (
    /\/(?:calendar-card\.svg|desktop-content-card\.jpg|desktop-folder-card\.jpg|desktop-genre-card\.jpg|platform-category-card\.svg|platform-backdrop\.svg|platform-logo|archive-year-card\.svg|genre-folder-art\.svg)$/.test(path)
  ) {
    return GENERATED_ART_TTL;
  }

  return 60;
}

export function localAssetPath(input) {
  const url = input instanceof URL ? input : new URL(String(input), 'https://edge.invalid');
  const path = url.pathname;

  let match = path.match(/^\/(fr|global|tr|us)\/(platform-card|platform-backdrop)\.jpg$/);
  if (match) {
    const provider = String(url.searchParams.get('provider') || '').trim().toLowerCase();
    if (!/^[a-z0-9-]+$/.test(provider)) return null;
    const variant = match[2] === 'platform-backdrop' ? 'backdrop' : 'card';
    return `/static/assets/platform-art/${match[1]}/${provider}-${variant}.jpg`;
  }

  match = path.match(/^\/(fr|tr|us)\/(genre-card|genre-backdrop)\.jpg$/);
  if (match) {
    const genre = String(url.searchParams.get('genre') || '').trim().toLowerCase();
    if (!/^[a-z0-9-]+$/.test(genre)) return null;
    const variant = match[2] === 'genre-backdrop' ? 'backdrop' : 'card';
    return `/static/assets/genre-art/shared/${genre}-${variant}.jpg`;
  }

  match = path.match(/^\/(fr|tr|us)\/genre-collection-art\.jpg$/);
  if (match) {
    const file = match[1] === 'us' ? 'us-genres-backdrop.jpg' : 'fr-genres-backdrop.jpg';
    return `/static/assets/collection-art/${file}`;
  }

  return null;
}

export function requestTimeZone(request) {
  const explicit = request.headers.get('x-nuvio-timezone');
  if (explicit) return explicit;
  const cf = request.cf && typeof request.cf === 'object' ? request.cf : null;
  return typeof cf?.timezone === 'string' && cf.timezone ? cf.timezone : '';
}

function withCors(response, extra = {}) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('X-Nuvio-Edge', 'cloudflare-pages');
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function serveLocalAsset(request, env, assetPath) {
  const assetUrl = new URL(assetPath, request.url);
  const assetRequest = new Request(assetUrl.toString(), { method: request.method, headers: request.headers });
  const response = await env.ASSETS.fetch(assetRequest);
  return withCors(response, { 'Cache-Control': 'public, max-age=31536000, immutable' });
}

function needsTimezoneVariant(pathname) {
  return pathname.startsWith('/us/catalog/') || pathname.startsWith('/global/catalog/');
}

async function proxyToVercel(request, env) {
  const incoming = new URL(request.url);
  const fallbackOrigin = safeOrigin(env.NUVIO_VERCEL_ORIGIN, DEFAULT_VERCEL_ORIGIN);
  const upstream = new URL(incoming.pathname + incoming.search, fallbackOrigin);
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.set('x-nuvio-public-origin', incoming.origin);
  headers.set('x-nuvio-edge', 'cloudflare-pages');

  const timeZone = requestTimeZone(request);
  if (timeZone) headers.set('x-nuvio-timezone', timeZone);

  const upstreamRequest = new Request(upstream.toString(), {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'manual'
  });

  const ttl = request.method === 'GET' ? edgeTtl(incoming) : 0;
  const cf = ttl > 0
    ? {
        cacheEverything: true,
        cacheTtlByStatus: {
          '200-299': ttl,
          '404': 60,
          '500-599': 0
        }
      }
    : undefined;

  if (cf && needsTimezoneVariant(incoming.pathname)) {
    const variant = timeZone || 'default';
    cf.cacheKey = `${upstream.toString()}#__nuvio_tz=${encodeURIComponent(variant)}`;
  }

  try {
    const response = cf ? await fetch(upstreamRequest, { cf }) : await fetch(upstreamRequest);
    return withCors(response);
  } catch (error) {
    return new Response(JSON.stringify({
      error: 'Origin temporarily unavailable',
      detail: String(error?.message || error)
    }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
        'X-Nuvio-Edge': 'cloudflare-pages'
      }
    });
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400'
        }
      });
    }

    const url = new URL(request.url);
    const assetPath = localAssetPath(url);
    if (assetPath) return serveLocalAsset(request, env, assetPath);

    return proxyToVercel(request, env);
  }
};
