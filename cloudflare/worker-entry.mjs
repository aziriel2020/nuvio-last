import baseWorker from './worker.mjs';
import {
  ANIME_RESILIENCE_REV,
  isGlobalAnimeResilienceRequest,
  recoverGlobalAnimeResponse
} from './anilist-resilience.mjs';

export * from './worker.mjs';

const STATIC_EXACT_PATHS = new Set([
  '/',
  '/index.html',
  '/install.json',
  '/coexistence-check.json',
  '/nuvio-collections-fr-global-tr-usa.json',
  '/nuvio-collections-fr-global-usa.json',
  '/nuvio-collections-usa-fr.json',
  '/collections.json',
  '/nuvio-collections-desktop.json',
  '/nuvio-collections-global.json',
  '/nuvio-collections-tr.json',
  '/nuvio-collections-turkiye.json',
  '/edge-build.json',
  '/fr/manifest.json',
  '/fr/nuvio-collections.json',
  '/fr/collections.json',
  '/fr/archive-blueprint.json',
  '/global/manifest.json',
  '/global/nuvio-collections.json',
  '/global/collections.json',
  '/global/archive-blueprint.json',
  '/tr/manifest.json',
  '/tr/nuvio-collections.json',
  '/tr/collections.json',
  '/tr/archive-blueprint.json',
  '/us/manifest.json',
  '/us/nuvio-collections.json',
  '/us/collections.json',
  '/us/archive-blueprint.json'
]);

function isStaticPagesAsset(pathname) {
  return STATIC_EXACT_PATHS.has(pathname) || pathname.startsWith('/static/');
}

async function staticPagesAsset(request, env) {
  if (!env?.ASSETS?.fetch) {
    return new Response('Cloudflare ASSETS binding unavailable', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
  const response = await env.ASSETS.fetch(request);
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('X-Nuvio-Edge', 'cloudflare-native');
  headers.set('X-Nuvio-Origin', 'cloudflare-static');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function cacheRequest(request) {
  const url = new URL(request.url);
  url.searchParams.set('__nuvio_anime_resilience', ANIME_RESILIENCE_REV);
  return new Request(url.toString(), { method: 'GET', headers: request.headers });
}

async function cachePut(cache, key, response, ctx) {
  if (!cache || !response?.ok) return;
  const task = cache.put(key, response.clone());
  if (ctx?.waitUntil) ctx.waitUntil(task);
  else await task;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Advanced Pages mode: every request enters this Worker (Worker-first v2).
    // Static build artifacts are deliberately handed to the Pages ASSETS binding here;
    // all runtime routes stay inside Nuvio's Cloudflare worker.
    if (['GET', 'HEAD'].includes(request.method) && isStaticPagesAsset(url.pathname)) {
      return staticPagesAsset(request, env);
    }

    if (!['GET', 'HEAD'].includes(request.method) || !isGlobalAnimeResilienceRequest(request.url)) {
      return baseWorker.fetch(request, env, ctx);
    }

    const cache = globalThis.caches?.default || null;
    const key = cache ? cacheRequest(request) : null;
    if (cache && key) {
      const cached = await cache.match(key);
      if (cached) return cached;
    }

    const baseResponse = await baseWorker.fetch(request, env, ctx);
    const response = await recoverGlobalAnimeResponse(request, baseResponse);
    if (response.headers.get('x-nuvio-anime-source') === 'anilist-cache-tsuzuki') {
      await cachePut(cache, key, response, ctx);
    }
    return response;
  }
};
